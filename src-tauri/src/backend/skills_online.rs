//! skills.sh discovery and pinned GitHub imports. Remote URLs never reach a shell.
use super::*;
use futures_util::{stream, StreamExt, TryStreamExt};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const PREVIEW_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PREVIEWS: usize = 32;
const MAX_PREVIEW_BYTES: usize = MAX_BYTES;
const MAX_PREVIEW_FILE_BYTES: usize = MAX_FILE_BYTES;
const MISSING_STAGE: &str = "未声明 stages；支持 script_polish / scene_detail / video_review";

#[derive(Clone, Debug, PartialEq)]
struct Source {
    repository: String,
    selector: Option<String>,
    reference: String,
    path: Option<String>,
}

fn component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

fn parse_source(raw: &str) -> Result<Source, ApiError> {
    let raw = raw.trim();
    if raw.len() > 2048 {
        return Err(bad("技能链接过长"));
    }
    let (parts, github) = if raw.starts_with("https://") {
        let url = url::Url::parse(raw).map_err(|_| bad("技能链接无效"))?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(bad("请使用不含账号、端口、查询参数或片段的技能链接"));
        }
        let github = match url.host_str() {
            Some("skills.sh" | "www.skills.sh") => false,
            Some("github.com" | "www.github.com") => true,
            _ => return Err(bad("仅支持 skills.sh 或 GitHub 的公开仓库链接")),
        };
        // Reject dot traversal before URL normalization can remove it.
        let decoded = percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| bad("链接编码无效"))?;
        if decoded.split('/').any(|p| p == "." || p == "..") || decoded.contains('\\') {
            return Err(bad("链接路径无效"));
        }
        let parts = url
            .path()
            .trim_matches('/')
            .split('/')
            .map(|p| {
                percent_encoding::percent_decode_str(p)
                    .decode_utf8()
                    .map(|v| v.to_string())
                    .map_err(|_| bad("链接编码无效"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        (parts, github)
    } else {
        let (repo, skill) = raw
            .split_once('@')
            .map(|(r, s)| (r, Some(s)))
            .unwrap_or((raw, None));
        let mut parts: Vec<String> = repo.split('/').map(str::to_string).collect();
        if let Some(skill) = skill {
            parts.push(skill.into());
        }
        (parts, false)
    };
    if parts.len() < 2 || !component(&parts[0]) || !component(&parts[1]) {
        return Err(bad(
            "请输入 skills.sh 技能链接、GitHub 链接或 owner/repo@skill",
        ));
    }
    let repository = format!(
        "{}/{}",
        parts[0],
        parts[1].strip_suffix(".git").unwrap_or(&parts[1])
    )
    .to_lowercase();
    if repository.ends_with('/') {
        return Err(bad("仓库名称不能为空"));
    }
    let mut source = Source {
        repository,
        selector: None,
        reference: "HEAD".into(),
        path: None,
    };
    if github {
        if parts.len() == 2 {
            return Ok(source);
        }
        if parts.len() < 5 || !matches!(parts[2].as_str(), "tree" | "blob") || !component(&parts[3])
        {
            return Err(bad(
                "GitHub 链接需指向仓库或 tree/分支/技能目录，可用提交 SHA 避免分支名歧义",
            ));
        }
        source.reference = parts[3].clone();
        let mut path = parts[4..].join("/");
        if parts[2] == "blob" {
            path = path
                .strip_suffix("/SKILL.md")
                .or_else(|| (path == "SKILL.md").then_some(""))
                .ok_or_else(|| bad("文件链接必须指向 SKILL.md"))?
                .into();
        }
        if !path.is_empty() && !safe_path(&path) {
            return Err(bad("技能目录路径无效"));
        }
        source.path = Some(path);
    } else if parts.len() == 3 && component(&parts[2]) {
        source.selector = Some(parts[2].clone());
    } else if parts.len() != 2 {
        return Err(bad("skills.sh 链接应为 /owner/repo/skill"));
    }
    Ok(source)
}

fn network_error(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_GATEWAY, message)
}
fn client() -> Result<Client, ApiError> {
    Client::builder()
        .user_agent("Playlet-Skills/1.0")
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| network_error("无法创建技能下载连接"))
}

