//! Local, declarative skill packages. No package code is executed.
use super::*;
use std::io::{Cursor, Read};

#[path = "skills_logs.rs"]
pub(super) mod logs;
#[path = "skills_online.rs"]
pub(super) mod online;

const KEY: &str = "workflow_skills_v1";
const MAX_BYTES: usize = 1024 * 1024;
const MAX_FILE_BYTES: usize = 256 * 1024;
pub(super) const MAX_CONTEXT_BYTES: usize = 96 * 1024;
const STAGES: [&str; 3] = ["script_polish", "scene_detail", "video_review"];

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub stages: Vec<String>,
    pub instructions: String,
    pub files: std::collections::BTreeMap<String, String>,
    pub unsupported: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub enabled: bool,
    pub builtin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_document: Option<String>,
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn builtins() -> Vec<Skill> {
    [
        (
            "builtin-scene-detail",
            "分镜细化",
            "逐镜补全站位、动作、镜头、光线与对白时间轴；保留原始资产、对白和时长。",
            "scene_detail",
        ),
        (
            "builtin-video-review",
            "视频审片",
            "对照分镜检查开头、中段和结尾抽帧，报告可见问题与未验证项。",
            "video_review",
        ),
    ]
    .into_iter()
    .map(|(id, name, description, stage)| Skill {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        version: "1.0.0".into(),
        stages: vec![stage.into()],
        instructions: description.into(),
        files: Default::default(),
        unsupported: vec![],
        warnings: vec![],
        enabled: true,
        builtin: true,
        origin: None,
        original_document: None,
    })
    .collect()
}

fn registry(conn: &Connection) -> Result<Value, ApiError> {
    Ok(get_config_json(conn, KEY)?.unwrap_or_else(|| json!({"skills":[],"bindings":{}})))
}

fn catalog(value: &Value) -> Result<Vec<Skill>, ApiError> {
    let mut skills = builtins();
    for saved in value["skills"].as_array().into_iter().flatten() {
        let skill: Skill = serde_json::from_value(saved.clone())
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "技能配置损坏"))?;
        if let Some(builtin) = skills.iter_mut().find(|item| item.id == skill.id) {
            builtin.enabled = skill.enabled;
        } else {
            skills.push(skill);
        }
    }
    Ok(skills)
}

fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.contains(['\\', ':', '\0'])
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn finder_metadata(path: &str) -> bool {
    path.split('/')
        .any(|part| part == "__MACOSX" || part == ".DS_Store" || part.starts_with("._"))
}

fn package(files: std::collections::BTreeMap<String, String>) -> Result<Skill, ApiError> {
    package_with_stages(files, None)
}

fn package_with_stages(
    files: std::collections::BTreeMap<String, String>,
    stage_binding: Option<Vec<String>>,
) -> Result<Skill, ApiError> {
    parse_package(files, stage_binding, MAX_FILE_BYTES, MAX_BYTES)
}

