use super::*;
use axum::extract::Multipart;
use axum::response::sse::{Event, KeepAlive, Sse};
use chrono::Utc;
use futures_util::stream;
use reqwest::header::USER_AGENT;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path as FsPath, PathBuf};
use std::process::Command;

const BCUT_BASE_URL: &str = "https://member.bilibili.com/x/bcut/rubick-interface";
const BCUT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const BCUT_MODEL_ID: &str = "7";
const VIDEO_IMPORT_DIR: &str = "video-import";
const ASR_POLL_INTERVAL_MS: u64 = 2_000;
const ASR_TIMEOUT_MS: u64 = 600_000;

#[derive(Debug, Deserialize)]
pub(super) struct VideoImportTasksQuery {
    status: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(super) struct VideoImportTextBody {
    text: Option<String>,
    script: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct VideoImportRetryBody {
    #[serde(rename = "fromStep")]
    from_step: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoImportArtifactView {
    id: String,
    task_id: String,
    kind: String,
    path: String,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    sha256: Option<String>,
    metadata: Value,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoImportStepRunView {
    id: String,
    task_id: String,
    step: String,
    attempt: i64,
    status: String,
    started_at: String,
    ended_at: Option<String>,
    duration_ms: Option<i64>,
    provider: Option<String>,
    external_task_id: Option<String>,
    error_message: Option<String>,
    metadata: Value,
}

#[derive(Debug)]
struct VideoImportTaskRecord {
    id: String,
    original_filename: String,
    source_kind: String,
    source_path: String,
    status: String,
    current_step: String,
    progress: i64,
    error_message: Option<String>,
    asr_provider: String,
    script_model_id: Option<String>,
    config_json: String,
    metadata_json: String,
    created_at: String,
    updated_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    cancelled_at: Option<String>,
}

#[derive(Debug, Clone)]
struct BcutSegment {
    start_time: i64,
    end_time: i64,
    transcript: String,
}

struct BcutOutput {
    task_id: String,
    raw: Value,
    text: String,
    srt: String,
    segments: Vec<BcutSegment>,
}

pub(super) async fn api_video_import_upload(
    State(state): State<BackendState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let task_id = format!("vimp_{}", Uuid::new_v4().simple());
    let task_dir = state.data_dir.join(VIDEO_IMPORT_DIR).join(&task_id);
    fs::create_dir_all(&task_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut original_filename = String::new();
    let mut source_path: Option<PathBuf> = None;
    let mut config = json!({});

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "config" {
            let raw = field
                .text()
                .await
                .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?;
            if !raw.trim().is_empty() {
                config = serde_json::from_str::<Value>(&raw)
                    .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?;
            }
            continue;
        }

        if name != "video" {
            continue;
        }

        let filename = field
            .file_name()
            .map(str::to_string)
            .unwrap_or_else(|| "upload.mp4".to_string());
        let extension = file_extension(&filename).unwrap_or_else(|| "mp4".to_string());
        validate_video_extension(&extension)?;
        original_filename = filename;

        let output_path = task_dir.join(format!("source.{}", extension));
        let mut file = File::create(&output_path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
        {
            file.write_all(&chunk)
                .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
        source_path = Some(output_path);
    }

    let source_path = source_path.ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "缺少 video 文件字段")
    })?;
    if original_filename.trim().is_empty() {
        original_filename = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("upload.mp4")
            .to_string();
    }

    let conn = db_connection(&state)?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO video_import_tasks (
          id, original_filename, source_kind, source_path, status, current_step, progress,
          asr_provider, config_json, metadata_json, created_at, updated_at
        ) VALUES (?1, ?2, 'upload', ?3, 'pending', 'created', 0, 'bcut', ?4, '{}', ?5, ?6)",
        params![
            task_id,
            original_filename,
            source_path.to_string_lossy().to_string(),
            config.to_string(),
            now,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    insert_artifact(
        &conn,
        &task_id,
        "source_video",
        &source_path,
        Some("video/mp4"),
        json!({ "originalFilename": original_filename }),
    )?;
    drop(conn);

    let background_state = state.clone();
    let background_task_id = task_id.clone();
    tokio::spawn(async move {
        if let Err(error) = run_initial_video_import_task(background_state.clone(), &background_task_id).await {
            let _ = mark_task_failed(&background_state, &background_task_id, "processing", &error.message);
        }
    });

    Ok(Json(json!({
      "success": true,
      "data": { "taskId": task_id }
    })))
}

pub(super) async fn api_video_import_tasks(
    State(state): State<BackendState>,
    Query(query): Query<VideoImportTasksQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);
    let conn = db_connection(&state)?;

    let mut sql = "SELECT id, original_filename, source_kind, source_path, status, current_step, progress, error_message, asr_provider, script_model_id, config_json, metadata_json, created_at, updated_at, started_at, completed_at, cancelled_at FROM video_import_tasks".to_string();
    let mut args = Vec::<String>::new();
    if let Some(status) = query.status.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        sql.push_str(" WHERE status = ?1");
        args.push(status.to_string());
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");
    args.push(limit.to_string());
    args.push(offset.to_string());

    let tasks = query_tasks(&conn, &sql, &args)?;
    Ok(Json(json!({
      "success": true,
      "data": { "tasks": tasks.into_iter().map(task_to_json).collect::<Vec<_>>() }
    })))
}

pub(super) async fn api_video_import_task(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, &id)?;
    let artifacts = load_artifacts(&conn, &id)?;
    let step_runs = load_step_runs(&conn, &id)?;
    let subtitle = latest_artifact_text(&conn, &id, "subtitle_txt")?;
    let script = latest_artifact_text(&conn, &id, "script_edited")?
        .or(latest_artifact_text(&conn, &id, "script_draft")?);
    let parse_result = latest_artifact_text(&conn, &id, "parse_result")?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    Ok(Json(json!({
      "success": true,
      "data": {
        "task": task_to_json(task),
        "artifacts": artifacts,
        "stepRuns": step_runs,
        "subtitleText": subtitle,
        "scriptText": script,
        "parseResult": parse_result
      }
    })))
}

pub(super) async fn api_video_import_subtitle_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<VideoImportTextBody>,
) -> Result<Json<Value>, ApiError> {
    let text = body
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "字幕内容不能为空"))?;
    let conn = db_connection(&state)?;
    ensure_task_exists(&conn, &id)?;
    let path = task_dir(&state, &id).join(format!("subtitle-edited-{}.txt", Utc::now().timestamp_millis()));
    write_text_file(&path, text)?;
    insert_artifact(&conn, &id, "subtitle_txt", &path, Some("text/plain"), json!({ "edited": true }))?;
    update_task_status(&conn, &id, "subtitle_ready", "subtitle_ready", 55, None)?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_script_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<VideoImportTextBody>,
) -> Result<Json<Value>, ApiError> {
    let script = body
        .script
        .or(body.text)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "剧本内容不能为空"))?;
    let conn = db_connection(&state)?;
    ensure_task_exists(&conn, &id)?;
    let path = task_dir(&state, &id).join(format!("script-edited-{}.md", Utc::now().timestamp_millis()));
    write_text_file(&path, &script)?;
    insert_artifact(&conn, &id, "script_edited", &path, Some("text/markdown"), json!({ "edited": true }))?;
    update_task_status(&conn, &id, "script_ready", "script_ready", 80, None)?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_generate_script(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, &id)?;
    let subtitle = latest_artifact_text(&conn, &id, "subtitle_txt")?
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请先完成字幕识别或编辑"))?;
    update_task_status(&conn, &id, "generating_script", "generate_script", 65, None)?;
    let run_id = start_step_run(&conn, &id, "generate_script", None)?;
    drop(conn);

    let title = task_title(&task);
    let (script, provider, model_id) = match generate_video_import_script_text(
        &state,
        &title,
        &task.original_filename,
        &subtitle,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &run_id, "failed", None, Some(&error.message), json!({}))?;
            update_task_status(&conn, &id, "failed", "generate_script", 65, Some(&error.message))?;
            return Err(error);
        }
    };

    let conn = db_connection(&state)?;
    let path = task_dir(&state, &id).join("script-draft.md");
    write_text_file(&path, &script)?;
    insert_artifact(
        &conn,
        &id,
        "script_draft",
        &path,
        Some("text/markdown"),
        json!({ "provider": provider, "modelId": model_id }),
    )?;
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "provider": provider, "modelId": model_id }),
    )?;
    conn.execute(
        "UPDATE video_import_tasks SET status = 'script_ready', current_step = 'script_ready', progress = 80, script_model_id = ?1, error_message = NULL, updated_at = ?2 WHERE id = ?3",
        params![model_id, now_iso(), id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "data": { "script": script }
    })))
}