async fn fetch(client: &Client, url: url::Url, limit: usize) -> Result<Vec<u8>, ApiError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| network_error("无法连接技能服务，请检查网络后重试"))?;
    let status = response.status();
    if !status.is_success() {
        let message = match status.as_u16() {
            403 | 429 => "在线服务访问受限或请求过于频繁，请稍后重试；也可使用本地目录安装",
            404 => "仓库、分支或技能文件不存在，或不是公开仓库",
            300..=399 => "仓库地址已变更，请使用新的公开仓库链接",
            _ => "技能服务暂时不可用，请稍后重试",
        };
        return Err(network_error(message));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(bad("远程内容超过允许的大小"));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| network_error("技能下载中断，请重试"))?;
        if bytes.len() + chunk.len() > limit {
            return Err(bad("远程内容超过允许的大小"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn github_url(host: &str, parts: &[&str]) -> url::Url {
    let mut url = url::Url::parse(host).expect("static HTTPS base");
    url.path_segments_mut().unwrap().extend(parts);
    url
}
async fn json_get(client: &Client, url: url::Url, limit: usize) -> Result<Value, ApiError> {
    serde_json::from_slice(&fetch(client, url, limit).await?)
        .map_err(|_| network_error("在线服务返回了无效数据"))
}

fn search_results(value: &Value) -> Result<Vec<Value>, ApiError> {
    let items = value["skills"]
        .as_array()
        .ok_or_else(|| network_error("技能搜索返回格式已变化，请稍后重试"))?;
    let mut results = Vec::new();
    for item in items.iter().take(30) {
        let repo = item["source"].as_str().unwrap_or("");
        let skill_id = item["skillId"]
            .as_str()
            .or_else(|| item["id"].as_str().and_then(|id| id.rsplit('/').next()))
            .unwrap_or("");
        let source = format!("{repo}@{skill_id}");
        if !component(skill_id) || parse_source(&source).is_err() {
            continue;
        }
        let name = item["name"]
            .as_str()
            .filter(|s| s.len() <= 200)
            .unwrap_or(skill_id);
        results.push(json!({"name":name,"source":source,"repository":repo,"skillId":skill_id,
            "installs":item["installs"].as_u64().unwrap_or(0),"url":format!("https://skills.sh/{repo}/{skill_id}")}));
    }
    Ok(results)
}

pub(in crate::backend) async fn api_search(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let text = query.get("q").map(|v| v.trim()).unwrap_or("");
    if text.is_empty() || text.chars().count() > 100 {
        return Err(bad("请输入 1–100 字的搜索关键词"));
    }
    let mut url = url::Url::parse("https://skills.sh/api/search").unwrap();
    url.query_pairs_mut()
        .append_pair("q", text)
        .append_pair("limit", "30");
    let value = json_get(&client()?, url, 512 * 1024).await?;
    let skills = search_results(&value)?;
    Ok(Json(json!({"skills":skills})))
}

#[derive(Clone)]
struct Preview {
    files: BTreeMap<String, String>,
    origin: Value,
    created: Instant,
    db_path: PathBuf,
}
fn previews() -> &'static Mutex<HashMap<String, Preview>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Preview>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn remember(preview: Preview) -> Result<String, ApiError> {
    let mut cache = previews()
        .lock()
        .map_err(|_| network_error("技能预览暂时不可用"))?;
    cache.retain(|_, value| value.created.elapsed() < PREVIEW_TTL);
    if cache.len() >= MAX_PREVIEWS {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, v)| v.created)
            .map(|(k, _)| k.clone())
        {
            cache.remove(&oldest);
        }
    }
    let token = Uuid::new_v4().to_string();
    cache.insert(token.clone(), preview);
    Ok(token)
}
fn valid_commit(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|c| c.is_ascii_hexdigit())
}