// Preview has a separate download budget; installation and model execution keep
// their own limits. Never truncate instructions or silently drop attachments.
fn parse_package(
    mut files: std::collections::BTreeMap<String, String>,
    stage_binding: Option<Vec<String>>,
    max_file_bytes: usize,
    max_total_bytes: usize,
) -> Result<Skill, ApiError> {
    if files.is_empty() || files.len() > 128 {
        return Err(bad(format!(
            "技能包含 {} 个文件，允许 1–128 个文件",
            files.len()
        )));
    }
    if files.keys().any(|path| !safe_path(path)) {
        return Err(bad("技能文件路径无效或越界"));
    }
    if let Some((path, content)) = files
        .iter()
        .find(|(_, content)| content.len() > max_file_bytes)
    {
        return Err(bad(format!(
            "文件 {path} 为 {:.1} KB，超过单文件上限 {} KB",
            content.len() as f64 / 1024.0,
            max_file_bytes / 1024
        )));
    }
    let total: usize = files.values().map(String::len).sum();
    if total > max_total_bytes {
        return Err(bad(format!(
            "技能包含 {} 个文件，合计 {:.1} KB，超过{}上限 {} KB",
            files.len(),
            total as f64 / 1024.0,
            if max_total_bytes == MAX_BYTES {
                "安装"
            } else {
                "预览"
            },
            max_total_bytes / 1024
        )));
    }
    files.retain(|path, _| !finder_metadata(path));
    let roots: Vec<String> = files
        .keys()
        .filter(|p| p.as_str() == "SKILL.md" || p.ends_with("/SKILL.md"))
        .cloned()
        .collect();
    if roots.len() != 1 {
        return Err(bad("技能包必须包含唯一的 SKILL.md"));
    }
    let root = roots[0].strip_suffix("SKILL.md").unwrap();
    if files.keys().any(|p| !p.starts_with(root)) {
        return Err(bad("所有文件必须位于 SKILL.md 所在目录内"));
    }
    files = files
        .into_iter()
        .map(|(p, c)| (p[root.len()..].to_string(), c))
        .collect();
    let markdown = files.remove("SKILL.md").unwrap().replace("\r\n", "\n");
    let header = markdown
        .trim_start_matches('\u{feff}')
        .strip_prefix("---\n")
        .ok_or_else(|| bad("SKILL.md 需要 YAML frontmatter"))?;
    let (yaml, instructions) = header
        .split_once("\n---\n")
        .ok_or_else(|| bad("SKILL.md 的 YAML frontmatter 未闭合"))?;
    let metadata: Value =
        serde_yaml::from_str(yaml).map_err(|e| bad(format!("技能元数据无效：{e}")))?;
    let field = |key: &str| -> Result<String, ApiError> {
        metadata[key]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty() && v.len() <= 1000)
            .map(str::to_string)
            .ok_or_else(|| bad(format!("技能缺少有效的 {key}")))
    };
    let name = field("name")?;
    if name.len() > 100 {
        return Err(bad("技能名称不能超过 100 字节"));
    }
    let description = field("description")?;
    let version = metadata["version"]
        .as_str()
        .unwrap_or("unversioned")
        .to_string();
    if version.len() > 100 {
        return Err(bad("技能版本号过长"));
    }
    if instructions.trim().is_empty() {
        return Err(bad("技能正文不能为空"));
    }
    let stages: Vec<String> = if let Some(stages) = stage_binding {
        stages
    } else {
        match metadata.get("stages") {
            None => vec![],
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|_| bad("stages 必须是字符串数组"))?
            }
        }
    };
    let mut unsupported = Vec::new();
    if stages.is_empty() {
        unsupported.push("未声明 stages；支持 script_polish / scene_detail / video_review".into());
    }
    for stage in &stages {
        if !STAGES.contains(&stage.as_str()) {
            unsupported.push(format!("不支持的流程：{stage}"));
        }
    }
    for key in ["allowed-tools", "tools", "mcp", "hooks"] {
        if metadata.get(key).is_some() {
            unsupported.push(format!("不支持 {key}，本版本只执行文本指令与参考资料"));
        }
    }
    let mut warnings = Vec::new();
    if files.keys().any(|path| !is_reference(path)) {
        warnings.push(
            "所有附件均会保存；脚本、工具配置和打包文件不自动执行，也不作为参考资料传入模型。"
                .into(),
        );
    }
    let id = format!(
        "skill-{}",
        hex::encode(Sha256::digest(name.as_bytes()))[..20].to_string()
    );
    Ok(Skill {
        id,
        name,
        description,
        version,
        stages,
        instructions: instructions.trim().into(),
        files,
        enabled: unsupported.is_empty(),
        unsupported,
        warnings,
        builtin: false,
        origin: None,
        original_document: None,
    })
}

fn unpack(bytes: &[u8]) -> Result<std::collections::BTreeMap<String, String>, ApiError> {
    if bytes.len() > 1024 * 1024 {
        return Err(bad("ZIP 上传不能超过 1 MB"));
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| bad(format!("ZIP 无效：{e}")))?;
    if archive.len() > 128 {
        return Err(bad("ZIP 文件数量不能超过 128"));
    }
    let mut files = std::collections::BTreeMap::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| bad(e.to_string()))?;
        let path = file.name().trim_end_matches('/').to_string();
        if !safe_path(&path)
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(bad("ZIP 包含不安全路径或符号链接"));
        }
        if file.is_dir() || finder_metadata(&path) {
            continue;
        }
        let mut text = String::new();
        (&mut file)
            .take((MAX_FILE_BYTES + 1) as u64)
            .read_to_string(&mut text)
            .map_err(|_| bad("仅支持 UTF-8 文本附件"))?;
        if text.len() > MAX_FILE_BYTES {
            return Err(bad(format!("文件 {path} 超过单文件上限 256 KB")));
        }
        total += text.len();
        if total > MAX_BYTES {
            return Err(bad("技能解压后超过 1 MB"));
        }
        if files.insert(path, text).is_some() {
            return Err(bad("ZIP 包含重复文件"));
        }
    }
    Ok(files)
}