pub(super) async fn api_video_import_import_project(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, &id)?;
    let script = latest_artifact_text(&conn, &id, "script_edited")?
        .or(latest_artifact_text(&conn, &id, "script_draft")?)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请先生成或编辑剧本"))?;
    let config = parse_json_object(&task.config_json);
    let style_id = resolve_import_style_id(&conn, config.get("styleId").and_then(Value::as_str))?;
    let aspect_ratio = config
        .get("aspectRatio")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "16:9" | "9:16" | "1:1"))
        .unwrap_or("16:9")
        .to_string();
    let script_parse_mode = config
        .get("scriptParseMode")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "premium_drama" | "short_drama"))
        .unwrap_or("short_drama")
        .to_string();
    let project_title = config
        .get("projectTitle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| task_title(&task));
    update_task_status(&conn, &id, "importing", "import", 85, None)?;
    let run_id = start_step_run(&conn, &id, "import", None)?;
    drop(conn);

    let create = api_project_create(
        State(state.clone()),
        Json(CreateProjectBody {
            title: project_title.clone(),
            description: Some(format!("从视频导入：{}", task.original_filename)),
            script_parse_mode: Some(script_parse_mode.clone()),
            style_id: Some(style_id.clone()),
            aspect_ratio: Some(aspect_ratio.clone()),
        }),
    )
    .await?;
    let project_id = create
        .0
        .get("project")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "创建项目失败"))?
        .to_string();

    let parsed = match parse_video_import_script(
        state.clone(),
        &project_id,
        &script,
        &script_parse_mode,
        Some(&style_id),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &run_id, "failed", None, Some(&error.message), json!({ "projectId": project_id }))?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
            return Err(error);
        }
    };

    let parsed_data = parsed.get("data").cloned().unwrap_or_else(|| json!({}));
    let scenes = parsed_data
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if scenes.is_empty() {
        let message = "脚本解析结果没有场景，请编辑剧本后重试";
        let conn = db_connection(&state)?;
        finish_step_run(&conn, &run_id, "failed", None, Some(message), json!({ "projectId": project_id }))?;
        update_task_status(&conn, &id, "failed", "import", 85, Some(message))?;
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
    }

    let save_body = build_project_save_body(
        &project_title,
        &task.original_filename,
        &style_id,
        &aspect_ratio,
        &script_parse_mode,
        &script,
        &parsed_data,
    );
    let _ = api_project_put(Path(project_id.clone()), State(state.clone()), Json(save_body)).await?;

    let conn = db_connection(&state)?;
    let parse_path = task_dir(&state, &id).join("parse-result.json");
    write_text_file(&parse_path, &parsed.to_string())?;
    insert_artifact(&conn, &id, "parse_result", &parse_path, Some("application/json"), json!({ "projectId": project_id }))?;
    conn.execute(
        "INSERT OR REPLACE INTO video_import_projects (import_id, project_id, imported_at, metadata_json) VALUES (?1, ?2, ?3, ?4)",
        params![id, project_id, now_iso(), json!({}).to_string()],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    finish_step_run(&conn, &run_id, "success", None, None, json!({ "projectId": project_id }))?;
    update_task_status(&conn, &id, "imported", "imported", 100, None)?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "projectId": project_id,
        "redirectUrl": format!("/projects/{project_id}")
      }
    })))
}