fn candidates(tree: &Value) -> Result<Vec<String>, ApiError> {
    if tree["truncated"] == true {
        return Err(bad("仓库目录过大，无法完整识别技能；请改用本地目录安装"));
    }
    let items = tree["tree"]
        .as_array()
        .ok_or_else(|| network_error("仓库目录格式无效"))?;
    let mut paths = Vec::new();
    for item in items {
        let path = item["path"].as_str().unwrap_or("");
        if item["type"] == "blob" && (path == "SKILL.md" || path.ends_with("/SKILL.md")) {
            if item["mode"] != "100644" && item["mode"] != "100755" {
                continue;
            }
            if !safe_path(path) {
                return Err(bad("仓库中存在不安全的技能路径"));
            }
            paths.push(
                path.strip_suffix("SKILL.md")
                    .unwrap()
                    .trim_end_matches('/')
                    .to_string(),
            );
        }
    }
    paths.sort();
    if paths.len() > 500 {
        return Err(bad("仓库中的技能超过 500 个，请使用本地目录安装"));
    }
    Ok(paths)
}

fn select_path(source: &Source, paths: &[String]) -> Option<String> {
    if let Some(path) = &source.path {
        return paths.contains(path).then(|| path.clone());
    }
    if let Some(selector) = &source.selector {
        let matches: Vec<_> = paths
            .iter()
            .filter(|p| p.rsplit('/').next() == Some(selector))
            .collect();
        if matches.len() == 1 {
            return Some(matches[0].clone());
        }
        if paths.len() == 1 && paths[0].is_empty() {
            return Some(String::new());
        }
        return None;
    }
    (paths.len() == 1).then(|| paths[0].clone())
}

fn package_entries(tree: &Value, directory: &str) -> Result<Vec<(String, usize)>, ApiError> {
    let prefix = if directory.is_empty() {
        String::new()
    } else {
        format!("{directory}/")
    };
    let mut files = Vec::new();
    let mut total = 0;
    for entry in tree["tree"]
        .as_array()
        .ok_or_else(|| network_error("仓库目录格式无效"))?
    {
        let path = entry["path"].as_str().unwrap_or("");
        let Some(relative) = path.strip_prefix(&prefix) else {
            continue;
        };
        if entry["type"] == "tree" || finder_metadata(relative) {
            continue;
        }
        if !safe_path(relative)
            || entry["type"] != "blob"
            || !matches!(entry["mode"].as_str(), Some("100644" | "100755"))
        {
            return Err(bad(
                "技能目录包含符号链接、子模块或不安全路径，不能在线安装",
            ));
        }
        let size = entry["size"]
            .as_u64()
            .ok_or_else(|| network_error("仓库文件缺少大小信息"))?;
        if size > MAX_PREVIEW_FILE_BYTES as u64 {
            return Err(bad(format!(
                "附件 {relative} 为 {:.1} KB，超过单文件预览上限 256 KB",
                size as f64 / 1024.0
            )));
        }
        total += size;
        if files.len() >= 128 {
            return Err(bad("技能超过预览数量上限 128 个文件"));
        }
        if total > MAX_PREVIEW_BYTES as u64 {
            return Err(bad("技能文件合计超过预览大小上限 1 MB"));
        }
        files.push((path.to_string(), size as usize));
    }
    Ok(files)
}