pub(super) async fn api_list(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    Ok(Json(json!({"skills": catalog(&registry(&conn)?)?})))
}

pub(super) async fn api_install(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let files = if let Some(zip) = body["zip"].as_str() {
        let bytes = BASE64_STANDARD
            .decode(zip)
            .map_err(|_| bad("ZIP 编码无效"))?;
        unpack(&bytes)?
    } else {
        serde_json::from_value(body["files"].clone())
            .map_err(|_| bad("files 必须是路径到文本内容的映射"))?
    };
    let skill = package(files)?;
    store_skill(&state, &skill)?;
    Ok(Json(json!({"skill":skill})))
}

fn store_skill(state: &BackendState, skill: &Skill) -> Result<(), ApiError> {
    let mut conn = db_connection(state)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| bad(e.to_string()))?;
    let mut value = registry(&tx)?;
    let entries = value["skills"]
        .as_array_mut()
        .ok_or_else(|| bad("技能配置损坏"))?;
    if entries.iter().any(|v| v["id"] == skill.id) {
        return Err(bad("同名技能已安装；请先卸载旧版本再安装"));
    }
    if entries.len() >= 100 {
        return Err(bad("最多安装 100 个技能"));
    }
    entries.push(json!(skill));
    validate_context_budget(&catalog(&value)?.into_iter().filter(|s| s.enabled).collect::<Vec<_>>())?;
    set_config_json(&tx, KEY, &value)?;
    tx.commit().map_err(|e| bad(e.to_string()))?;
    Ok(())
}

pub(super) async fn api_change(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut conn = db_connection(&state)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| bad(e.to_string()))?;
    let mut value = registry(&tx)?;
    let mut skill = catalog(&value)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| bad("技能不存在"))?;
    let remove = body["remove"] == true;
    if remove && skill.builtin {
        return Err(bad("内置技能可停用，不能卸载"));
    }
    if !remove {
        if let Some(enabled) = body["enabled"].as_bool() {
            skill.enabled = enabled;
        } else if body.get("stages").is_none() {
            return Err(bad("缺少 enabled 或 stages"));
        }
        if let Some(stages) = body.get("stages") {
            if skill.builtin {
                return Err(bad("内置技能的适用流程不可修改"));
            }
            let stages = stages.as_array().ok_or_else(|| bad("stages 必须是流程数组"))?;
            if stages.is_empty() || stages.iter().any(|stage| stage.as_str().is_none_or(|stage| !STAGES.contains(&stage))) {
                return Err(bad("请选择至少一个支持的适用流程"));
            }
            let stages: Vec<String> = stages.iter().filter_map(Value::as_str).map(str::to_owned).collect();
            if stages.len() != stages.iter().collect::<std::collections::HashSet<_>>().len() {
                return Err(bad("适用流程不能重复"));
            }
            skill.stages = stages;
        }
        if skill.enabled && !skill.unsupported.is_empty() {
            return Err(bad("此技能包含不支持的能力，不能启用"));
        }
    }
    let entries = value["skills"]
        .as_array_mut()
        .ok_or_else(|| bad("技能配置损坏"))?;
    entries.retain(|v| v["id"] != id);
    if !remove {
        entries.push(json!(skill));
    }
    if remove {
        for ids in value["bindings"]
            .as_object_mut()
            .ok_or_else(|| bad("技能配置损坏"))?
            .values_mut()
        {
            if let Some(ids) = ids.as_array_mut() {
                ids.retain(|v| v != &id);
            }
        }
    }
    validate_context_budget(&catalog(&value)?.into_iter().filter(|s| s.enabled).collect::<Vec<_>>())?;
    set_config_json(&tx, KEY, &value)?;
    tx.commit().map_err(|e| bad(e.to_string()))?;
    Ok(Json(json!({"success":true})))
}