pub(super) async fn api_video_import_retry(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<VideoImportRetryBody>,
) -> Result<Json<Value>, ApiError> {
    let from_step = body.from_step.as_deref().unwrap_or("transcribe");
    match from_step {
        "extract" | "transcribe" => {
            let conn = db_connection(&state)?;
            ensure_task_exists(&conn, &id)?;
            update_task_status(&conn, &id, "pending", "retry", 0, None)?;
            drop(conn);
            let background_state = state.clone();
            let background_task_id = id.clone();
            tokio::spawn(async move {
                if let Err(error) = run_initial_video_import_task(background_state.clone(), &background_task_id).await {
                    let _ = mark_task_failed(&background_state, &background_task_id, "processing", &error.message);
                }
            });
            Ok(Json(json!({ "success": true })))
        }
        "generate_script" => api_video_import_generate_script(Path(id), State(state)).await.map(|_| Json(json!({ "success": true }))),
        "import" => api_video_import_import_project(Path(id), State(state)).await.map(|_| Json(json!({ "success": true }))),
        _ => Err(ApiError::new(StatusCode::BAD_REQUEST, "fromStep 无效")),
    }
}

pub(super) async fn api_video_import_cancel(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    ensure_task_exists(&conn, &id)?;
    conn.execute(
        "UPDATE video_import_tasks SET status = 'cancelled', current_step = 'cancelled', cancelled_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![now_iso(), now_iso(), id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_events() -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let stream = stream::once(async {
        Ok(Event::default()
            .event("ready")
            .data(json!({ "success": true }).to_string()))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn run_initial_video_import_task(state: BackendState, task_id: &str) -> Result<(), ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, task_id)?;
    update_task_status(&conn, task_id, "extracting", "extract", 10, None)?;
    let extract_run_id = start_step_run(&conn, task_id, "extract", None)?;
    drop(conn);

    let audio_path = task_dir(&state, task_id).join("audio.wav");
    match extract_audio(PathBuf::from(&task.source_path), audio_path.clone()).await {
        Ok(()) => {
            let conn = db_connection(&state)?;
            insert_artifact(&conn, task_id, "extracted_audio", &audio_path, Some("audio/wav"), json!({}))?;
            finish_step_run(&conn, &extract_run_id, "success", None, None, json!({}))?;
            update_task_status(&conn, task_id, "transcribing", "transcribe", 35, None)?;
        }
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &extract_run_id, "failed", None, Some(&error.message), json!({}))?;
            update_task_status(&conn, task_id, "failed", "extract", 10, Some(&error.message))?;
            return Err(error);
        }
    }

    let conn = db_connection(&state)?;
    let asr_run_id = start_step_run(&conn, task_id, "transcribe", Some("bcut"))?;
    drop(conn);

    let output = match transcribe_bcut(audio_path.clone()).await {
        Ok(value) => value,
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &asr_run_id, "failed", None, Some(&error.message), json!({}))?;
            update_task_status(&conn, task_id, "failed", "transcribe", 45, Some(&error.message))?;
            return Err(error);
        }
    };

    let conn = db_connection(&state)?;
    let raw_path = task_dir(&state, task_id).join("asr-raw.json");
    let txt_path = task_dir(&state, task_id).join("subtitle.txt");
    let srt_path = task_dir(&state, task_id).join("subtitle.srt");
    write_text_file(&raw_path, &output.raw.to_string())?;
    write_text_file(&txt_path, &output.text)?;
    write_text_file(&srt_path, &output.srt)?;
    insert_artifact(
        &conn,
        task_id,
        "asr_raw_json",
        &raw_path,
        Some("application/json"),
        json!({ "taskId": output.task_id }),
    )?;
    insert_artifact(
        &conn,
        task_id,
        "subtitle_txt",
        &txt_path,
        Some("text/plain"),
        json!({ "segmentCount": output.segments.len(), "taskId": output.task_id }),
    )?;
    insert_artifact(
        &conn,
        task_id,
        "subtitle_srt",
        &srt_path,
        Some("application/x-subrip"),
        json!({ "segmentCount": output.segments.len(), "taskId": output.task_id }),
    )?;
    finish_step_run(&conn, &asr_run_id, "success", Some(&output.task_id), None, json!({ "segmentCount": output.segments.len() }))?;
    update_task_status(&conn, task_id, "subtitle_ready", "subtitle_ready", 55, None)?;
    let _ = task;
    Ok(())
}