async fn prepare(state: &BackendState, body: &Value) -> Result<Value, ApiError> {
    let mut source = parse_source(body["source"].as_str().ok_or_else(|| bad("缺少技能链接"))?)?;
    if let Some(path) = body["path"].as_str() {
        if !path.is_empty() && !safe_path(path) {
            return Err(bad("技能目录路径无效"));
        }
        source.path = Some(path.into());
    }
    let client = client()?;
    let repo: Vec<_> = source.repository.split('/').collect();
    let commit = if let Some(commit) = body["commit"].as_str() {
        if !valid_commit(commit) {
            return Err(bad("提交版本无效"));
        }
        commit.to_string()
    } else {
        let mut url = github_url(
            "https://api.github.com",
            &["repos", repo[0], repo[1], "commits"],
        );
        url.query_pairs_mut()
            .append_pair("sha", &source.reference)
            .append_pair("per_page", "1");
        let value = json_get(&client, url, 128 * 1024).await?;
        let sha = value[0]["sha"]
            .as_str()
            .filter(|v| valid_commit(v))
            .ok_or_else(|| network_error("无法确定仓库提交版本"))?;
        sha.to_string()
    };
    let mut url = github_url(
        "https://api.github.com",
        &["repos", repo[0], repo[1], "git", "trees", &commit],
    );
    url.query_pairs_mut().append_pair("recursive", "1");
    let tree = json_get(&client, url, 4 * 1024 * 1024).await?;
    let paths = candidates(&tree)?;
    if paths.is_empty() {
        return Err(bad("仓库中未找到 SKILL.md"));
    }
    let Some(path) = select_path(&source, &paths) else {
        if source.path.is_some() {
            return Err(bad("指定目录内没有 SKILL.md"));
        }
        return Ok(
            json!({"kind":"choose","repository":source.repository,"commit":commit,"paths":paths}),
        );
    };
    let entries = package_entries(&tree, &path)?;
    let files: BTreeMap<String, String> = stream::iter(entries.into_iter().map(|(path, size)| {
        let client = &client;
        let commit = &commit;
        let repo = &repo;
        async move {
            let mut parts = vec![repo[0], repo[1], commit.as_str()];
            parts.extend(path.split('/'));
            let bytes = fetch(
                client,
                github_url("https://raw.githubusercontent.com", &parts),
                MAX_PREVIEW_FILE_BYTES,
            )
            .await?;
            if bytes.len() != size {
                return Err(network_error("下载内容与固定版本的文件大小不一致，请重试"));
            }
            let content = String::from_utf8(bytes).map_err(|_| {
                bad(format!(
                    "附件 {path} 不是 UTF-8 文本，当前版本不支持在线安装此技能"
                ))
            })?;
            Ok((path, content))
        }
    }))
    .buffer_unordered(4)
    .try_collect()
    .await?;
    // Local binding is kept separately. Do not rewrite the author's SKILL.md.
    let mut skill = preview_package(&files)?;
    let blocking: Vec<_> = skill
        .unsupported
        .iter()
        .filter(|v| v.as_str() != MISSING_STAGE)
        .cloned()
        .collect();
    let total_bytes: usize = files.values().map(String::len).sum();
    let file_count = files.len();
    let mut url_parts = vec![repo[0], repo[1], "tree", &commit];
    if !path.is_empty() {
        url_parts.extend(path.split('/'));
    }
    let origin = json!({"provider":"github","repository":source.repository,"path":path,"commit":commit,
        "url":github_url("https://github.com",&url_parts).to_string(),
        "contentHash":hex::encode(Sha256::digest(serde_json::to_vec(&files).map_err(|_| bad("技能序列化失败"))?))});
    apply_origin(&mut skill, &origin, &files);
    skill.warnings.extend(text_warnings(&skill));
    let warnings = skill.warnings.clone();
    let context_bytes = skill_context(&skill).len() + EXECUTION_RULES.len();
    let token = remember(Preview {
        files,
        origin: origin.clone(),
        created: Instant::now(),
        db_path: state.db_path.clone(),
    })?;
    Ok(
        json!({"kind":"preview","token":token,"skill":skill,"origin":origin,"blockingIssues":blocking,"packageSizeBytes":total_bytes,"contextSizeBytes":context_bytes,"fileCount":file_count,"warnings":warnings,"expiresInSeconds":PREVIEW_TTL.as_secs()}),
    )
}

fn preview_package(files: &BTreeMap<String, String>) -> Result<Skill, ApiError> {
    parse_package(
        files.clone(),
        Some(vec![]),
        MAX_PREVIEW_FILE_BYTES,
        MAX_PREVIEW_BYTES,
    )
}

pub(in crate::backend) async fn api_preview(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    static LIMIT: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    let _permit = LIMIT
        .get_or_init(|| tokio::sync::Semaphore::new(4))
        .try_acquire()
        .map_err(|_| {
            ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "正在下载其他技能，请稍后重试",
            )
        })?;
    tokio::time::timeout(Duration::from_secs(60), prepare(&state, &body))
        .await
        .map_err(|_| network_error("技能预览下载超时，请重试或使用本地目录安装"))?
        .map(Json)
}