fn selected(value: &Value, project_id: &str) -> Vec<String> {
    value["bindings"][project_id]
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_else(|| builtins().into_iter().map(|s| s.id).collect())
}

pub(super) async fn api_project_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    ensure_project_permission(&conn, &id, ProjectPermission::View)?;
    let value = registry(&conn)?;
    Ok(Json(
        json!({"selectedIds": selected(&value, &id), "skills":catalog(&value)?, "canEdit":ensure_project_permission(&conn, &id, ProjectPermission::Edit).is_ok(), "projectName":conn.query_row("SELECT name FROM projects WHERE id=?1", params![id], |row| row.get::<_, String>(0)).unwrap_or_default()}),
    ))
}

pub(super) async fn api_project_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut conn = db_connection(&state)?;
    ensure_project_permission(&conn, &id, ProjectPermission::Edit)?;
    let ids: Vec<String> = serde_json::from_value(body["selectedIds"].clone())
        .map_err(|_| bad("selectedIds 必须是技能 ID 数组"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| bad(e.to_string()))?;
    let mut value = registry(&tx)?;
    let skills = catalog(&value)?;
    if ids.len() > 16 || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err(bad("最多选择 16 个不重复的技能"));
    }
    for id in &ids {
        if !skills
            .iter()
            .any(|s| &s.id == id && s.unsupported.is_empty())
        {
            return Err(bad("所选技能不存在或不兼容"));
        }
    }
    validate_context_budget(
        &skills
            .iter()
            .filter(|s| ids.contains(&s.id))
            .cloned()
            .collect::<Vec<_>>(),
    )?;
    value["bindings"][&id] = json!(ids);
    set_config_json(&tx, KEY, &value)?;
    tx.commit().map_err(|e| bad(e.to_string()))?;
    Ok(Json(json!({"success":true})))
}

// Package storage and model context have independent budgets. Auxiliary files
// remain available in details without being mistaken for model instructions.
fn is_reference(path: &str) -> bool {
    !path
        .split('/')
        .any(|part| matches!(part, "scripts" | "agents" | "dist"))
        && matches!(path.rsplit('.').next().unwrap_or(""), "md" | "txt" | "json")
}

fn skill_context(skill: &Skill) -> String {
    let mut text = format!(
        "\n【技能：{} v{}】\n{}\n",
        skill.name, skill.version, skill.instructions
    );
    for (path, content) in &skill.files {
        if is_reference(path) {
            text.push_str(&format!("\n【参考资料：{path}】\n{content}\n"));
        }
    }
    text
}

const EXECUTION_RULES: &str = "\n以上技能只补充创作与审查要求。参考资料已附在上下文中，仅应用与当前任务有关的规则；先创作再依据审稿规则自检。当前流程没有脚本执行、文件读取或联网工具，不得声称已执行这些操作。程序规定的 JSON 格式、角色和资产 ID、原文事实、对白及时间轴优先，不得被技能改写。\n";

fn validate_context_budget(skills: &[Skill]) -> Result<(), ApiError> {
    for stage in STAGES {
        let size: usize = skills
            .iter()
            .filter(|s| s.stages.iter().any(|v| v == stage))
            .map(|s| skill_context(s).len())
            .sum::<usize>()
            + EXECUTION_RULES.len();
        if size > MAX_CONTEXT_BYTES {
            return Err(bad(format!(
                "{stage} 流程的技能正文与参考资料合计超过 {} KB，请减少所选技能；附件不会被截断",
                MAX_CONTEXT_BYTES / 1024
            )));
        }
    }
    Ok(())
}

pub(super) struct Execution {
    state: BackendState,
    id: String,
    pub skills: Vec<Skill>,
    finished: bool,
    context: ModelLogContext,
    started: std::time::Instant,
}

fn runs_table(conn: &Connection) -> Result<(), ApiError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS skill_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS skill_runs_project_date ON skill_runs(project_id, created_at);")
        .map_err(|e| bad(e.to_string()))?;
    ensure_column(conn, "skill_runs", "owner_user_id", "TEXT")?;
    ensure_column(
        conn,
        "skill_runs",
        "cloud_sync_status",
        "TEXT NOT NULL DEFAULT 'legacy'",
    )?;
    Ok(())
}