async fn extract_audio(video_path: PathBuf, audio_path: PathBuf) -> Result<(), ApiError> {
    let ffmpeg = std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string());
    tokio::task::spawn_blocking(move || {
        let output = Command::new(ffmpeg)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-i")
            .arg(video_path)
            .arg("-vn")
            .arg("-ac")
            .arg("1")
            .arg("-ar")
            .arg("16000")
            .arg("-c:a")
            .arg("pcm_s16le")
            .arg(audio_path)
            .output()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("启动 ffmpeg 失败: {error}")))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("ffmpeg 提取音频失败: {}", stderr.trim()),
            ))
        }
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
}

async fn transcribe_bcut(audio_path: PathBuf) -> Result<BcutOutput, ApiError> {
    let mut file = File::open(&audio_path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if bytes.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "音频文件为空"));
    }
    let sound_name = audio_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio.wav")
        .to_string();
    let sound_fmt = file_extension(&sound_name).unwrap_or_else(|| "wav".to_string());
    let client = Client::new();

    let create_payload = bcut_api::<Value>(
        &client,
        reqwest::Method::POST,
        &format!("{BCUT_BASE_URL}/resource/create"),
        Some(&[
            ("type", "2".to_string()),
            ("name", sound_name),
            ("size", bytes.len().to_string()),
            ("resource_file_type", sound_fmt),
            ("model_id", BCUT_MODEL_ID.to_string()),
        ]),
        None,
    )
    .await?;
    let in_boss_key = json_str(&create_payload, "in_boss_key")?;
    let resource_id = json_str(&create_payload, "resource_id")?;
    let upload_id = json_str(&create_payload, "upload_id")?;
    let per_size = create_payload
        .get("per_size")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 返回了无效分片大小"))? as usize;
    let upload_urls = create_payload
        .get("upload_urls")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 未返回上传地址"))?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if upload_urls.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 未返回上传地址"));
    }

    let mut etags = Vec::new();
    for (index, url) in upload_urls.iter().enumerate() {
        let start = index * per_size;
        let end = ((index + 1) * per_size).min(bytes.len());
        if start >= end {
            continue;
        }
        let response = client
            .put(url)
            .header(USER_AGENT, BCUT_USER_AGENT)
            .body(bytes[start..end].to_vec())
            .send()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
        if !response.status().is_success() {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("Bcut ASR 上传分片失败: HTTP {}", response.status()),
            ));
        }
        etags.push(
            response
                .headers()
                .get("etag")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string(),
        );
    }

    let complete_payload = bcut_api::<Value>(
        &client,
        reqwest::Method::POST,
        &format!("{BCUT_BASE_URL}/resource/create/complete"),
        Some(&[
            ("in_boss_key", in_boss_key),
            ("resource_id", resource_id),
            ("etags", etags.join(",")),
            ("upload_id", upload_id),
            ("model_id", BCUT_MODEL_ID.to_string()),
        ]),
        None,
    )
    .await?;
    let download_url = json_str(&complete_payload, "download_url")?;

    let task_payload = bcut_api::<Value>(
        &client,
        reqwest::Method::POST,
        &format!("{BCUT_BASE_URL}/task"),
        None,
        Some(json!({ "resource": download_url, "model_id": BCUT_MODEL_ID })),
    )
    .await?;
    let task_id = json_str(&task_payload, "task_id")?;
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_millis(ASR_TIMEOUT_MS) {
            return Err(ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 识别超时"));
        }
        tokio::time::sleep(Duration::from_millis(ASR_POLL_INTERVAL_MS)).await;
        let url = format!("{BCUT_BASE_URL}/task/result?model_id={BCUT_MODEL_ID}&task_id={task_id}");
        let result_payload = bcut_api::<Value>(&client, reqwest::Method::GET, &url, None, None).await?;
        let state = result_payload.get("state").and_then(Value::as_i64).unwrap_or(-1);
        if state == 4 {
            let raw = match result_payload.get("result") {
                Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
                    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?,
                Some(value) => value.clone(),
                None => return Err(ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 结果为空")),
            };
            let segments = parse_bcut_segments(&raw)?;
            return Ok(BcutOutput {
                task_id,
                text: segments
                    .iter()
                    .map(|segment| segment.transcript.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
                srt: segments_to_srt(&segments),
                raw,
                segments,
            });
        }
        if state == 3 {
            let remark = result_payload.get("remark").and_then(Value::as_str).unwrap_or("");
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("Bcut ASR 识别失败: {remark}"),
            ));
        }
    }
}