pub(in crate::backend) async fn api_install(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let token = body["token"].as_str().ok_or_else(|| bad("请先预览技能"))?;
    let stages: Vec<String> =
        serde_json::from_value(body["stages"].clone()).map_err(|_| bad("请选择适用流程"))?;
    if stages.is_empty()
        || stages.len() > 2
        || stages.iter().collect::<HashSet<_>>().len() != stages.len()
        || stages.iter().any(|s| !STAGES.contains(&s.as_str()))
    {
        return Err(bad("请选择分镜细化或视频审片，不能重复或指定其他流程"));
    }
    let mut cache = previews()
        .lock()
        .map_err(|_| network_error("技能预览暂时不可用"))?;
    let preview = cache
        .get(token)
        .filter(|p| p.created.elapsed() < PREVIEW_TTL && p.db_path == state.db_path)
        .ok_or_else(|| ApiError::new(StatusCode::GONE, "预览已过期或应用已重启，请重新预览"))?;
    let mut skill = package_with_stages(preview.files.clone(), Some(stages))?;
    if !skill.unsupported.is_empty() {
        return Err(bad(format!(
            "此技能不兼容：{}",
            skill.unsupported.join("；")
        )));
    }
    skill.warnings.extend(text_warnings(&skill));
    let mut origin = preview.origin.clone();
    origin["installedAt"] = json!(now_iso());
    apply_origin(&mut skill, &origin, &preview.files);
    validate_context_budget(&[skill.clone()])?;
    store_skill(&state, &skill)?;
    cache.remove(token);
    Ok(Json(json!({"skill":skill})))
}