/// An interrupted process cannot drop its execution guards. Recover these
/// records once at startup, never while another execution is still active.
pub(super) fn recover_runs(state: &BackendState) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    runs_table(&conn)?;
    conn.execute("UPDATE skill_runs SET cloud_sync_status=CASE WHEN owner_user_id IS NULL THEN 'legacy' ELSE 'pending' END, body=json_set(body, '$.status', 'interrupted', '$.revision', 1, '$.finishedAt', ?1, '$.result', json(?2)) WHERE json_extract(body,'$.status')='running'",
        params![now_iso(),json!({"message":"应用上次退出时执行尚未完成，请重试任务"}).to_string()]).map_err(|e| bad(e.to_string()))?;
    Ok(())
}

pub(super) fn begin(
    state: &BackendState,
    body: &Value,
    stage: &str,
) -> Result<Execution, ApiError> {
    let conn = db_connection(state)?;
    let value = registry(&conn)?;
    let project_id = body["projectId"]
        .as_str()
        .ok_or_else(|| bad("缺少 projectId"))?;
    let skills: Vec<_> = catalog(&value)?
        .into_iter()
        .filter(|s| {
            s.enabled
                && s.stages.iter().any(|v| v == stage)
                && s.unsupported.is_empty()
        })
        .collect();
    runs_table(&conn)?;
    let id = Uuid::new_v4().to_string();
    let mut context = current_model_log_context();
    context.project_id = Some(project_id.to_string());
    context.owner_user_id = cloud_user_id(&conn);
    context.skill_context = Some(
        json!({"runId":id,"stage":stage,"skills":skills.iter().map(|s| json!({"id":s.id,"name":s.name,"version":s.version,"origin":s.origin})).collect::<Vec<_>>()}),
    );
    let record = json!({"id":id,"projectId":project_id,"stage":stage,"createdAt":now_iso(),"status":"running","revision":0,
        "projectName":conn.query_row("SELECT name FROM projects WHERE id=?1",params![project_id],|row| row.get::<_,String>(0)).unwrap_or_default(),
        "skills":skills.iter().map(|s| json!({"id":s.id,"name":s.name,"version":s.version,"origin":s.origin})).collect::<Vec<_>>()});
    conn.execute(
        "INSERT INTO skill_runs (id,project_id,created_at,body,owner_user_id,cloud_sync_status) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, project_id, now_iso(), record.to_string(),context.owner_user_id, if context.owner_user_id.is_some() { "pending" } else { "legacy" }],
    )
    .map_err(|e| bad(e.to_string()))?;
    conn.execute("DELETE FROM skill_runs WHERE project_id=?1 AND cloud_sync_status != 'pending' AND json_extract(body, '$.status') != 'running' AND id NOT IN (SELECT id FROM skill_runs WHERE project_id=?1 ORDER BY created_at DESC LIMIT 100)", params![project_id]).map_err(|e| bad(e.to_string()))?;
    let mut execution = Execution {
        state: state.clone(),
        id,
        skills,
        finished: false,
        context,
        started: std::time::Instant::now(),
    };
    if let Err(error) = validate_context_budget(&execution.skills) {
        execution.finish("failed", json!({"message":error.message}))?;
        return Err(error);
    }
    logs::schedule(state);
    Ok(execution)
}

impl Execution {
    pub(super) fn model_log_context(&self) -> ModelLogContext {
        self.context.clone()
    }
    pub fn instructions(&self) -> String {
        let mut text: String = self.skills.iter().map(skill_context).collect();
        if !text.is_empty() {
            if self.context.skill_context.as_ref().and_then(|v| v["stage"].as_str()) == Some("script_polish") {
                text.push_str("\n以上技能仅补充写作要求。允许润色对白措辞、句式、节奏与潜台词；必须保留剧情事实、人物姓名和关系、关键线索、事件顺序和人物意图，不增加情节。按人物身份和情境写作，不刻意堆砌口语词。参考资料仅应用与当前任务相关的规则。没有脚本执行、文件读取或联网工具，不得声称执行这些操作。程序规定的输出格式和事实约束优先。\n");
            } else {
                text.push_str(EXECUTION_RULES);
            }
        }
        text
    }
    pub fn finish(&mut self, status: &str, result: Value) -> Result<(), ApiError> {
        let conn = db_connection(&self.state)?;
        let raw: String = conn
            .query_row(
                "SELECT body FROM skill_runs WHERE id=?1",
                params![self.id],
                |row| row.get(0),
            )
            .map_err(|e| bad(e.to_string()))?;
        let mut value: Value = serde_json::from_str(&raw).map_err(|e| bad(e.to_string()))?;
        value["status"] = json!(status);
        value["result"] = result;
        value["finishedAt"] = json!(now_iso());
        value["durationMs"] = json!(self.started.elapsed().as_millis() as u64);
        value["revision"] = json!(1);
        conn.execute(
            "UPDATE skill_runs SET body=?1, cloud_sync_status=CASE WHEN owner_user_id IS NULL THEN 'legacy' ELSE 'pending' END WHERE id=?2",
            params![value.to_string(), self.id],
        )
        .map_err(|e| bad(e.to_string()))?;
        self.finished = true;
        logs::schedule(&self.state);
        Ok(())
    }
}