async fn bcut_api<T: serde::de::DeserializeOwned>(
    client: &Client,
    method: reqwest::Method,
    url: &str,
    form: Option<&[(&str, String)]>,
    json_body: Option<Value>,
) -> Result<T, ApiError> {
    let mut request = client.request(method, url).header(USER_AGENT, BCUT_USER_AGENT);
    if let Some(form) = form {
        let form_pairs = form
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect::<Vec<_>>();
        request = request.form(&form_pairs);
    }
    if let Some(body) = json_body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("Bcut ASR 请求失败: HTTP {status}"),
        ));
    }
    if payload.get("code").and_then(Value::as_i64) != Some(0) {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("Bcut ASR 错误: {message}"),
        ));
    }
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    serde_json::from_value::<T>(data)
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))
}

fn build_project_save_body(
    project_title: &str,
    source_filename: &str,
    style_id: &str,
    aspect_ratio: &str,
    script_parse_mode: &str,
    script: &str,
    parsed_data: &Value,
) -> Value {
    let scenes = parsed_data
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let characters = parsed_data
        .get("characters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, character)| {
            let name = character
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("未命名角色");
            json!({
              "id": character.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("import_char_{}", index + 1)),
              "name": name,
              "role": character.get("role").and_then(Value::as_str).unwrap_or("supporting"),
              "appearance": character.get("appearance").or_else(|| character.get("description")).and_then(Value::as_str).unwrap_or(name),
              "gender": character.get("gender").and_then(Value::as_str),
              "personality": character.get("personality").and_then(Value::as_str),
              "traits": character.get("traits").cloned().unwrap_or(Value::Null)
            })
        })
        .collect::<Vec<_>>();

    json!({
      "name": project_title,
      "description": format!("从视频导入：{source_filename}"),
      "status": "in_progress",
      "styleId": style_id,
      "aspectRatio": aspect_ratio,
      "scriptParseMode": script_parse_mode,
      "storyIdea": script,
      "novelText": "",
      "rawText": script,
      "selectedStyleId": style_id,
      "inputMode": "script",
      "episodePlan": [],
      "scenes": scenes,
      "characters": characters
    })
}