fn apply_origin(skill: &mut Skill, origin: &Value, files: &BTreeMap<String, String>) {
    skill.id = format!(
        "online-{}",
        &hex::encode(Sha256::digest(
            format!(
                "{}/{}",
                origin["repository"].as_str().unwrap_or(""),
                origin["path"].as_str().unwrap_or("")
            )
            .as_bytes()
        ))[..20]
    );
    if skill.version == "unversioned" {
        skill.version = origin["commit"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(12)
            .collect();
    }
    skill.origin = Some(origin.clone());
    skill.original_document = files
        .iter()
        .find(|(path, _)| path.as_str() == "SKILL.md" || path.ends_with("/SKILL.md"))
        .map(|(_, text)| text.clone());
}

fn text_warnings(skill: &Skill) -> Vec<String> {
    static COMMANDS: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = COMMANDS.get_or_init(|| regex::Regex::new(r"(?im)```(?:bash|sh|shell|powershell|python)\b|(?:^|[`\s])(?:npx|bunx|pip|python3?|curl|wget)\s|mcp__").unwrap());
    if std::iter::once(&skill.instructions)
        .chain(skill.files.values())
        .any(|text| pattern.is_match(text))
    {
        vec!["正文或附件包含命令或工具用法。本版本只提供文字参考，不会执行这些操作；仅当所选流程不依赖这些操作时使用此技能。".into()]
    } else {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sources_accept_supported_links_and_reject_remote_path_injection() {
        assert_eq!(
            parse_source("https://www.skills.sh/Owner/Repo/my-skill").unwrap(),
            parse_source("owner/repo@my-skill").unwrap()
        );
        let s = parse_source("https://github.com/owner/repo/tree/main/skills/demo").unwrap();
        assert_eq!(s.path.as_deref(), Some("skills/demo"));
        assert_eq!(s.reference, "main");
        assert_eq!(
            parse_source("https://github.com/owner/repo/blob/main/SKILL.md")
                .unwrap()
                .path,
            Some("".into())
        );
        for source in [
            "http://127.0.0.1/a/b",
            "https://skills.sh.evil.org/a/b/c",
            "https://user:pass@github.com/a/b",
            "https://github.com:80/a/b",
            "https://github.com/a/b?url=x",
            "https://github.com/a/b/tree/main/../secret",
            "https://github.com/a/b/tree/main/%2e%2e/secret",
            "owner/repo@../../x",
            "file:///tmp/skill",
            "https://github.com/a/b/tree/main/%2fetc",
        ] {
            assert!(parse_source(source).is_err(), "{source}");
        }
    }
    #[test]
    fn filters_search_sources_and_reports_changed_responses() {
        let results = search_results(&json!({"skills":[{"name":"Demo","source":"owner/repo","id":"owner/repo/demo","installs":15},{"source":"https://evil.test","skillId":"demo"}]})).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["source"], "owner/repo@demo");
        assert!(search_results(&json!({"error":"rate limit"})).is_err());
    }
    fn tree() -> Value {
        json!({"truncated":false,"tree":[
            {"path":"skills/one/SKILL.md","type":"blob","mode":"100644","size":20},
            {"path":"skills/one/references/a.md","type":"blob","mode":"100644","size":10},
            {"path":"skills/two/SKILL.md","type":"blob","mode":"100644","size":20}
        ]})
    }
    #[test]
    fn selects_one_skill_without_sibling_files_and_rejects_unsafe_trees() {
        let paths = candidates(&tree()).unwrap();
        assert_eq!(
            select_path(&parse_source("owner/repo@one").unwrap(), &paths),
            Some("skills/one".into())
        );
        assert!(select_path(&parse_source("owner/repo").unwrap(), &paths).is_none());
        assert_eq!(package_entries(&tree(), "skills/one").unwrap().len(), 2);
        let mut oversized = tree();
        oversized["tree"][0]["size"] = json!(MAX_PREVIEW_FILE_BYTES + 1);
        assert!(package_entries(&oversized, "skills/one").is_err());
        let mut symlink = tree();
        symlink["tree"][1]["mode"] = json!("120000");
        assert!(package_entries(&symlink, "skills/one").is_err());
        let mut partial = tree();
        partial["truncated"] = json!(true);
        assert!(candidates(&partial).is_err());
    }
    fn fixture_preview(state: &BackendState, extra: &str) -> Preview {
        Preview { files:[("skills/demo/SKILL.md".into(),format!("---\nname: demo\ndescription: 分镜细化\n{extra}\n---\n逐镜细化，不增加时长。")),("skills/demo/references/a.md".into(),"动作示例".into())].into(),
            origin:json!({"provider":"github","repository":"owner/repo","path":"skills/demo","commit":"0123456789012345678901234567890123456789","contentHash":"fixture","url":"https://github.com/owner/repo/tree/0123456789012345678901234567890123456789/skills/demo"}),
            created:Instant::now(),db_path:state.db_path.clone() }
    }
    #[tokio::test]
    async fn installs_only_previewed_content_with_local_stage_binding_and_provenance() {
        let fixture = super::super::tests::Fixture::new();
        let original = fixture_preview(&fixture.0, "");
        let raw = original.files["skills/demo/SKILL.md"].clone();
        let token = remember(original.clone()).unwrap();
        let Json(result) = api_install(
            State(fixture.0.clone()),
            Json(json!({"token":token,"stages":["scene_detail"],"files":{"SKILL.md":"tampered"}})),
        )
        .await
        .unwrap();
        assert_eq!(result["skill"]["stages"], json!(["scene_detail"]));
        assert_eq!(result["skill"]["originalDocument"], raw);
        assert_eq!(
            result["skill"]["origin"]["commit"],
            original.origin["commit"]
        );
        assert_eq!(result["skill"]["version"], "012345678901");
        assert_eq!(result["skill"]["enabled"], true);
        assert!(api_install(
            State(fixture.0.clone()),
            Json(json!({"token":token,"stages":["scene_detail"]}))
        )
        .await
        .is_err());
        let token = remember(original).unwrap();
        assert!(api_install(
            State(fixture.0.clone()),
            Json(json!({"token":token,"stages":["video_review"]}))
        )
        .await
        .is_err());
        let value = registry(&db_connection(&fixture.0).unwrap()).unwrap();
        assert_eq!(value["skills"].as_array().unwrap().len(), 1);
        assert!(
            !selected(&value, "p").contains(&result["skill"]["id"].as_str().unwrap().to_string())
        );
    }
    #[tokio::test]
    async fn rejects_expired_wrong_database_incompatible_and_invalid_bindings() {
        let fixture = super::super::tests::Fixture::new();
        let other = super::super::tests::Fixture::new();
        let token = remember(fixture_preview(&fixture.0, "")).unwrap();
        for stages in [
            json!([]),
            json!(["unknown"]),
            json!(["scene_detail", "scene_detail"]),
        ] {
            assert!(api_install(
                State(fixture.0.clone()),
                Json(json!({"token":token,"stages":stages}))
            )
            .await
            .is_err());
        }
        assert!(api_install(
            State(other.0.clone()),
            Json(json!({"token":token,"stages":["scene_detail"]}))
        )
        .await
        .is_err());
        let mut expired = fixture_preview(&fixture.0, "");
        expired.created -= PREVIEW_TTL;
        let token = remember(expired).unwrap();
        assert_eq!(
            api_install(
                State(fixture.0.clone()),
                Json(json!({"token":token,"stages":["scene_detail"]}))
            )
            .await
            .unwrap_err()
            .status,
            StatusCode::GONE
        );
        let token = remember(fixture_preview(&fixture.0, "allowed-tools: Bash")).unwrap();
        assert!(api_install(
            State(fixture.0.clone()),
            Json(json!({"token":token,"stages":["scene_detail"]}))
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn bounds_network_response_and_surfaces_upstream_errors() {
        let router = axum::Router::new()
            .route("/large", axum::routing::get(|| async { "123456789" }))
            .route(
                "/limited",
                axum::routing::get(|| async { StatusCode::TOO_MANY_REQUESTS }),
            )
            .route(
                "/redirect",
                axum::routing::get(|| async {
                    axum::response::Redirect::temporary("http://127.0.0.1/private")
                }),
            )
            .route("/ok", axum::routing::get(|| async { "{}" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        for path in ["large", "limited", "redirect"] {
            assert!(fetch(
                &client,
                url::Url::parse(&format!("http://{address}/{path}")).unwrap(),
                4
            )
            .await
            .is_err());
        }
        assert_eq!(
            fetch(
                &client,
                url::Url::parse(&format!("http://{address}/ok")).unwrap(),
                4
            )
            .await
            .unwrap(),
            b"{}"
        );
        task.abort();
    }
    #[test]
    fn flags_undeclared_command_dependencies_without_claiming_to_run_them() {
        let mut skill = builtins().remove(0);
        assert!(text_warnings(&skill).is_empty());
        skill.instructions = "先执行 `npx skills find video`".into();
        assert_eq!(text_warnings(&skill).len(), 1);
        skill.instructions = "请参考附件".into();
        skill.files.insert(
            "example.md".into(),
            "```python\nprint('example')\n```".into(),
        );
        assert_eq!(text_warnings(&skill).len(), 1);
    }
    #[tokio::test]
    async fn installs_large_packages_preserving_scripts_without_injecting_them() {
        let fixture = super::super::tests::Fixture::new();
        let mut preview = fixture_preview(&fixture.0, "");
        preview
            .files
            .insert("skills/demo/references/long.md".into(), "资料".repeat(6000));
        preview.files.insert(
            "skills/demo/references/second.md".into(),
            "资料".repeat(6000),
        );
        preview.files.insert(
            "skills/demo/scripts/check_prose.py".into(),
            "print('check')".into(),
        );
        let skill = preview_package(&preview.files).unwrap();
        assert_eq!(skill.files["references/long.md"], "资料".repeat(6000));
        assert!(!skill.warnings.is_empty());
        let token = remember(preview).unwrap();
        let Json(installed) = api_install(
            State(fixture.0.clone()),
            Json(json!({"token":token,"stages":["scene_detail"]})),
        )
        .await
        .unwrap();
        assert_eq!(installed["skill"]["enabled"], true);
        let id = installed["skill"]["id"].as_str().unwrap();
        let _ = super::super::api_project_put(
            Path("p".into()),
            State(fixture.0.clone()),
            Json(json!({"selectedIds":[id]})),
        )
        .await
        .unwrap();
        let execution = begin(&fixture.0, &json!({"projectId":"p"}), "scene_detail").unwrap();
        assert_eq!(
            execution.skills[0].files["scripts/check_prose.py"],
            "print('check')"
        );
        let context = execution.instructions();
        assert!(context.contains(&"资料".repeat(6000)));
        assert!(!context.contains("print('check')"));
        assert!(context.len() > 64 * 1024);
        assert!(context.len() < MAX_CONTEXT_BYTES);
    }

    #[test]
    fn human_writing_directory_is_viewable_and_preview_limits_are_separate() {
        // Sizes from kkkkhazix/human-writing at 4fda173f; repository README,
        // cover image and changelog are outside the selected skill directory.
        let entries = [
            ("LICENSE", 1089),
            ("SKILL.md", 15547),
            ("VERSION", 6),
            ("agents/openai.yaml", 306),
            ("dist/human-writing-lite.md", 2665),
            ("references/fiction.md", 4797),
            ("references/formats.md", 4574),
            ("references/forum-prose.md", 23623),
            ("references/reality.md", 5911),
            ("references/revision.md", 12785),
            ("scripts/check_prose.py", 21598),
        ];
        let mut tree = json!({"tree":entries.iter().map(|(path,size)| json!({"path":format!("human-writing/{path}"),"type":"blob","mode":"100644","size":size})).collect::<Vec<_>>()});
        tree["tree"].as_array_mut().unwrap().push(json!({"path":"assets/cover.svg","type":"blob","mode":"100644","size":MAX_PREVIEW_BYTES+1}));
        let files = package_entries(&tree, "human-writing").unwrap();
        assert_eq!(files.len(), 11);
        assert_eq!(files.iter().map(|(_, size)| size).sum::<usize>(), 92901);
        let mut total = json!({"tree":[]});
        for i in 0..5 {
            total["tree"].as_array_mut().unwrap().push(json!({"path":format!("skill/{i}.md"),"type":"blob","mode":"100644","size":MAX_PREVIEW_FILE_BYTES}));
        }
        assert!(package_entries(&total, "skill")
            .unwrap_err()
            .message
            .contains("1 MB"));
        let mut count = json!({"tree":[]});
        for i in 0..129 {
            count["tree"].as_array_mut().unwrap().push(
                json!({"path":format!("skill/{i}.md"),"type":"blob","mode":"100644","size":1}),
            );
        }
        assert!(package_entries(&count, "skill")
            .unwrap_err()
            .message
            .contains("128 个文件"));
    }
    #[tokio::test]
    #[ignore = "Manual regression against the public human-writing repository"]
    async fn live_human_writing_install_and_use() {
        let fixture = super::super::tests::Fixture::new();
        let Json(response) = api_preview(
            State(fixture.0.clone()),
            Json(json!({
                "source":"kkkkhazix/human-writing@human-writing",
                "commit":"4fda173f3fef7fb808f3eba991eeb2528ea4b189"
            })),
        )
        .await
        .unwrap();
        assert_eq!(response["kind"], "preview");
        assert_eq!(response["skill"]["name"], "human-writing");
        assert_eq!(response["fileCount"], 11);
        assert_eq!(response["packageSizeBytes"], 92901);
        assert!(response["skill"]["instructions"]
            .as_str()
            .unwrap()
            .contains("活人感写作"));
        assert!(
            response["skill"]["files"]["scripts/check_prose.py"]
                .as_str()
                .unwrap()
                .len()
                > 20000
        );
        assert!(response["blockingIssues"].as_array().unwrap().is_empty());
        assert!(response["contextSizeBytes"].as_u64().unwrap() < MAX_CONTEXT_BYTES as u64);
        let Json(installed) = api_install(
            State(fixture.0.clone()),
            Json(json!({"token":response["token"],"stages":["scene_detail"]})),
        )
        .await
        .unwrap();
        assert_eq!(installed["skill"]["enabled"], true);
        assert_eq!(installed["skill"]["files"], response["skill"]["files"]);
        let id = installed["skill"]["id"].as_str().unwrap();
        let _ = super::super::api_project_put(
            Path("p".into()),
            State(fixture.0.clone()),
            Json(json!({"selectedIds":["builtin-scene-detail",id]})),
        )
        .await
        .unwrap();
        let mut execution = begin(&fixture.0, &json!({"projectId":"p"}), "scene_detail").unwrap();
        let prompt = execution.instructions();
        assert!(prompt.len() > 48_000);
        assert!(prompt.contains("活人感写作"));
        assert!(prompt.contains("【参考资料：references/fiction.md】"));
        assert!(prompt.contains("【参考资料：references/revision.md】"));
        assert!(!prompt.contains("【参考资料：scripts/"));
        assert!(!prompt.contains("【参考资料：agents/"));
        assert!(!prompt.contains("【参考资料：dist/"));
        execution
            .finish(
                "succeeded",
                json!({"message":"verified full skill context"}),
            )
            .unwrap();
        println!("Verified real human-writing: all 11 files installed, project selection saved, complete writing references injected. No live model call.");
    }
}