impl Drop for Execution {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.finish(
                "interrupted",
                json!({"message":"流程失败或被取消，请查看该任务错误信息后重试"}),
            );
        }
    }
}

pub(super) async fn api_runs(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    ensure_project_permission(&conn, &id, ProjectPermission::View)?;
    runs_table(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT json_set(body, '$.syncStatus', cloud_sync_status) FROM skill_runs WHERE project_id=?1 ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|e| bad(e.to_string()))?;
    let rows = stmt
        .query_map(params![id], |row| row.get::<_, String>(0))
        .map_err(|e| bad(e.to_string()))?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(
            serde_json::from_str::<Value>(&row.map_err(|e| bad(e.to_string()))?)
                .map_err(|e| bad(e.to_string()))?,
        );
    }
    Ok(Json(json!({"runs":runs})))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    fn files(header: &str) -> std::collections::BTreeMap<String, String> {
        [
            (
                "demo/SKILL.md".into(),
                format!("---\nname: test\ndescription: 测试\n{header}\n---\n明确机位与动作。\n"),
            ),
            ("demo/references/example.md".into(), "参考".into()),
        ]
        .into()
    }
    #[test]
    fn imports_metadata_references_and_reports_incompatibility() {
        let s = package(files("version: '1.0'\nstages: [scene_detail]")).unwrap();
        assert!(s.enabled);
        assert_eq!(s.version, "1.0");
        assert!(s.files.contains_key("references/example.md"));
        let s = package(files("allowed-tools: Bash\nstages: [unknown]")).unwrap();
        assert!(!s.enabled);
        assert_eq!(s.unsupported.len(), 2);
        assert!(!package(files("")).unwrap().enabled);
    }
    #[test]
    fn rejects_unsafe_oversized_and_ambiguous_packages() {
        for path in [
            "../SKILL.md",
            "/SKILL.md",
            "a/../SKILL.md",
            "C:/SKILL.md",
            "a\\SKILL.md",
        ] {
            assert!(!safe_path(path));
        }
        let mut f = files("stages: [scene_detail]");
        f.insert("other/SKILL.md".into(), "x".into());
        assert!(package(f).is_err());
        let mut f = files("stages: [scene_detail]");
        f.insert("demo/large.txt".into(), "x".repeat(MAX_BYTES));
        assert!(package(f).is_err());
    }
    #[test]
    fn builtin_defaults_and_explicit_empty_selection() {
        let v = json!({"skills":[],"bindings":{"p":[]}});
        assert!(selected(&v, "p").is_empty());
        assert_eq!(selected(&v, "new").len(), 2);
        let v = json!({"skills":[Skill {enabled:false,..builtins().remove(0)}],"bindings":{}});
        assert!(!catalog(&v).unwrap()[0].enabled);
    }
    #[test]
    fn rejects_zip_traversal_and_symlinks() {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("../SKILL.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"bad").unwrap();
        assert!(unpack(&writer.finish().unwrap().into_inner()).is_err());
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink(
                "SKILL.md",
                "/tmp/secret",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        assert!(unpack(&writer.finish().unwrap().into_inner()).is_err());
    }
    pub(crate) struct Fixture(pub BackendState);
    impl Fixture {
        pub(crate) fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("playlet-skills-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            let state = BackendState {
                db_path: dir.join("test.db"),
                data_dir: dir.clone(),
                public_dir: dir.clone(),
                web_dir: dir,
            };
            let conn = db_connection(&state).unwrap();
            conn.execute_batch("CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT); CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT); CREATE TABLE project_members (project_id TEXT, user_id TEXT, role TEXT, permissions_json TEXT); INSERT INTO projects VALUES ('p','项目','owner'),('other','他人项目','other');").unwrap();
            set_config_json(
                &conn,
                CLOUD_ADMIN_SESSION_KEY,
                &json!({"token":"test-token","user":{"id":"owner","role":"user"}}),
            )
            .unwrap();
            Self(state)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0.data_dir);
        }
    }

    #[tokio::test]
    async fn script_polish_can_rewrite_dialogue_without_relaxing_scene_rules() {
        let fixture = Fixture::new();
        let state = &fixture.0;
        let mut skill = package(files("stages: [script_polish, scene_detail]")).unwrap();
        skill.id = "writer".into();
        store_skill(state, &skill).unwrap();
        let conn = db_connection(state).unwrap();
        let mut value = registry(&conn).unwrap();
        value["bindings"]["p"] = json!(["writer"]);
        set_config_json(&conn, KEY, &value).unwrap();
        let mut polish = begin(state, &json!({"projectId":"p"}), "script_polish").unwrap();
        assert!(polish.instructions().contains("允许润色对白措辞"));
        assert!(!polish.instructions().contains("对白及时间轴优先"));
        assert!(polish.instructions().contains("人物姓名和关系"));
        polish.finish("succeeded", json!({"message":"草稿"})).unwrap();
        let mut detail = begin(state, &json!({"projectId":"p"}), "scene_detail").unwrap();
        assert!(detail.instructions().contains("对白及时间轴优先"));
        detail.finish("succeeded", json!({})).unwrap();
        let mut review = begin(state, &json!({"projectId":"p"}), "video_review").unwrap();
        assert!(review.skills.iter().any(|skill| skill.id == "builtin-video-review"));
        review.finish("skipped", json!({})).unwrap();
    }

    #[tokio::test]
    async fn enabled_skill_runs_for_every_project_without_binding() {
        let fixture = Fixture::new();
        let state = &fixture.0;
        let mut skill = package(files("stages: [script_polish]")).unwrap();
        skill.id = "writer-global".into();
        store_skill(state, &skill).unwrap();
        for project_id in ["p", "other"] {
            let execution = begin(state, &json!({"projectId":project_id}), "script_polish").unwrap();
            assert!(execution.skills.iter().any(|skill| skill.id == "writer-global"));
        }
        let _ = api_change(Path(skill.id.clone()), State(state.clone()), Json(json!({"enabled":false}))).await.unwrap();
        assert!(begin(state, &json!({"projectId":"p"}), "script_polish").unwrap().skills.is_empty());
    }

    #[tokio::test]
    async fn install_select_execute_disable_uninstall_and_permissions() {
        let fixture = Fixture::new();
        let state = &fixture.0;
        let body = json!({"files":files("version: '2.0'\nstages: [scene_detail]")});
        let Json(installed) = api_install(State(state.clone()), Json(body.clone()))
            .await
            .unwrap();
        let id = installed["skill"]["id"].as_str().unwrap();
        assert!(api_install(State(state.clone()), Json(body)).await.is_err());
        let select = json!({"selectedIds":[id]});
        let _ = api_project_put(Path("p".into()), State(state.clone()), Json(select.clone()))
            .await
            .unwrap();
        assert!(api_project_put(
            Path("other".into()),
            State(state.clone()),
            Json(select.clone())
        )
        .await
        .is_err());
        assert!(api_project_get(Path("other".into()), State(state.clone()))
            .await
            .is_err());
        assert!(api_runs(Path("other".into()), State(state.clone()))
            .await
            .is_err());
        let mut execution = begin(state, &json!({"projectId":"p"}), "scene_detail").unwrap();
        assert!(execution.skills.iter().any(|skill| skill.id == id));
        assert!(execution.instructions().contains("明确机位与动作"));
        assert!(execution.instructions().contains("参考"));
        let video = begin(state, &json!({"projectId":"p"}), "video_review").unwrap();
        assert!(video.skills.iter().any(|skill| skill.id == "builtin-video-review"));
        drop(video);
        let _ = api_change(
            Path(id.into()),
            State(state.clone()),
            Json(json!({"enabled":false})),
        )
        .await
        .unwrap();
        assert!(execution.skills.iter().any(|skill| skill.id == id && skill.version == "2.0")); // immutable execution snapshot
        let disabled = begin(state, &json!({"projectId":"p"}), "scene_detail").unwrap();
        assert!(!disabled.skills.iter().any(|skill| skill.id == id));
        drop(disabled);
        execution
            .finish("succeeded", json!({"sceneCount":3}))
            .unwrap();
        let _ = api_change(
            Path(id.into()),
            State(state.clone()),
            Json(json!({"remove":true})),
        )
        .await
        .unwrap();
        let Json(project) = api_project_get(Path("p".into()), State(state.clone()))
            .await
            .unwrap();
        assert_eq!(project["selectedIds"], json!([]));
        let Json(history) = api_runs(Path("p".into()), State(state.clone()))
            .await
            .unwrap();
        assert!(history["runs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["status"] == "succeeded" && r["skills"].as_array().is_some_and(|skills| skills.iter().any(|skill| skill["version"] == "2.0"))));
        let conn = db_connection(state).unwrap();
        set_config_json(
            &conn,
            CLOUD_ADMIN_SESSION_KEY,
            &json!({"token":"test-token","user":{"id":"viewer","role":"user"}}),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_members VALUES ('p','viewer','viewer','[]')",
            [],
        )
        .unwrap();
        let Json(project) = api_project_get(Path("p".into()), State(state.clone()))
            .await
            .unwrap();
        assert_eq!(project["canEdit"], false);
        assert!(
            api_project_put(Path("p".into()), State(state.clone()), Json(select))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn incompatible_skills_and_builtin_uninstall_are_rejected() {
        let fixture = Fixture::new();
        let Json(installed) = api_install(
            State(fixture.0.clone()),
            Json(json!({"files":files("stages: [scene_detail]\nallowed-tools: Bash")})),
        )
        .await
        .unwrap();
        let id = installed["skill"]["id"].as_str().unwrap();
        assert!(api_change(
            Path(id.into()),
            State(fixture.0.clone()),
            Json(json!({"enabled":true}))
        )
        .await
        .is_err());
        assert!(api_project_put(
            Path("p".into()),
            State(fixture.0.clone()),
            Json(json!({"selectedIds":[id]}))
        )
        .await
        .is_err());
        assert!(api_change(
            Path("builtin-scene-detail".into()),
            State(fixture.0.clone()),
            Json(json!({"remove":true}))
        )
        .await
        .is_err());
        assert!(api_project_put(
            Path("p".into()),
            State(fixture.0.clone()),
            Json(json!({"selectedIds":["missing"]}))
        )
        .await
        .is_err());
    }

    #[test]
    fn recovers_interrupted_runs_and_rejects_aggregate_context_overflow() {
        let fixture = Fixture::new();
        let mut execution = begin(&fixture.0, &json!({"projectId":"p"}), "scene_detail").unwrap();
        recover_runs(&fixture.0).unwrap();
        let conn = db_connection(&fixture.0).unwrap();
        let raw: String = conn
            .query_row(
                "SELECT body FROM skill_runs WHERE id=?1",
                params![execution.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&raw).unwrap()["status"],
            "interrupted"
        );
        execution.finished = true;
        let mut first = builtins().remove(0);
        first.instructions = "a".repeat(MAX_CONTEXT_BYTES / 2 + 1);
        assert!(validate_context_budget(&[first.clone(), first]).is_err());
    }
    #[tokio::test]
    async fn zip_install_and_expansion_limit() {
        assert!(unpack(&vec![0; 1024 * 1024 + 1]).is_err());
        use std::io::Write;
        let fixture = Fixture::new();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, content) in files("stages: [video_review]") {
            writer
                .start_file(
                    path,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer
            .start_file(
                "__MACOSX/demo/._SKILL.md",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        writer.write_all(&[0, 255, 255]).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let Json(result) = api_install(
            State(fixture.0.clone()),
            Json(json!({"zip":BASE64_STANDARD.encode(bytes)})),
        )
        .await
        .unwrap();
        assert_eq!(result["skill"]["stages"], json!(["video_review"]));
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(
                "SKILL.md",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(&vec![b'a'; MAX_BYTES + 1]).unwrap();
        assert!(unpack(&writer.finish().unwrap().into_inner()).is_err());
    }
}