fn task_to_json(task: VideoImportTaskRecord) -> Value {
    json!({
      "id": task.id,
      "originalFilename": task.original_filename,
      "sourceKind": task.source_kind,
      "sourcePath": task.source_path,
      "status": task.status,
      "currentStep": task.current_step,
      "progress": task.progress,
      "errorMessage": task.error_message,
      "asrProvider": task.asr_provider,
      "scriptModelId": task.script_model_id,
      "config": parse_json_object(&task.config_json),
      "metadata": parse_json_object(&task.metadata_json),
      "createdAt": task.created_at,
      "updatedAt": task.updated_at,
      "startedAt": task.started_at,
      "completedAt": task.completed_at,
      "cancelledAt": task.cancelled_at
    })
}

fn query_tasks(conn: &Connection, sql: &str, args: &[String]) -> Result<Vec<VideoImportTaskRecord>, ApiError> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), task_from_row)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(rows)
}

fn load_task(conn: &Connection, id: &str) -> Result<VideoImportTaskRecord, ApiError> {
    conn.query_row(
        "SELECT id, original_filename, source_kind, source_path, status, current_step, progress, error_message, asr_provider, script_model_id, config_json, metadata_json, created_at, updated_at, started_at, completed_at, cancelled_at FROM video_import_tasks WHERE id = ?1 LIMIT 1",
        params![id],
        task_from_row,
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "视频导入任务不存在"))
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VideoImportTaskRecord> {
    Ok(VideoImportTaskRecord {
        id: row.get(0)?,
        original_filename: row.get(1)?,
        source_kind: row.get(2)?,
        source_path: row.get(3)?,
        status: row.get(4)?,
        current_step: row.get(5)?,
        progress: row.get(6)?,
        error_message: row.get(7)?,
        asr_provider: row.get(8)?,
        script_model_id: row.get(9)?,
        config_json: row.get(10)?,
        metadata_json: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        started_at: row.get(14)?,
        completed_at: row.get(15)?,
        cancelled_at: row.get(16)?,
    })
}

fn load_artifacts(conn: &Connection, task_id: &str) -> Result<Vec<VideoImportArtifactView>, ApiError> {
    let mut stmt = conn
        .prepare("SELECT id, task_id, kind, path, mime_type, size_bytes, sha256, metadata_json, created_at FROM video_import_artifacts WHERE task_id = ?1 ORDER BY created_at DESC")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt.query_map(params![task_id], |row| {
        let metadata_raw: String = row.get(7)?;
        Ok(VideoImportArtifactView {
            id: row.get(0)?,
            task_id: row.get(1)?,
            kind: row.get(2)?,
            path: row.get(3)?,
            mime_type: row.get(4)?,
            size_bytes: row.get(5)?,
            sha256: row.get(6)?,
            metadata: parse_json_object(&metadata_raw),
            created_at: row.get(8)?,
        })
    })
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(rows)
}

fn load_step_runs(conn: &Connection, task_id: &str) -> Result<Vec<VideoImportStepRunView>, ApiError> {
    let mut stmt = conn
        .prepare("SELECT id, task_id, step, attempt, status, started_at, ended_at, duration_ms, provider, external_task_id, error_message, metadata_json FROM video_import_step_runs WHERE task_id = ?1 ORDER BY started_at DESC LIMIT 20")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt.query_map(params![task_id], |row| {
        let metadata_raw: String = row.get(11)?;
        Ok(VideoImportStepRunView {
            id: row.get(0)?,
            task_id: row.get(1)?,
            step: row.get(2)?,
            attempt: row.get(3)?,
            status: row.get(4)?,
            started_at: row.get(5)?,
            ended_at: row.get(6)?,
            duration_ms: row.get(7)?,
            provider: row.get(8)?,
            external_task_id: row.get(9)?,
            error_message: row.get(10)?,
            metadata: parse_json_object(&metadata_raw),
        })
    })
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(rows)
}

fn latest_artifact_text(conn: &Connection, task_id: &str, kind: &str) -> Result<Option<String>, ApiError> {
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM video_import_artifacts WHERE task_id = ?1 AND kind = ?2 ORDER BY created_at DESC LIMIT 1",
            params![task_id, kind],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    match path {
        Some(path) => fs::read_to_string(path)
            .map(Some)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())),
        None => Ok(None),
    }
}

fn insert_artifact(
    conn: &Connection,
    task_id: &str,
    kind: &str,
    path: &FsPath,
    mime_type: Option<&str>,
    metadata: Value,
) -> Result<(), ApiError> {
    let bytes = fs::read(path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());
    conn.execute(
        "INSERT INTO video_import_artifacts (id, task_id, kind, path, mime_type, size_bytes, sha256, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            format!("artifact_{}", Uuid::new_v4().simple()),
            task_id,
            kind,
            path.to_string_lossy().to_string(),
            mime_type,
            bytes.len() as i64,
            sha256,
            metadata.to_string(),
            now_iso()
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn start_step_run(conn: &Connection, task_id: &str, step: &str, provider: Option<&str>) -> Result<String, ApiError> {
    let attempt: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(attempt), 0) + 1 FROM video_import_step_runs WHERE task_id = ?1 AND step = ?2",
            params![task_id, step],
            |row| row.get(0),
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let id = format!("step_{}", Uuid::new_v4().simple());
    conn.execute(
        "INSERT INTO video_import_step_runs (id, task_id, step, attempt, status, started_at, provider, metadata_json)
         VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, '{}')",
        params![id, task_id, step, attempt, now_iso(), provider],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(id)
}

fn finish_step_run(
    conn: &Connection,
    id: &str,
    status: &str,
    external_task_id: Option<&str>,
    error_message: Option<&str>,
    metadata: Value,
) -> Result<(), ApiError> {
    let ended_at = now_iso();
    conn.execute(
        "UPDATE video_import_step_runs
         SET status = ?1, ended_at = ?2, duration_ms = CAST((julianday(?2) - julianday(started_at)) * 86400000 AS INTEGER),
             external_task_id = ?3, error_message = ?4, metadata_json = ?5
         WHERE id = ?6",
        params![status, ended_at, external_task_id, error_message, metadata.to_string(), id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn update_task_status(
    conn: &Connection,
    task_id: &str,
    status: &str,
    current_step: &str,
    progress: i64,
    error_message: Option<&str>,
) -> Result<(), ApiError> {
    let now = now_iso();
    let completed_at = if matches!(status, "imported" | "failed") {
        Some(now.clone())
    } else {
        None
    };
    conn.execute(
        "UPDATE video_import_tasks
         SET status = ?1, current_step = ?2, progress = ?3, error_message = ?4,
             started_at = COALESCE(started_at, ?5), completed_at = ?6, updated_at = ?7
         WHERE id = ?8",
        params![status, current_step, progress, error_message, now, completed_at, now, task_id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn mark_task_failed(state: &BackendState, task_id: &str, step: &str, message: &str) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    update_task_status(&conn, task_id, "failed", step, 0, Some(message))
}

fn ensure_task_exists(conn: &Connection, id: &str) -> Result<(), ApiError> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM video_import_tasks WHERE id = ?1 LIMIT 1",
            params![id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::NOT_FOUND, "视频导入任务不存在"))
    }
}

fn resolve_import_style_id(conn: &Connection, requested: Option<&str>) -> Result<String, ApiError> {
    if let Some(style_id) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        if is_style_id_enabled(conn, style_id)? {
            return Ok(style_id.to_string());
        }
    }
    let default_catalog = default_style_catalog();
    let config = get_config_json(conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        })
    });
    let default_id = config
        .get("defaultStyleId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            config
                .get("enabledStyleIds")
                .and_then(Value::as_array)
                .and_then(|items| items.iter().find_map(Value::as_str))
        })
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请先配置可用画风预设"))?;
    Ok(default_id.to_string())
}

fn parse_bcut_segments(raw: &Value) -> Result<Vec<BcutSegment>, ApiError> {
    let utterances = raw
        .get("utterances")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 结果格式无效"))?;
    let segments = utterances
        .iter()
        .filter_map(|item| {
            let transcript = item.get("transcript")?.as_str()?.trim().to_string();
            if transcript.is_empty() {
                return None;
            }
            Some(BcutSegment {
                start_time: item.get("start_time").and_then(Value::as_i64).unwrap_or(0),
                end_time: item.get("end_time").and_then(Value::as_i64).unwrap_or(0),
                transcript,
            })
        })
        .collect::<Vec<_>>();
    if segments.is_empty() {
        Err(ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 未识别到字幕"))
    } else {
        Ok(segments)
    }
}

fn segments_to_srt(segments: &[BcutSegment]) -> String {
    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                ms_to_srt(segment.start_time),
                ms_to_srt(segment.end_time),
                segment.transcript
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn ms_to_srt(ms: i64) -> String {
    let safe = ms.max(0);
    let hours = safe / 3_600_000;
    let minutes = (safe % 3_600_000) / 60_000;
    let seconds = (safe % 60_000) / 1_000;
    let millis = safe % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

fn json_str(value: &Value, key: &str) -> Result<String, ApiError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, format!("Bcut ASR 缺少字段: {key}")))
}

fn write_text_file(path: &FsPath, text: &str) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    fs::write(path, text)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn task_dir(state: &BackendState, task_id: &str) -> PathBuf {
    state.data_dir.join(VIDEO_IMPORT_DIR).join(task_id)
}

fn task_title(task: &VideoImportTaskRecord) -> String {
    let config = parse_json_object(&task.config_json);
    config
        .get("projectTitle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let stem = task
                .original_filename
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or(&task.original_filename);
            stem.to_string()
        })
}

fn parse_json_object(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn file_extension(filename: &str) -> Option<String> {
    filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn validate_video_extension(extension: &str) -> Result<(), ApiError> {
    if matches!(
        extension,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "flv" | "wmv" | "m4v" | "mpeg" | "mpg" | "ts" | "m2ts" | "mts" | "3gp"
    ) {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的视频格式"))
    }
}
