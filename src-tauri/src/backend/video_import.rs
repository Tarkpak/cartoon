use super::*;
use crate::process_util::hidden_command;
use axum::extract::Multipart;
use axum::response::sse::{Event, KeepAlive, Sse};
use chrono::Utc;
use futures_util::{stream, StreamExt, TryStreamExt};
use reqwest::header::USER_AGENT;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const BCUT_BASE_URL: &str = "https://member.bilibili.com/x/bcut/rubick-interface";
const BCUT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const BCUT_MODEL_ID: &str = "7";
const VIDEO_IMPORT_DIR: &str = "video-import";
const ASR_TOOL_DIR: &str = "asr-tool";
const ASR_HISTORY_DIR: &str = "history";
const ASR_POLL_INTERVAL_MS: u64 = 2_000;
const ASR_TIMEOUT_MS: u64 = 600_000;
const BCUT_UPLOAD_MAX_ATTEMPTS: usize = 3;
const BCUT_UPLOAD_RETRY_BASE_DELAY_MS: u64 = 1_000;
const SERIES_IMPORT_MAX_CONCURRENT_TASKS: usize = 2;
const SHORT_CLIP_MAX_SECONDS: f64 = 60.0;
const SHORT_CLIP_MIN_RATIO: f64 = 0.6;
const SHORT_CLIP_SCRIPT_CHUNK_MAX_CHARS: usize = 6_000;
const SHORT_CLIP_SCRIPT_CHUNK_MAX_EPISODES: usize = 12;
const SHORT_CLIP_SCRIPT_BOUNDARY_CONTEXT_CHARS: usize = 800;
const SERIES_SCRIPT_MAX_CONCURRENT_GENERATIONS: usize = 3;
const VIDEO_IMPORT_PARSE_TIMEOUT_MS: u64 = 300_000;

#[derive(Debug, Clone)]
struct SeriesSubtitleSection {
    episode_number: i64,
    title: String,
    subtitle: String,
}

#[derive(Debug)]
struct SeriesSubtitleChunk {
    episode_numbers: Vec<i64>,
    text: String,
}

fn normalize_video_import_script_parse_mode(value: Option<&str>) -> &'static str {
    match value.map(str::trim) {
        Some("origin_explainer") => "origin_explainer",
        _ => "premium_drama",
    }
}

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

#[derive(Debug, Deserialize)]
pub(super) struct VideoImportImportBody {
    #[serde(rename = "projectTitle")]
    project_title: Option<String>,
    #[serde(rename = "styleId")]
    style_id: Option<String>,
    #[serde(rename = "aspectRatio")]
    aspect_ratio: Option<String>,
    #[serde(rename = "scriptParseMode")]
    script_parse_mode: Option<String>,
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
    series_id: Option<String>,
    episode_number: Option<i64>,
    is_series_group: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BcutSegment {
    pub(super) start_time: i64,
    pub(super) end_time: i64,
    pub(super) transcript: String,
}

pub(super) struct BcutOutput {
    task_id: String,
    raw: Value,
    text: String,
    srt: String,
    pub(super) segments: Vec<BcutSegment>,
}

struct SeriesDurationSummary {
    known_count: usize,
    short_count: usize,
    total_seconds: f64,
    average_seconds: Option<f64>,
    short_clip_recommended: bool,
}

pub(super) async fn api_asr_transcribe(
    State(state): State<BackendState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let request_id = format!("asr_{}", Uuid::new_v4().simple());
    let request_dir = state.data_dir.join(ASR_TOOL_DIR).join(&request_id);
    fs::create_dir_all(&request_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let result = async {
        let mut original_filename = String::new();
        let mut media_extension = String::new();
        let mut source_path: Option<PathBuf> = None;

        while let Some(mut field) = multipart
            .next_field()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
        {
            if field.name().unwrap_or("") != "media" {
                continue;
            }

            let filename = field
                .file_name()
                .map(str::to_string)
                .unwrap_or_else(|| "media.mp3".to_string());
            let extension = file_extension(&filename)
                .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无法识别文件格式"))?;
            validate_asr_media_extension(&extension)?;
            original_filename = filename;
            media_extension = extension.clone();

            let output_path = request_dir.join(format!("source.{extension}"));
            let mut file = File::create(&output_path).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
            {
                file.write_all(&chunk).map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            }
            source_path = Some(output_path);
            break;
        }

        let source_path = source_path
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "缺少 media 文件字段"))?;
        let file_size_bytes = fs::metadata(&source_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let audio_path = request_dir.join("audio.wav");
        extract_audio(source_path, audio_path.clone())
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "无法读取媒体中的声音，请确认文件可以正常播放",
                )
            })?;
        let output = transcribe_bcut(audio_path).await.map_err(|error| {
            ApiError::new(
                error.status,
                error
                    .message
                    .replace("Bcut ASR", "语音识别")
                    .replace("Bcut", "语音识别")
                    .replace("ASR", "语音识别"),
            )
        })?;
        let duration_ms = output
            .segments
            .iter()
            .map(|segment| segment.end_time)
            .max()
            .unwrap_or(0);
        let segment_count = output.segments.len();
        let created_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let data = json!({
          "id": request_id.clone(),
          "taskId": output.task_id,
          "fileName": original_filename,
          "mediaKind": asr_media_kind(&media_extension),
          "fileSizeBytes": file_size_bytes,
          "text": output.text,
          "srt": output.srt,
          "segments": output.segments,
          "segmentCount": segment_count,
          "durationMs": duration_ms,
          "createdAt": created_at
        });
        write_asr_history_item(&state, &request_id, &data)?;

        Ok(Json(json!({
          "success": true,
          "data": data
        })))
    }
    .await;

    let _ = fs::remove_dir_all(&request_dir);
    result
}

pub(super) async fn api_asr_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let history_dir = state.data_dir.join(ASR_TOOL_DIR).join(ASR_HISTORY_DIR);
    let mut items = Vec::new();
    if history_dir.exists() {
        for entry in fs::read_dir(&history_dir)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        {
            let entry = entry.map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = fs::read(path) else {
                continue;
            };
            if let Ok(item) = serde_json::from_slice::<Value>(&bytes) {
                items.push(item);
            }
        }
    }
    items.sort_by(|left, right| {
        let left_created = left.get("createdAt").and_then(Value::as_str).unwrap_or("");
        let right_created = right.get("createdAt").and_then(Value::as_str).unwrap_or("");
        right_created.cmp(left_created)
    });

    Ok(Json(json!({
      "success": true,
      "data": { "items": items }
    })))
}

pub(super) async fn api_asr_history_delete(
    State(state): State<BackendState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    validate_asr_history_id(&id)?;
    let path = state
        .data_dir
        .join(ASR_TOOL_DIR)
        .join(ASR_HISTORY_DIR)
        .join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(Json(json!({ "success": true })))
}

fn write_asr_history_item(state: &BackendState, id: &str, item: &Value) -> Result<(), ApiError> {
    validate_asr_history_id(id)?;
    let history_dir = state.data_dir.join(ASR_TOOL_DIR).join(ASR_HISTORY_DIR);
    fs::create_dir_all(&history_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let path = history_dir.join(format!("{id}.json"));
    let temporary_path = history_dir.join(format!("{id}.json.tmp"));
    let bytes = serde_json::to_vec_pretty(item)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::write(&temporary_path, bytes)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::rename(temporary_path, path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn validate_asr_history_id(id: &str) -> Result<(), ApiError> {
    if id.starts_with("asr_")
        && id.len() <= 64
        && id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '_')
    {
        return Ok(());
    }
    Err(ApiError::new(StatusCode::BAD_REQUEST, "无效的历史记录 ID"))
}

fn asr_media_kind(extension: &str) -> &'static str {
    if matches!(
        extension,
        "mp4"
            | "mov"
            | "mkv"
            | "avi"
            | "webm"
            | "flv"
            | "wmv"
            | "m4v"
            | "mpeg"
            | "mpg"
            | "ts"
            | "m2ts"
            | "mts"
            | "3gp"
    ) {
        "video"
    } else {
        "audio"
    }
}

impl SeriesDurationSummary {
    fn to_json(&self) -> Value {
        json!({
            "knownCount": self.known_count,
            "shortCount": self.short_count,
            "totalSeconds": self.total_seconds,
            "averageSeconds": self.average_seconds,
            "shortClipRecommended": self.short_clip_recommended
        })
    }
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
            file.write_all(&chunk).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
        }
        source_path = Some(output_path);
    }

    let source_path =
        source_path.ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "缺少 video 文件字段"))?;
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
        if let Err(error) =
            run_initial_video_import_task(background_state.clone(), &background_task_id).await
        {
            let _ = mark_task_failed(
                &background_state,
                &background_task_id,
                "processing",
                &error.message,
            );
        }
    });

    Ok(Json(json!({
      "success": true,
      "data": { "taskId": task_id }
    })))
}

pub(super) async fn api_video_import_upload_series(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let folder_path = body
        .get("folderPath")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "folderPath is required"))?;

    let config = body
        .get("config")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let project_title = config
        .get("projectTitle")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let aspect_ratio = config
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or("9:16");
    let script_parse_mode = normalize_video_import_script_parse_mode(
        config.get("scriptParseMode").and_then(Value::as_str),
    );

    let folder = FsPath::new(folder_path);
    let video_files = scan_series_video_files(folder)?;

    if video_files.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "文件夹中没有找到视频文件",
        ));
    }
    let duration_summary = build_series_duration_summary(&video_files);
    let series_import_mode = if duration_summary.short_clip_recommended {
        "short_clips"
    } else {
        "episodes"
    };

    // Create series group task
    let series_id = format!("vimp_series_{}", Uuid::new_v4().simple());
    let series_title = if project_title.is_empty() {
        folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("未命名剧集")
            .to_string()
    } else {
        project_title.to_string()
    };

    let conn = db_connection(&state)?;
    let now = now_iso();

    // Create series group record
    conn.execute(
        "INSERT INTO video_import_tasks (id, original_filename, source_kind, source_path, status, current_step, progress, asr_provider, config_json, metadata_json, created_at, updated_at, is_series_group, series_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            &series_id,
            &series_title,
            "folder",
            folder_path,
            "pending",
            "created",
            0,
            "bcut",
            json!({
                "projectTitle": series_title,
                "aspectRatio": aspect_ratio,
                "scriptParseMode": script_parse_mode,
                "episodeCount": video_files.len(),
                "seriesImportMode": series_import_mode,
                "durationSummary": duration_summary.to_json()
            }).to_string(),
            "{}",
            &now,
            &now,
            1,
            &series_id
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    // Create episode tasks
    let mut episode_ids = Vec::new();
    let semaphore = Arc::new(tokio::sync::Semaphore::new(
        SERIES_IMPORT_MAX_CONCURRENT_TASKS,
    ));
    for (idx, (filename, path)) in video_files.iter().enumerate() {
        let episode_id = format!("vimp_{}", Uuid::new_v4().simple());
        let episode_dir = state.data_dir.join(VIDEO_IMPORT_DIR).join(&episode_id);
        fs::create_dir_all(&episode_dir)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        let dest_path = episode_dir.join(filename);
        conn.execute(
            "INSERT INTO video_import_tasks (id, original_filename, source_kind, source_path, status, current_step, progress, asr_provider, config_json, metadata_json, created_at, updated_at, series_id, episode_number, is_series_group) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                &episode_id,
                filename,
                "folder",
                dest_path.to_string_lossy().to_string(),
                "pending",
                "created",
                0,
                "bcut",
                json!({
                    "projectTitle": format!("{} - 第{}集", series_title, idx + 1),
                    "aspectRatio": aspect_ratio,
                    "scriptParseMode": script_parse_mode
                }).to_string(),
                "{}",
                &now,
                &now,
                &series_id,
                (idx + 1) as i64,
                0
            ],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        let copy_run_id = start_step_run(&conn, &episode_id, "copy_source", None)?;
        if let Err(error) = fs::copy(path, &dest_path) {
            let message = format!("复制视频文件失败: {}", error);
            finish_step_run(
                &conn,
                &copy_run_id,
                "failed",
                None,
                Some(&message),
                json!({ "sourcePath": path.to_string_lossy(), "destPath": dest_path.to_string_lossy() }),
            )?;
            update_task_status(
                &conn,
                &episode_id,
                "failed",
                "copy_source",
                0,
                Some(&message),
            )?;
            return Err(ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message));
        }
        finish_step_run(
            &conn,
            &copy_run_id,
            "success",
            None,
            None,
            json!({ "sourcePath": path.to_string_lossy(), "destPath": dest_path.to_string_lossy() }),
        )?;
        insert_artifact(
            &conn,
            &episode_id,
            "source_video",
            &dest_path,
            Some("video/mp4"),
            json!({ "originalFilename": filename, "seriesId": series_id.as_str(), "episodeNumber": idx + 1 }),
        )?;

        episode_ids.push(episode_id.clone());

        // Start processing episode
        let state_clone = state.clone();
        let semaphore_clone = Arc::clone(&semaphore);
        tokio::spawn(async move {
            let _permit = semaphore_clone.acquire_owned().await.ok();
            if let Err(error) =
                run_initial_video_import_task(state_clone.clone(), &episode_id).await
            {
                let _ = mark_task_failed(&state_clone, &episode_id, "processing", &error.message);
            }
        });
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "seriesId": series_id,
            "episodeIds": episode_ids,
            "episodeCount": video_files.len()
        }
    })))
}

pub(super) async fn api_video_import_preview_series(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let folder_path = body
        .get("folderPath")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "folderPath is required"))?;
    let folder = FsPath::new(folder_path);
    let video_files = scan_series_video_files(folder)?;
    let duration_summary = build_series_duration_summary(&video_files);
    let _ = insert_app_log(
        &state,
        "info",
        "video_import",
        "preview_series",
        "预检剧集文件夹",
        None,
        None,
        None,
        None,
        None,
        Some(&json!({
            "folderPath": folder_path,
            "episodeCount": video_files.len(),
            "shortClipRecommended": duration_summary.short_clip_recommended
        })),
        None,
    );

    let files = video_files
        .iter()
        .enumerate()
        .map(|(index, (filename, path))| {
            let size_bytes = fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let duration_seconds = probe_video_duration_seconds(path).ok().flatten();
            json!({
                "episodeNumber": index + 1,
                "filename": filename,
                "path": path.to_string_lossy(),
                "sizeBytes": size_bytes,
                "durationSeconds": duration_seconds
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "success": true,
        "data": {
            "folderPath": folder_path,
            "episodeCount": files.len(),
            "seriesImportMode": if duration_summary.short_clip_recommended { "short_clips" } else { "episodes" },
            "shortClipRecommended": duration_summary.short_clip_recommended,
            "durationSummary": duration_summary.to_json(),
            "files": files
        }
    })))
}

pub(super) async fn api_video_import_tasks(
    State(state): State<BackendState>,
    Query(query): Query<VideoImportTasksQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);
    let conn = db_connection(&state)?;
    refresh_all_series_group_status(&conn)?;

    let mut sql = "SELECT id, original_filename, source_kind, source_path, status, current_step, progress, error_message, asr_provider, script_model_id, config_json, metadata_json, created_at, updated_at, started_at, completed_at, cancelled_at, series_id, episode_number, is_series_group FROM video_import_tasks WHERE (is_series_group = 1 OR series_id IS NULL)".to_string();
    let mut args = Vec::<String>::new();
    if let Some(status) = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" AND status = ?1");
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
    refresh_series_group_status(&conn, &id)?;
    let task = load_task(&conn, &id)?;
    let artifacts = load_artifacts(&conn, &id)?;
    let step_runs = load_step_runs(&conn, &id)?;
    let episodes = if task.is_series_group != 0 {
        load_series_episode_tasks(&conn, &id)?
            .into_iter()
            .map(task_to_json)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let subtitle = if task.is_series_group != 0 {
        Some(build_series_subtitle_text(&conn, &id)?)
    } else {
        latest_artifact_text(&conn, &id, "subtitle_txt")?
    };
    let script = latest_artifact_text(&conn, &id, "script_edited")?.or(latest_artifact_text(
        &conn,
        &id,
        "script_draft",
    )?);
    let parse_result = latest_artifact_text(&conn, &id, "parse_result")?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    Ok(Json(json!({
      "success": true,
      "data": {
        "task": task_to_json(task),
        "artifacts": artifacts,
        "stepRuns": step_runs,
        "episodes": episodes,
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
    let run_id = start_step_run(&conn, &id, "edit_subtitle", None)?;
    let path = task_dir(&state, &id).join(format!(
        "subtitle-edited-{}.txt",
        Utc::now().timestamp_millis()
    ));
    if let Err(error) = write_text_file(&path, text) {
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({}),
        )?;
        return Err(error);
    }
    if let Err(error) = insert_artifact(
        &conn,
        &id,
        "subtitle_txt",
        &path,
        Some("text/plain"),
        json!({ "edited": true }),
    ) {
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({}),
        )?;
        return Err(error);
    }
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "path": path.to_string_lossy() }),
    )?;
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
    let run_id = start_step_run(&conn, &id, "edit_script", None)?;
    let path = task_dir(&state, &id).join(format!(
        "script-edited-{}.md",
        Utc::now().timestamp_millis()
    ));
    if let Err(error) = write_text_file(&path, &script) {
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({}),
        )?;
        return Err(error);
    }
    if let Err(error) = insert_artifact(
        &conn,
        &id,
        "script_edited",
        &path,
        Some("text/markdown"),
        json!({ "edited": true }),
    ) {
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({}),
        )?;
        return Err(error);
    }
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "path": path.to_string_lossy() }),
    )?;
    update_task_status(&conn, &id, "script_ready", "script_ready", 80, None)?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_generate_script(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, &id)?;
    if task.is_series_group != 0 {
        drop(conn);
        return api_video_import_generate_series_script(state, id, task).await;
    }
    let subtitle = latest_artifact_text(&conn, &id, "subtitle_txt")?
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请先完成字幕识别或编辑"))?;
    update_task_status(&conn, &id, "generating_script", "generate_script", 65, None)?;
    let run_id = start_step_run(&conn, &id, "generate_script", None)?;
    drop(conn);

    let title = task_title(&task);
    let script_parse_mode = normalize_video_import_script_parse_mode(
        parse_json_object(&task.config_json)
            .get("scriptParseMode")
            .and_then(Value::as_str),
    );
    let (script, provider, model_id) = match generate_video_import_script_text(
        &state,
        &title,
        &task.original_filename,
        &subtitle,
        script_parse_mode,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            update_task_status(
                &conn,
                &id,
                "failed",
                "generate_script",
                65,
                Some(&error.message),
            )?;
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

async fn api_video_import_generate_series_script(
    state: BackendState,
    id: String,
    task: VideoImportTaskRecord,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let episodes = load_series_episode_tasks(&conn, &id)?;
    if episodes.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "剧集任务没有可处理的分集",
        ));
    }
    update_task_status(&conn, &id, "generating_script", "generate_script", 65, None)?;
    let run_id = start_step_run(&conn, &id, "generate_script", None)?;
    let short_clip_mode = is_short_clip_series_task(&task);
    if short_clip_mode {
        let subtitle_sections = build_series_subtitle_sections(&conn, &id)?;
        let complete_subtitle = subtitle_sections
            .iter()
            .cloned()
            .map(format_series_subtitle_section)
            .collect::<Vec<_>>()
            .join("\n\n");
        let subtitle_chunks = split_series_subtitle_chunks(subtitle_sections);
        drop(conn);
        let title = task_title(&task);
        let script_parse_mode = normalize_video_import_script_parse_mode(
            parse_json_object(&task.config_json)
                .get("scriptParseMode")
                .and_then(Value::as_str),
        );
        let chunk_count = subtitle_chunks.len();
        let (global_context, _, _) = match generate_video_import_series_context_text(
            &state,
            &title,
            &task.original_filename,
            &complete_subtitle,
            script_parse_mode,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => {
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&error.message),
                    json!({ "mode": "short_clips", "stage": "global_context" }),
                )?;
                update_task_status(
                    &conn,
                    &id,
                    "failed",
                    "generate_script",
                    65,
                    Some(&error.message),
                )?;
                return Err(error);
            }
        };
        let chunk_boundaries = (0..subtitle_chunks.len())
            .map(|chunk_index| {
                build_series_chunk_boundary_context(
                    &subtitle_chunks,
                    chunk_index,
                    SHORT_CLIP_SCRIPT_BOUNDARY_CONTEXT_CHARS,
                )
            })
            .collect::<Vec<_>>();
        let chunks_with_boundaries = subtitle_chunks
            .into_iter()
            .zip(chunk_boundaries)
            .enumerate()
            .map(|(chunk_index, (chunk, boundary_context))| (chunk_index, chunk, boundary_context))
            .collect::<Vec<_>>();
        let generated_chunks = stream::iter(chunks_with_boundaries)
            .map(|(chunk_index, chunk, boundary_context)| {
                let state = &state;
                let title = &title;
                let source_filename = &task.original_filename;
                let global_context = &global_context;
                async move {
                    let first_episode = chunk.episode_numbers.first().copied().unwrap_or(1);
                    let last_episode = chunk
                        .episode_numbers
                        .last()
                        .copied()
                        .unwrap_or(first_episode);
                    let result = generate_video_import_series_script_chunk_text(
                        state,
                        title,
                        source_filename,
                        &chunk.text,
                        script_parse_mode,
                        first_episode,
                        last_episode,
                        chunk_index + 1,
                        chunk_count,
                        global_context,
                        &boundary_context,
                    )
                    .await
                    .and_then(|(chunk_script, provider, model_id)| {
                        validate_series_script_chunk(&chunk_script, &chunk.episode_numbers)
                            .map(|sections| (chunk_index, sections, provider, model_id))
                            .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
                    });
                    result.map_err(|error| (chunk_index, error))
                }
            })
            .buffer_unordered(SERIES_SCRIPT_MAX_CONCURRENT_GENERATIONS)
            .try_collect::<Vec<_>>()
            .await;
        let mut generated_chunks = match generated_chunks {
            Ok(value) => value,
            Err((chunk_index, error)) => {
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&error.message),
                    json!({ "mode": "short_clips", "chunkIndex": chunk_index + 1, "chunkCount": chunk_count }),
                )?;
                update_task_status(
                    &conn,
                    &id,
                    "failed",
                    "generate_script",
                    65,
                    Some(&error.message),
                )?;
                return Err(error);
            }
        };
        generated_chunks.sort_by_key(|(chunk_index, _, _, _)| *chunk_index);
        let mut generated_sections = Vec::new();
        let mut last_provider = String::new();
        let mut last_model_id = String::new();
        for (_, chunk_sections, provider, model_id) in generated_chunks {
            generated_sections.extend(chunk_sections);
            last_provider = provider;
            last_model_id = model_id;
        }
        let script = format!("# {}\n\n{}", title, generated_sections.join("\n\n"));

        let conn = db_connection(&state)?;
        write_script_artifact(
            &conn,
            &state,
            &id,
            &script,
            json!({ "provider": last_provider, "modelId": last_model_id, "series": true, "mode": "short_clips", "chunkCount": chunk_count }),
        )?;
        finish_step_run(
            &conn,
            &run_id,
            "success",
            None,
            None,
            json!({ "episodeCount": episodes.len(), "mode": "short_clips", "chunkCount": chunk_count }),
        )?;
        conn.execute(
            "UPDATE video_import_tasks SET status = 'script_ready', current_step = 'script_ready', progress = 80, script_model_id = ?1, error_message = NULL, updated_at = ?2 WHERE id = ?3",
            params![last_model_id, now_iso(), id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        return Ok(Json(json!({
          "success": true,
          "data": { "script": script }
        })));
    }
    drop(conn);

    let mut episode_inputs = Vec::new();
    for episode in episodes {
        let conn = db_connection(&state)?;
        let subtitle =
            latest_artifact_text(&conn, &episode.id, "subtitle_txt")?.ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!(
                        "第{}集尚未完成字幕识别",
                        episode.episode_number.unwrap_or(0)
                    ),
                )
            })?;
        let existing_script = latest_artifact_text(&conn, &episode.id, "script_edited")?
            .or(latest_artifact_text(&conn, &episode.id, "script_draft")?);
        drop(conn);
        episode_inputs.push((episode, subtitle, existing_script));
    }

    let needs_generation = episode_inputs
        .iter()
        .any(|(_, _, existing_script)| existing_script.is_none());
    let complete_subtitle = episode_inputs
        .iter()
        .map(|(episode, subtitle, _)| {
            let episode_number = episode.episode_number.unwrap_or(1).max(1);
            format!(
                "## 第{}集：{}\n\n{}",
                episode_number,
                episode_title_from_task(episode, episode_number),
                subtitle.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let global_context = if needs_generation {
        let group_script_parse_mode = normalize_video_import_script_parse_mode(
            parse_json_object(&task.config_json)
                .get("scriptParseMode")
                .and_then(Value::as_str),
        );
        match generate_video_import_series_context_text(
            &state,
            &task_title(&task),
            &task.original_filename,
            &complete_subtitle,
            group_script_parse_mode,
        )
        .await
        {
            Ok((context, _, _)) => context,
            Err(error) => {
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&error.message),
                    json!({ "mode": "episodes", "stage": "global_context" }),
                )?;
                update_task_status(
                    &conn,
                    &id,
                    "failed",
                    "generate_script",
                    65,
                    Some(&error.message),
                )?;
                return Err(error);
            }
        }
    } else {
        String::new()
    };
    let episode_boundaries = (0..episode_inputs.len())
        .map(|episode_index| {
            let previous = episode_index
                .checked_sub(1)
                .and_then(|index| episode_inputs.get(index))
                .map(|(_, subtitle, _)| subtitle.as_str());
            let next = episode_inputs
                .get(episode_index + 1)
                .map(|(_, subtitle, _)| subtitle.as_str());
            build_neighbor_text_boundary_context(
                previous,
                next,
                SHORT_CLIP_SCRIPT_BOUNDARY_CONTEXT_CHARS,
            )
        })
        .collect::<Vec<_>>();

    let generated_episodes = stream::iter(
        episode_inputs
            .into_iter()
            .zip(episode_boundaries)
            .enumerate(),
    )
    .map(
        |(episode_index, ((episode, subtitle, existing_script), boundary_context))| {
            let state = &state;
            let global_context = &global_context;
            async move {
                if let Some(script) = existing_script {
                    return Ok((episode_index, episode, script, None));
                }
                let title = task_title(&episode);
                let script_parse_mode = normalize_video_import_script_parse_mode(
                    parse_json_object(&episode.config_json)
                        .get("scriptParseMode")
                        .and_then(Value::as_str),
                );
                match generate_video_import_episode_script_text_with_context(
                    state,
                    &title,
                    &episode.original_filename,
                    &subtitle,
                    script_parse_mode,
                    episode.episode_number.unwrap_or(1).max(1),
                    global_context,
                    &boundary_context,
                )
                .await
                {
                    Ok((script, provider, model_id)) => {
                        Ok((episode_index, episode, script, Some((provider, model_id))))
                    }
                    Err(error) => Err((episode.id.clone(), error)),
                }
            }
        },
    )
    .buffer_unordered(SERIES_SCRIPT_MAX_CONCURRENT_GENERATIONS)
    .try_collect::<Vec<_>>()
    .await;
    let mut generated_episodes = match generated_episodes {
        Ok(value) => value,
        Err((episode_id, error)) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({ "episodeId": episode_id }),
            )?;
            update_task_status(
                &conn,
                &id,
                "failed",
                "generate_script",
                65,
                Some(&error.message),
            )?;
            return Err(error);
        }
    };
    generated_episodes.sort_by_key(|(episode_index, _, _, _)| *episode_index);

    let mut sections = Vec::new();
    let mut last_provider = String::new();
    let mut last_model_id = String::new();
    for (_, episode, script, generation) in generated_episodes {
        if let Some((provider, model_id)) = generation {
            last_provider = provider.clone();
            last_model_id = model_id.clone();
            let conn = db_connection(&state)?;
            write_script_artifact(
                &conn,
                &state,
                &episode.id,
                &script,
                json!({ "provider": provider, "modelId": model_id, "seriesId": id.as_str() }),
            )?;
            conn.execute(
                "UPDATE video_import_tasks SET status = 'script_ready', current_step = 'script_ready', progress = 80, script_model_id = ?1, error_message = NULL, updated_at = ?2 WHERE id = ?3",
                params![last_model_id.as_str(), now_iso(), episode.id],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }

        let episode_number = episode.episode_number.unwrap_or(1).max(1);
        sections.push(format!(
            "## 第{}集：{}\n\n{}",
            episode_number,
            episode_title_from_task(&episode, episode_number),
            script.trim()
        ));
    }

    let series_script = format!("# {}\n\n{}", task_title(&task), sections.join("\n\n"));
    let conn = db_connection(&state)?;
    write_script_artifact(
        &conn,
        &state,
        &id,
        &series_script,
        json!({ "provider": last_provider.as_str(), "modelId": last_model_id.as_str(), "series": true }),
    )?;
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "episodeCount": sections.len() }),
    )?;
    conn.execute(
        "UPDATE video_import_tasks SET status = 'script_ready', current_step = 'script_ready', progress = 80, script_model_id = ?1, error_message = NULL, updated_at = ?2 WHERE id = ?3",
        params![last_model_id.as_str(), now_iso(), id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "data": { "script": series_script }
    })))
}

pub(super) async fn api_video_import_import_project(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Option<VideoImportImportBody>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = load_task(&conn, &id)?;
    if task.is_series_group != 0 {
        drop(conn);
        return api_video_import_import_series_project(state, id, task, body).await;
    }
    let script = latest_artifact_text(&conn, &id, "script_edited")?
        .or(latest_artifact_text(&conn, &id, "script_draft")?)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请先生成或编辑剧本"))?;
    let config = parse_json_object(&task.config_json);
    let override_project_title = body
        .as_ref()
        .and_then(|value| value.project_title.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let override_aspect_ratio = body
        .as_ref()
        .and_then(|value| value.aspect_ratio.as_deref())
        .filter(|value| matches!(*value, "16:9" | "9:16" | "1:1"))
        .map(str::to_string);
    let override_script_parse_mode = body
        .as_ref()
        .and_then(|value| value.script_parse_mode.as_deref())
        .map(|value| normalize_video_import_script_parse_mode(Some(value)).to_string());
    let requested_style_id = body
        .as_ref()
        .and_then(|value| value.style_id.as_deref())
        .or_else(|| config.get("styleId").and_then(Value::as_str));
    let style_id = resolve_import_style_id(&conn, requested_style_id)?;
    let aspect_ratio = override_aspect_ratio.unwrap_or_else(|| {
        config
            .get("aspectRatio")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "16:9" | "9:16" | "1:1"))
            .unwrap_or("16:9")
            .to_string()
    });
    let script_parse_mode = override_script_parse_mode.unwrap_or_else(|| {
        config
            .get("scriptParseMode")
            .and_then(Value::as_str)
            .map(|value| normalize_video_import_script_parse_mode(Some(value)).to_string())
            .unwrap_or_else(|| "premium_drama".to_string())
    });
    let project_title = override_project_title.unwrap_or_else(|| {
        config
            .get("projectTitle")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| task_title(&task))
    });
    update_task_status(&conn, &id, "importing", "import", 85, None)?;
    let run_id = start_step_run(&conn, &id, "import", None)?;
    drop(conn);

    let conn = db_connection(&state)?;
    let create_run_id = start_step_run(&conn, &id, "create_project", None)?;
    drop(conn);
    let create = api_project_create(
        State(state.clone()),
        Json(CreateProjectBody {
            title: project_title.clone(),
            description: Some(format!("从视频转换：{}", task.original_filename)),
            script_parse_mode: Some(script_parse_mode.clone()),
            style_id: Some(style_id.clone()),
            aspect_ratio: Some(aspect_ratio.clone()),
            project_type: Some("video".to_string()),
        }),
    )
    .await;
    let create = match create {
        Ok(value) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &create_run_id, "success", None, None, json!({}))?;
            value
        }
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &create_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
            return Err(error);
        }
    };
    let project_id = create
        .0
        .get("project")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "创建项目失败"))?
        .to_string();

    let conn = db_connection(&state)?;
    let parse_run_id = start_step_run(&conn, &id, "parse_combined_script", None)?;
    drop(conn);
    let parsed = match tokio::time::timeout(
        Duration::from_millis(VIDEO_IMPORT_PARSE_TIMEOUT_MS),
        parse_video_import_script(
            state.clone(),
            &project_id,
            &script,
            &script_parse_mode,
            Some(&style_id),
        ),
    )
    .await
    {
        Ok(Ok(value)) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &parse_run_id,
                "success",
                None,
                None,
                json!({ "projectId": project_id }),
            )?;
            value
        }
        Ok(Err(error)) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &parse_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({ "projectId": project_id }),
            )?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({ "projectId": project_id }),
            )?;
            cleanup_empty_import_project(&conn, &project_id)?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
            return Err(error);
        }
        Err(_) => {
            let message = "剧本解析超时，请稍后重试";
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &parse_run_id,
                "failed",
                None,
                Some(message),
                json!({ "projectId": project_id }),
            )?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(message),
                json!({ "projectId": project_id }),
            )?;
            cleanup_empty_import_project(&conn, &project_id)?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(message))?;
            return Err(ApiError::new(StatusCode::GATEWAY_TIMEOUT, message));
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
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(message),
            json!({ "projectId": project_id }),
        )?;
        cleanup_empty_import_project(&conn, &project_id)?;
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
    let conn = db_connection(&state)?;
    let save_run_id = start_step_run(&conn, &id, "save_project", None)?;
    drop(conn);
    if let Err(error) = api_project_put(
        Path(project_id.clone()),
        State(state.clone()),
        Json(save_body),
    )
    .await
    {
        let conn = db_connection(&state)?;
        finish_step_run(
            &conn,
            &save_run_id,
            "failed",
            None,
            Some(&error.message),
            json!({ "projectId": project_id }),
        )?;
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({ "projectId": project_id }),
        )?;
        update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
        return Err(error);
    }

    let conn = db_connection(&state)?;
    finish_step_run(
        &conn,
        &save_run_id,
        "success",
        None,
        None,
        json!({ "projectId": project_id }),
    )?;
    let parse_path = task_dir(&state, &id).join("parse-result.json");
    write_text_file(&parse_path, &parsed.to_string())?;
    insert_artifact(
        &conn,
        &id,
        "parse_result",
        &parse_path,
        Some("application/json"),
        json!({ "projectId": project_id }),
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO video_import_projects (import_id, project_id, imported_at, metadata_json) VALUES (?1, ?2, ?3, ?4)",
        params![id, project_id, now_iso(), json!({}).to_string()],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "projectId": project_id }),
    )?;
    update_task_status(&conn, &id, "imported", "imported", 100, None)?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "projectId": project_id,
        "redirectUrl": format!("/projects/{project_id}")
      }
    })))
}

async fn api_video_import_import_series_project(
    state: BackendState,
    id: String,
    task: VideoImportTaskRecord,
    body: Option<VideoImportImportBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let episodes = load_series_episode_tasks(&conn, &id)?;
    if episodes.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "剧集任务没有可导入的分集",
        ));
    }
    let config = parse_json_object(&task.config_json);
    let override_project_title = body
        .as_ref()
        .and_then(|value| value.project_title.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let override_aspect_ratio = body
        .as_ref()
        .and_then(|value| value.aspect_ratio.as_deref())
        .filter(|value| matches!(*value, "16:9" | "9:16" | "1:1"))
        .map(str::to_string);
    let override_script_parse_mode = body
        .as_ref()
        .and_then(|value| value.script_parse_mode.as_deref())
        .map(|value| normalize_video_import_script_parse_mode(Some(value)).to_string());
    let requested_style_id = body
        .as_ref()
        .and_then(|value| value.style_id.as_deref())
        .or_else(|| config.get("styleId").and_then(Value::as_str));
    let style_id = resolve_import_style_id(&conn, requested_style_id)?;
    let aspect_ratio = override_aspect_ratio.unwrap_or_else(|| {
        config
            .get("aspectRatio")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "16:9" | "9:16" | "1:1"))
            .unwrap_or("16:9")
            .to_string()
    });
    let script_parse_mode = override_script_parse_mode.unwrap_or_else(|| {
        config
            .get("scriptParseMode")
            .and_then(Value::as_str)
            .map(|value| normalize_video_import_script_parse_mode(Some(value)).to_string())
            .unwrap_or_else(|| "premium_drama".to_string())
    });
    let project_title = override_project_title.unwrap_or_else(|| {
        config
            .get("projectTitle")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| task_title(&task))
    });
    update_task_status(&conn, &id, "importing", "import", 85, None)?;
    let run_id = start_step_run(&conn, &id, "import", None)?;
    drop(conn);

    let conn = db_connection(&state)?;
    let create_run_id = start_step_run(&conn, &id, "create_project", None)?;
    drop(conn);
    let create = api_project_create(
        State(state.clone()),
        Json(CreateProjectBody {
            title: project_title.clone(),
            description: Some(format!("从剧集文件夹转换：{}", task.source_path)),
            script_parse_mode: Some(script_parse_mode.clone()),
            style_id: Some(style_id.clone()),
            aspect_ratio: Some(aspect_ratio.clone()),
            project_type: Some("video".to_string()),
        }),
    )
    .await;
    let create = match create {
        Ok(value) => {
            let conn = db_connection(&state)?;
            finish_step_run(&conn, &create_run_id, "success", None, None, json!({}))?;
            value
        }
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &create_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
            return Err(error);
        }
    };
    let project_id = create
        .0
        .get("project")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "创建项目失败"))?
        .to_string();

    if is_short_clip_series_task(&task) {
        let episode_count = episodes.len();
        let group_script = {
            let conn = db_connection(&state)?;
            latest_artifact_text(&conn, &id, "script_edited")?.or(latest_artifact_text(
                &conn,
                &id,
                "script_draft",
            )?)
        };
        let group_script_sections = group_script
            .as_deref()
            .map(split_series_script_sections)
            .unwrap_or_default();
        let mut episode_plan = Vec::new();
        let mut all_scenes = Vec::new();
        let mut all_characters = Vec::new();
        let mut combined_script_sections = Vec::new();
        let mut parsed_episodes = Vec::new();

        for (episode_index, episode) in episodes.into_iter().enumerate() {
            let conn = db_connection(&state)?;
            let child_script = latest_artifact_text(&conn, &episode.id, "script_edited")?
                .or(latest_artifact_text(&conn, &episode.id, "script_draft")?);
            let child_subtitle = latest_artifact_text(&conn, &episode.id, "subtitle_txt")?;
            drop(conn);

            let episode_number = episode.episode_number.unwrap_or(1).max(1);
            let episode_title = episode_title_from_task(&episode, episode_number);
            let script = group_script_sections
                .get(episode_index)
                .cloned()
                .filter(|value| !value.trim().is_empty())
                .or(child_script.filter(|value| !value.trim().is_empty()))
                .or_else(|| {
                    child_subtitle
                        .filter(|value| !value.trim().is_empty())
                        .map(|subtitle| {
                            format!(
                                "## 第{}段：{}\n\n{}",
                                episode_number,
                                episode_title,
                                subtitle.trim()
                            )
                        })
                })
                .or_else(|| {
                    if episode_count == 1 {
                        group_script
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::BAD_REQUEST,
                        format!("第{}段尚未生成剧本或字幕", episode_number),
                    )
                })?;
            let episode_item = build_series_episode_plan_item(&episode, episode_number);
            let episode_plan_value = json!([episode_item.clone()]);
            let conn = db_connection(&state)?;
            let parse_run_id = start_step_run(&conn, &id, "parse_clip", None)?;
            drop(conn);
            let parsed = match tokio::time::timeout(
                Duration::from_millis(VIDEO_IMPORT_PARSE_TIMEOUT_MS),
                parse_video_import_script_with_episode_plan(
                    state.clone(),
                    &project_id,
                    &script,
                    &script_parse_mode,
                    Some(&style_id),
                    episode_plan_value,
                ),
            )
            .await
            {
                Ok(Ok(value)) => {
                    let conn = db_connection(&state)?;
                    finish_step_run(
                        &conn,
                        &parse_run_id,
                        "success",
                        None,
                        None,
                        json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number, "mode": "short_clips" }),
                    )?;
                    value
                }
                Ok(Err(error)) => {
                    let conn = db_connection(&state)?;
                    finish_step_run(
                        &conn,
                        &parse_run_id,
                        "failed",
                        None,
                        Some(&error.message),
                        json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number, "mode": "short_clips" }),
                    )?;
                    finish_step_run(
                        &conn,
                        &run_id,
                        "failed",
                        None,
                        Some(&error.message),
                        json!({ "projectId": project_id, "episodeId": episode.id }),
                    )?;
                    cleanup_empty_import_project(&conn, &project_id)?;
                    update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
                    return Err(error);
                }
                Err(_) => {
                    let message = format!("第{}段脚本解析超时，请稍后重试", episode_number);
                    let conn = db_connection(&state)?;
                    finish_step_run(
                        &conn,
                        &parse_run_id,
                        "failed",
                        None,
                        Some(&message),
                        json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number, "mode": "short_clips" }),
                    )?;
                    finish_step_run(
                        &conn,
                        &run_id,
                        "failed",
                        None,
                        Some(&message),
                        json!({ "projectId": project_id, "episodeId": episode.id }),
                    )?;
                    cleanup_empty_import_project(&conn, &project_id)?;
                    update_task_status(&conn, &id, "failed", "import", 85, Some(&message))?;
                    return Err(ApiError::new(StatusCode::GATEWAY_TIMEOUT, message));
                }
            };

            let parsed_data = parsed.get("data").cloned().unwrap_or_else(|| json!({}));
            let scenes = parsed_data
                .get("scenes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if scenes.is_empty() {
                let message = format!(
                    "第{}段脚本解析结果没有场景，请编辑剧本后重试",
                    episode_number
                );
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&message),
                    json!({ "projectId": project_id, "episodeId": episode.id }),
                )?;
                cleanup_empty_import_project(&conn, &project_id)?;
                update_task_status(&conn, &id, "failed", "import", 85, Some(&message))?;
                return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
            }

            let episode_id = episode_item
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("episode-1")
                .to_string();
            for (scene_index, scene) in scenes.into_iter().enumerate() {
                all_scenes.push(normalize_series_scene(
                    scene,
                    &episode_id,
                    &episode_title,
                    episode_number,
                    scene_index + 1,
                ));
            }
            if let Some(characters) = parsed_data.get("characters").and_then(Value::as_array) {
                for character in characters {
                    let mut character = character.clone();
                    if let Some(object) = character.as_object_mut() {
                        object.remove("id");
                    }
                    all_characters.push(character);
                }
            }
            episode_plan.push(episode_item);
            combined_script_sections.push(format!(
                "## 第{}段：{}\n\n{}",
                episode_number,
                episode_title,
                script.trim()
            ));
            parsed_episodes.push(parsed);
        }

        let combined_script = group_script
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                format!(
                    "# {}\n\n{}",
                    project_title,
                    combined_script_sections.join("\n\n")
                )
            });
        let parsed_data = json!({
          "episodePlan": episode_plan,
          "scenes": all_scenes,
          "characters": all_characters
        });

        let save_body = build_project_save_body(
            &project_title,
            &task.source_path,
            &style_id,
            &aspect_ratio,
            &script_parse_mode,
            &combined_script,
            &parsed_data,
        );
        let conn = db_connection(&state)?;
        let save_run_id = start_step_run(&conn, &id, "save_project", None)?;
        drop(conn);
        if let Err(error) = api_project_put(
            Path(project_id.clone()),
            State(state.clone()),
            Json(save_body),
        )
        .await
        {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &save_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({ "projectId": project_id }),
            )?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&error.message),
                json!({ "projectId": project_id }),
            )?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
            return Err(error);
        }

        let conn = db_connection(&state)?;
        finish_step_run(
            &conn,
            &save_run_id,
            "success",
            None,
            None,
            json!({ "projectId": project_id }),
        )?;
        let parse_path = task_dir(&state, &id).join("parse-result.json");
        write_text_file(&parse_path, &json!({ "success": true, "data": parsed_data, "episodes": parsed_episodes, "mode": "short_clips" }).to_string())?;
        insert_artifact(
            &conn,
            &id,
            "parse_result",
            &parse_path,
            Some("application/json"),
            json!({ "projectId": project_id, "series": true, "mode": "short_clips" }),
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO video_import_projects (import_id, project_id, imported_at, metadata_json) VALUES (?1, ?2, ?3, ?4)",
            params![id, project_id, now_iso(), json!({ "series": true, "mode": "short_clips" }).to_string()],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        finish_step_run(
            &conn,
            &run_id,
            "success",
            None,
            None,
            json!({ "projectId": project_id, "mode": "short_clips" }),
        )?;
        update_task_status(&conn, &id, "imported", "imported", 100, None)?;

        return Ok(Json(json!({
          "success": true,
          "data": {
            "projectId": project_id,
            "redirectUrl": format!("/projects/{project_id}")
          }
        })));
    }

    let mut episode_plan = Vec::new();
    let mut all_scenes = Vec::new();
    let mut all_characters = Vec::new();
    let mut combined_script_sections = Vec::new();
    let mut parsed_episodes = Vec::new();
    let group_script_sections = {
        let conn = db_connection(&state)?;
        let group_script = latest_artifact_text(&conn, &id, "script_edited")?
            .or(latest_artifact_text(&conn, &id, "script_draft")?);
        group_script
            .as_deref()
            .map(split_series_script_sections)
            .unwrap_or_default()
    };

    for (episode_index, episode) in episodes.into_iter().enumerate() {
        let conn = db_connection(&state)?;
        let child_script = latest_artifact_text(&conn, &episode.id, "script_edited")?
            .or(latest_artifact_text(&conn, &episode.id, "script_draft")?);
        drop(conn);

        let episode_number = episode.episode_number.unwrap_or(1).max(1);
        let script = group_script_sections
            .get(episode_index)
            .cloned()
            .filter(|value| !value.trim().is_empty())
            .or(child_script)
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("第{}集尚未生成剧本", episode_number),
                )
            })?;
        let episode_item = build_series_episode_plan_item(&episode, episode_number);
        let episode_plan_value = json!([episode_item.clone()]);
        let conn = db_connection(&state)?;
        let parse_run_id = start_step_run(&conn, &id, "parse_episode", None)?;
        drop(conn);
        let parsed = match tokio::time::timeout(
            Duration::from_millis(VIDEO_IMPORT_PARSE_TIMEOUT_MS),
            parse_video_import_script_with_episode_plan(
                state.clone(),
                &project_id,
                &script,
                &script_parse_mode,
                Some(&style_id),
                episode_plan_value,
            ),
        )
        .await
        {
            Ok(Ok(value)) => {
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &parse_run_id,
                    "success",
                    None,
                    None,
                    json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number }),
                )?;
                value
            }
            Ok(Err(error)) => {
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &parse_run_id,
                    "failed",
                    None,
                    Some(&error.message),
                    json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number }),
                )?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&error.message),
                    json!({ "projectId": project_id, "episodeId": episode.id }),
                )?;
                cleanup_empty_import_project(&conn, &project_id)?;
                update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
                return Err(error);
            }
            Err(_) => {
                let message = format!("第{}集脚本解析超时，请稍后重试", episode_number);
                let conn = db_connection(&state)?;
                finish_step_run(
                    &conn,
                    &parse_run_id,
                    "failed",
                    None,
                    Some(&message),
                    json!({ "projectId": project_id, "episodeId": episode.id, "episodeNumber": episode_number }),
                )?;
                finish_step_run(
                    &conn,
                    &run_id,
                    "failed",
                    None,
                    Some(&message),
                    json!({ "projectId": project_id, "episodeId": episode.id }),
                )?;
                cleanup_empty_import_project(&conn, &project_id)?;
                update_task_status(&conn, &id, "failed", "import", 85, Some(&message))?;
                return Err(ApiError::new(StatusCode::GATEWAY_TIMEOUT, message));
            }
        };

        let parsed_data = parsed.get("data").cloned().unwrap_or_else(|| json!({}));
        let scenes = parsed_data
            .get("scenes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if scenes.is_empty() {
            let message = format!(
                "第{}集脚本解析结果没有场景，请编辑剧本后重试",
                episode_number
            );
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &run_id,
                "failed",
                None,
                Some(&message),
                json!({ "projectId": project_id, "episodeId": episode.id }),
            )?;
            cleanup_empty_import_project(&conn, &project_id)?;
            update_task_status(&conn, &id, "failed", "import", 85, Some(&message))?;
            return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
        }

        let episode_id = episode_item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("episode-1")
            .to_string();
        let episode_title = episode_item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("第1集")
            .to_string();
        for (scene_index, scene) in scenes.into_iter().enumerate() {
            all_scenes.push(normalize_series_scene(
                scene,
                &episode_id,
                &episode_title,
                episode_number,
                scene_index + 1,
            ));
        }
        if let Some(characters) = parsed_data.get("characters").and_then(Value::as_array) {
            for character in characters {
                let mut character = character.clone();
                if let Some(object) = character.as_object_mut() {
                    object.remove("id");
                }
                all_characters.push(character);
            }
        }
        episode_plan.push(episode_item);
        combined_script_sections.push(format!(
            "## 第{}集：{}\n\n{}",
            episode_number,
            episode_title,
            script.trim()
        ));
        parsed_episodes.push(parsed);
    }

    let combined_script = format!(
        "# {}\n\n{}",
        project_title,
        combined_script_sections.join("\n\n")
    );
    let parsed_data = json!({
      "episodePlan": episode_plan,
      "scenes": all_scenes,
      "characters": all_characters
    });
    let save_body = build_project_save_body(
        &project_title,
        &task.source_path,
        &style_id,
        &aspect_ratio,
        &script_parse_mode,
        &combined_script,
        &parsed_data,
    );
    let conn = db_connection(&state)?;
    let save_run_id = start_step_run(&conn, &id, "save_project", None)?;
    drop(conn);
    if let Err(error) = api_project_put(
        Path(project_id.clone()),
        State(state.clone()),
        Json(save_body),
    )
    .await
    {
        let conn = db_connection(&state)?;
        finish_step_run(
            &conn,
            &save_run_id,
            "failed",
            None,
            Some(&error.message),
            json!({ "projectId": project_id }),
        )?;
        finish_step_run(
            &conn,
            &run_id,
            "failed",
            None,
            Some(&error.message),
            json!({ "projectId": project_id }),
        )?;
        update_task_status(&conn, &id, "failed", "import", 85, Some(&error.message))?;
        return Err(error);
    }

    let conn = db_connection(&state)?;
    finish_step_run(
        &conn,
        &save_run_id,
        "success",
        None,
        None,
        json!({ "projectId": project_id }),
    )?;
    let parse_path = task_dir(&state, &id).join("parse-result.json");
    write_text_file(
        &parse_path,
        &json!({ "success": true, "data": parsed_data, "episodes": parsed_episodes }).to_string(),
    )?;
    insert_artifact(
        &conn,
        &id,
        "parse_result",
        &parse_path,
        Some("application/json"),
        json!({ "projectId": project_id, "series": true }),
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO video_import_projects (import_id, project_id, imported_at, metadata_json) VALUES (?1, ?2, ?3, ?4)",
        params![id, project_id, now_iso(), json!({ "series": true }).to_string()],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    finish_step_run(
        &conn,
        &run_id,
        "success",
        None,
        None,
        json!({ "projectId": project_id }),
    )?;
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
            let run_id = start_step_run(&conn, &id, "retry", None)?;
            finish_step_run(
                &conn,
                &run_id,
                "success",
                None,
                None,
                json!({ "fromStep": from_step }),
            )?;
            conn.execute(
                "UPDATE video_import_tasks
                 SET status = 'pending', current_step = 'retry', progress = 0,
                     error_message = NULL, cancelled_at = NULL, completed_at = NULL, updated_at = ?1
                 WHERE id = ?2",
                params![now_iso(), id],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            drop(conn);
            let background_state = state.clone();
            let background_task_id = id.clone();
            tokio::spawn(async move {
                if let Err(error) =
                    run_initial_video_import_task(background_state.clone(), &background_task_id)
                        .await
                {
                    let _ = mark_task_failed(
                        &background_state,
                        &background_task_id,
                        "processing",
                        &error.message,
                    );
                }
            });
            Ok(Json(json!({ "success": true })))
        }
        "generate_script" => api_video_import_generate_script(Path(id), State(state))
            .await
            .map(|_| Json(json!({ "success": true }))),
        "import" => api_video_import_import_project(Path(id), State(state), Json(None))
            .await
            .map(|_| Json(json!({ "success": true }))),
        _ => Err(ApiError::new(StatusCode::BAD_REQUEST, "fromStep 无效")),
    }
}

pub(super) async fn api_video_import_cancel(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    ensure_task_exists(&conn, &id)?;
    let task_ids = expand_task_delete_ids(&conn, &[id])?;
    let cancelled_at = now_iso();
    for task_id in task_ids {
        let run_id = start_step_run(&conn, &task_id, "cancel", None)?;
        conn.execute(
            "UPDATE video_import_tasks
             SET status = 'cancelled', current_step = 'cancelled', cancelled_at = ?1,
                 completed_at = NULL, updated_at = ?1
             WHERE id = ?2",
            params![cancelled_at, task_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        finish_step_run(&conn, &run_id, "success", None, None, json!({}))?;
    }
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let ids = expand_task_delete_ids(&conn, &[id.clone()])?;
    if ids.is_empty() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "视频导入任务不存在"));
    }
    delete_video_import_tasks(&conn, &state, &ids)?;

    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_video_import_delete_batch(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let task_ids = body
        .get("taskIds")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "taskIds 必须是数组"))?;

    let conn = db_connection(&state)?;
    let requested_ids = task_ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let ids = expand_task_delete_ids(&conn, &requested_ids)?;
    let deleted_count = delete_video_import_tasks(&conn, &state, &ids)?;

    Ok(Json(json!({
        "success": true,
        "data": { "deletedCount": deleted_count }
    })))
}

fn expand_task_delete_ids(
    conn: &Connection,
    requested_ids: &[String],
) -> Result<Vec<String>, ApiError> {
    let mut ids = Vec::<String>::new();
    for task_id in requested_ids {
        let is_group = conn
            .query_row(
                "SELECT is_series_group FROM video_import_tasks WHERE id = ?1 LIMIT 1",
                params![task_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let Some(is_group) = is_group else {
            continue;
        };
        if !ids.iter().any(|id| id == task_id) {
            ids.push(task_id.clone());
        }
        if is_group != 0 {
            let children = load_series_episode_tasks(conn, task_id)?;
            for child in children {
                if !ids.iter().any(|id| id == &child.id) {
                    ids.push(child.id);
                }
            }
        }
    }
    Ok(ids)
}

fn delete_video_import_tasks(
    conn: &Connection,
    state: &BackendState,
    task_ids: &[String],
) -> Result<usize, ApiError> {
    let mut deleted_count = 0;
    for task_id in task_ids {
        conn.execute(
            "DELETE FROM video_import_artifacts WHERE task_id = ?1",
            params![task_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        conn.execute(
            "DELETE FROM video_import_step_runs WHERE task_id = ?1",
            params![task_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        conn.execute(
            "DELETE FROM video_import_projects WHERE import_id = ?1",
            params![task_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let rows = conn
            .execute(
                "DELETE FROM video_import_tasks WHERE id = ?1",
                params![task_id],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if rows > 0 {
            deleted_count += 1;
            let task_dir_path = task_dir(state, task_id);
            if task_dir_path.exists() {
                let _ = fs::remove_dir_all(&task_dir_path);
            }
        }
    }
    Ok(deleted_count)
}

pub(super) async fn api_video_import_events(
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let stream = stream::once(async {
        Ok(Event::default()
            .event("ready")
            .data(json!({ "success": true }).to_string()))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn run_initial_video_import_task(state: BackendState, task_id: &str) -> Result<(), ApiError> {
    let conn = db_connection(&state)?;
    ensure_video_import_task_active(&conn, task_id)?;
    let task = load_task(&conn, task_id)?;
    update_task_status(&conn, task_id, "extracting", "extract", 10, None)?;
    let extract_run_id = start_step_run(&conn, task_id, "extract", None)?;
    drop(conn);

    let audio_path = task_dir(&state, task_id).join("audio.wav");
    match extract_audio(PathBuf::from(&task.source_path), audio_path.clone()).await {
        Ok(()) => {
            let conn = db_connection(&state)?;
            ensure_video_import_task_active(&conn, task_id)?;
            insert_artifact(
                &conn,
                task_id,
                "extracted_audio",
                &audio_path,
                Some("audio/wav"),
                json!({}),
            )?;
            finish_step_run(&conn, &extract_run_id, "success", None, None, json!({}))?;
            update_task_status(&conn, task_id, "transcribing", "transcribe", 35, None)?;
        }
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &extract_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            update_task_status(
                &conn,
                task_id,
                "failed",
                "extract",
                10,
                Some(&error.message),
            )?;
            return Err(error);
        }
    }

    let conn = db_connection(&state)?;
    ensure_video_import_task_active(&conn, task_id)?;
    let asr_run_id = start_step_run(&conn, task_id, "transcribe", Some("bcut"))?;
    drop(conn);

    let output = match transcribe_bcut_for_import(audio_path.clone(), &state, task_id).await {
        Ok(value) => value,
        Err(error) => {
            let conn = db_connection(&state)?;
            finish_step_run(
                &conn,
                &asr_run_id,
                "failed",
                None,
                Some(&error.message),
                json!({}),
            )?;
            update_task_status(
                &conn,
                task_id,
                "failed",
                "transcribe",
                45,
                Some(&error.message),
            )?;
            return Err(error);
        }
    };

    let conn = db_connection(&state)?;
    ensure_video_import_task_active(&conn, task_id)?;
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
    finish_step_run(
        &conn,
        &asr_run_id,
        "success",
        Some(&output.task_id),
        None,
        json!({ "segmentCount": output.segments.len() }),
    )?;
    update_task_status(&conn, task_id, "subtitle_ready", "subtitle_ready", 55, None)?;
    let _ = task;
    Ok(())
}

async fn extract_audio(video_path: PathBuf, audio_path: PathBuf) -> Result<(), ApiError> {
    let ffmpeg = std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string());
    tokio::task::spawn_blocking(move || {
        let output = hidden_command(ffmpeg)
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
            .map_err(|error| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("启动 ffmpeg 失败: {error}"),
                )
            })?;
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

pub(super) async fn transcribe_bcut(audio_path: PathBuf) -> Result<BcutOutput, ApiError> {
    transcribe_bcut_inner(audio_path, None).await
}

async fn transcribe_bcut_for_import(
    audio_path: PathBuf,
    state: &BackendState,
    task_id: &str,
) -> Result<BcutOutput, ApiError> {
    transcribe_bcut_inner(audio_path, Some((state, task_id))).await
}

async fn transcribe_bcut_inner(
    audio_path: PathBuf,
    cancellation: Option<(&BackendState, &str)>,
) -> Result<BcutOutput, ApiError> {
    ensure_video_import_cancellation_state(cancellation)?;
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
    ensure_video_import_cancellation_state(cancellation)?;
    let in_boss_key = json_str(&create_payload, "in_boss_key")?;
    let resource_id = json_str(&create_payload, "resource_id")?;
    let upload_id = json_str(&create_payload, "upload_id")?;
    let per_size = create_payload
        .get("per_size")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 返回了无效分片大小"))?
        as usize;
    let upload_urls = create_payload
        .get("upload_urls")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 未返回上传地址"))?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if upload_urls.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "Bcut ASR 未返回上传地址",
        ));
    }

    let mut etags = Vec::new();
    for (index, url) in upload_urls.iter().enumerate() {
        ensure_video_import_cancellation_state(cancellation)?;
        let start = index * per_size;
        let end = ((index + 1) * per_size).min(bytes.len());
        if start >= end {
            continue;
        }
        let response = upload_bcut_part(&client, url, bytes[start..end].to_vec()).await?;
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
    ensure_video_import_cancellation_state(cancellation)?;
    let download_url = json_str(&complete_payload, "download_url")?;

    let task_payload = bcut_api::<Value>(
        &client,
        reqwest::Method::POST,
        &format!("{BCUT_BASE_URL}/task"),
        None,
        Some(json!({ "resource": download_url, "model_id": BCUT_MODEL_ID })),
    )
    .await?;
    ensure_video_import_cancellation_state(cancellation)?;
    let task_id = json_str(&task_payload, "task_id")?;
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_millis(ASR_TIMEOUT_MS) {
            return Err(ApiError::new(StatusCode::BAD_GATEWAY, "Bcut ASR 识别超时"));
        }
        tokio::time::sleep(Duration::from_millis(ASR_POLL_INTERVAL_MS)).await;
        ensure_video_import_cancellation_state(cancellation)?;
        let url = format!("{BCUT_BASE_URL}/task/result?model_id={BCUT_MODEL_ID}&task_id={task_id}");
        let result_payload =
            bcut_api::<Value>(&client, reqwest::Method::GET, &url, None, None).await?;
        let state = result_payload
            .get("state")
            .and_then(Value::as_i64)
            .unwrap_or(-1);
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
            let remark = result_payload
                .get("remark")
                .and_then(Value::as_str)
                .unwrap_or("");
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("Bcut ASR 识别失败: {remark}"),
            ));
        }
    }
}

async fn upload_bcut_part(
    client: &Client,
    url: &str,
    body: Vec<u8>,
) -> Result<reqwest::Response, ApiError> {
    for attempt in 1..=BCUT_UPLOAD_MAX_ATTEMPTS {
        let result = client
            .put(url)
            .header(USER_AGENT, BCUT_USER_AGENT)
            .body(body.clone())
            .send()
            .await;

        match result {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => {
                let status = response.status();
                if attempt == BCUT_UPLOAD_MAX_ATTEMPTS || !is_transient_bcut_status(status) {
                    return Err(ApiError::new(
                        StatusCode::BAD_GATEWAY,
                        format!("Bcut ASR 上传分片失败: HTTP {status}（已尝试 {attempt} 次）"),
                    ));
                }
            }
            Err(error) => {
                if attempt == BCUT_UPLOAD_MAX_ATTEMPTS {
                    return Err(ApiError::new(
                        StatusCode::BAD_GATEWAY,
                        format!("Bcut ASR 上传分片失败（已尝试 {attempt} 次）: {error}"),
                    ));
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(bcut_upload_retry_delay_ms(attempt))).await;
    }

    unreachable!("Bcut upload attempts must return a result")
}

fn is_transient_bcut_status(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::REQUEST_TIMEOUT | reqwest::StatusCode::TOO_MANY_REQUESTS
    ) || status.is_server_error()
}

fn bcut_upload_retry_delay_ms(attempt: usize) -> u64 {
    BCUT_UPLOAD_RETRY_BASE_DELAY_MS * (1_u64 << attempt.saturating_sub(1))
}

async fn bcut_api<T: serde::de::DeserializeOwned>(
    client: &Client,
    method: reqwest::Method,
    url: &str,
    form: Option<&[(&str, String)]>,
    json_body: Option<Value>,
) -> Result<T, ApiError> {
    let mut request = client
        .request(method, url)
        .header(USER_AGENT, BCUT_USER_AGENT);
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
    let episode_plan = parsed_data
        .get("episodePlan")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .cloned()
        .unwrap_or_else(default_video_import_episode_plan);
    let default_episode = episode_plan.first().cloned().unwrap_or_else(|| {
        json!({
          "id": "episode-1",
          "title": "第1集",
          "index": 1,
          "startOffset": 0,
          "endOffset": 1
        })
    });
    let default_episode_id = default_episode
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("episode-1")
        .to_string();
    let default_episode_title = default_episode
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("第1集")
        .to_string();
    let default_episode_index = default_episode
        .get("index")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 1)
        .unwrap_or(1);
    let scenes = parsed_data
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|scene| {
            normalize_import_scene_episode(
                scene,
                &default_episode_id,
                &default_episode_title,
                default_episode_index,
            )
        })
        .collect::<Vec<_>>();
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
              "role": character.get("role").and_then(Value::as_str).unwrap_or("配角"),
              "appearance": character.get("appearance").or_else(|| character.get("description")).and_then(Value::as_str).unwrap_or(name),
              "gender": character.get("gender").and_then(Value::as_str),
              "personality": character.get("personality").and_then(Value::as_str),
              "traits": character.get("traits").cloned().unwrap_or(Value::Null)
            })
        })
        .collect::<Vec<_>>();

    json!({
      "name": project_title,
      "description": format!("从视频转换：{source_filename}"),
      "status": "in_progress",
      "styleId": style_id,
      "aspectRatio": aspect_ratio,
      "scriptParseMode": script_parse_mode,
      "storyIdea": script,
      "novelText": "",
      "rawText": script,
      "selectedStyleId": style_id,
      "inputMode": "script",
      "episodePlan": episode_plan,
      "scenes": scenes,
      "characters": characters
    })
}

fn write_script_artifact(
    conn: &Connection,
    state: &BackendState,
    task_id: &str,
    script: &str,
    metadata: Value,
) -> Result<(), ApiError> {
    let path = task_dir(state, task_id).join("script-draft.md");
    write_text_file(&path, script)?;
    insert_artifact(
        conn,
        task_id,
        "script_draft",
        &path,
        Some("text/markdown"),
        metadata,
    )
}

fn episode_title_from_task(task: &VideoImportTaskRecord, episode_number: i64) -> String {
    let stem = task
        .original_filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(&task.original_filename)
        .trim();
    if stem.is_empty() {
        format!("第{}集", episode_number)
    } else {
        stem.to_string()
    }
}

fn build_series_episode_plan_item(task: &VideoImportTaskRecord, episode_number: i64) -> Value {
    let safe_number = episode_number.max(1);
    json!({
      "id": format!("episode_{safe_number:03}"),
      "title": episode_title_from_task(task, safe_number),
      "index": safe_number,
      "startOffset": safe_number - 1,
      "endOffset": safe_number,
      "episodeHook": "",
      "humiliationOrThreat": "",
      "reversalPoint": "",
      "emotionalCurve": "",
      "cliffhanger": "",
      "episodeAssets": {
        "characters": [],
        "props": [],
        "environments": []
      }
    })
}

fn normalize_series_scene(
    scene: Value,
    episode_id: &str,
    episode_title: &str,
    episode_number: i64,
    scene_number: usize,
) -> Value {
    let Some(mut object) = scene.as_object().cloned() else {
        return scene;
    };
    let raw_scene_id = object
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("scene_{scene_number:03}"));
    object.insert(
        "id".to_string(),
        json!(format!("{episode_id}_{raw_scene_id}")),
    );
    object.insert("episodeId".to_string(), json!(episode_id));
    object.insert("episodeTitle".to_string(), json!(episode_title));
    object.insert("episodeIndex".to_string(), json!(episode_number.max(1)));
    Value::Object(object)
}

fn split_series_script_sections(script: &str) -> Vec<String> {
    let mut sections = Vec::<String>::new();
    let mut prelude = Vec::<String>::new();
    let mut current = Vec::<String>::new();
    let mut seen_episode_heading = false;
    for line in script.lines() {
        let trimmed = line.trim_start();
        let is_episode_heading =
            trimmed.starts_with("## 第") && (trimmed.contains('集') || trimmed.contains('段'));
        if is_episode_heading {
            if seen_episode_heading && !current.is_empty() {
                sections.push(current.join("\n").trim().to_string());
                current.clear();
            }
            seen_episode_heading = true;
            current.push(line.to_string());
            continue;
        }
        if seen_episode_heading {
            current.push(line.to_string());
        } else if !trimmed.starts_with("# ") && !trimmed.is_empty() {
            prelude.push(line.to_string());
        }
    }
    if seen_episode_heading {
        if !current.is_empty() {
            sections.push(current.join("\n").trim().to_string());
        }
    } else if !prelude.is_empty() {
        sections.push(prelude.join("\n").trim().to_string());
    }
    sections
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect()
}

fn default_video_import_episode_plan() -> Vec<Value> {
    vec![json!({
      "id": "episode-1",
      "title": "第1集",
      "index": 1,
      "startOffset": 0,
      "endOffset": 1,
      "episodeHook": "",
      "humiliationOrThreat": "",
      "reversalPoint": "",
      "emotionalCurve": "",
      "cliffhanger": "",
      "episodeAssets": {
        "characters": [],
        "props": [],
        "environments": []
      }
    })]
}

fn normalize_import_scene_episode(
    scene: Value,
    episode_id: &str,
    episode_title: &str,
    episode_index: i64,
) -> Value {
    let Some(mut object) = scene.as_object().cloned() else {
        return scene;
    };
    if object
        .get("episodeId")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        object.insert("episodeId".to_string(), json!(episode_id));
    }
    if object
        .get("episodeTitle")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        object.insert("episodeTitle".to_string(), json!(episode_title));
    }
    if object
        .get("episodeIndex")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 1)
        .is_none()
    {
        object.insert("episodeIndex".to_string(), json!(episode_index));
    }
    Value::Object(object)
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
      "cancelledAt": task.cancelled_at,
      "seriesId": task.series_id,
      "episodeNumber": task.episode_number,
      "isSeriesGroup": task.is_series_group != 0
    })
}

fn query_tasks(
    conn: &Connection,
    sql: &str,
    args: &[String],
) -> Result<Vec<VideoImportTaskRecord>, ApiError> {
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
        "SELECT id, original_filename, source_kind, source_path, status, current_step, progress, error_message, asr_provider, script_model_id, config_json, metadata_json, created_at, updated_at, started_at, completed_at, cancelled_at, series_id, episode_number, is_series_group FROM video_import_tasks WHERE id = ?1 LIMIT 1",
        params![id],
        task_from_row,
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "视频转换任务不存在"))
}

fn load_series_episode_tasks(
    conn: &Connection,
    series_id: &str,
) -> Result<Vec<VideoImportTaskRecord>, ApiError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, original_filename, source_kind, source_path, status, current_step, progress, error_message, asr_provider, script_model_id, config_json, metadata_json, created_at, updated_at, started_at, completed_at, cancelled_at, series_id, episode_number, is_series_group
             FROM video_import_tasks
             WHERE series_id = ?1 AND is_series_group = 0
             ORDER BY episode_number ASC, original_filename ASC",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt
        .query_map(params![series_id], task_from_row)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(rows)
}

fn refresh_all_series_group_status(conn: &Connection) -> Result<(), ApiError> {
    let ids = {
        let mut stmt = conn
            .prepare("SELECT id FROM video_import_tasks WHERE is_series_group = 1")
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        rows
    };
    for id in ids {
        refresh_series_group_status(conn, &id)?;
    }
    Ok(())
}

fn refresh_series_group_status(conn: &Connection, id: &str) -> Result<(), ApiError> {
    let group_status = conn
        .query_row(
            "SELECT status FROM video_import_tasks WHERE id = ?1 AND is_series_group = 1 LIMIT 1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let Some(status) = group_status else {
        return Ok(());
    };
    if matches!(
        status.as_str(),
        "generating_script" | "importing" | "imported"
    ) {
        return Ok(());
    }

    let episodes = load_series_episode_tasks(conn, id)?;
    if episodes.is_empty() {
        return Ok(());
    }

    let failed = episodes.iter().find(|task| task.status == "failed");
    let running = episodes.iter().any(|task| {
        matches!(
            task.status.as_str(),
            "pending" | "extracting" | "transcribing"
        )
    });
    let all_subtitle_ready = episodes.iter().all(|task| {
        matches!(
            task.status.as_str(),
            "subtitle_ready" | "generating_script" | "script_ready" | "importing" | "imported"
        )
    });
    let all_script_ready = episodes.iter().all(|task| {
        matches!(
            task.status.as_str(),
            "script_ready" | "importing" | "imported"
        )
    });
    let progress = ((episodes.iter().map(|task| task.progress).sum::<i64>() as f64)
        / (episodes.len() as f64))
        .round() as i64;

    let (next_status, next_step, next_progress, error_message) = if let Some(task) = failed {
        (
            "failed",
            task.current_step.as_str(),
            progress.clamp(0, 80),
            task.error_message.as_deref(),
        )
    } else if all_script_ready || latest_artifact_text(conn, id, "script_draft")?.is_some() {
        ("script_ready", "script_ready", 80, None)
    } else if all_subtitle_ready {
        ("subtitle_ready", "subtitle_ready", 55, None)
    } else if running {
        ("transcribing", "transcribe", progress.clamp(1, 55), None)
    } else {
        ("pending", "created", progress.clamp(0, 55), None)
    };

    update_task_status(
        conn,
        id,
        next_status,
        next_step,
        next_progress,
        error_message,
    )
}

fn build_series_subtitle_text(conn: &Connection, series_id: &str) -> Result<String, ApiError> {
    Ok(build_series_subtitle_sections(conn, series_id)?
        .into_iter()
        .map(format_series_subtitle_section)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn build_series_subtitle_sections(
    conn: &Connection,
    series_id: &str,
) -> Result<Vec<SeriesSubtitleSection>, ApiError> {
    let episodes = load_series_episode_tasks(conn, series_id)?;
    let mut sections = Vec::new();
    for episode in episodes {
        let episode_number = episode.episode_number.unwrap_or(1).max(1);
        let title = episode_title_from_task(&episode, episode_number);
        let subtitle = latest_artifact_text(conn, &episode.id, "subtitle_txt")?
            .unwrap_or_else(|| format!("（{}）", status_label_for_backend(&episode.status)));
        sections.push(SeriesSubtitleSection {
            episode_number,
            title,
            subtitle: subtitle.trim().to_string(),
        });
    }
    Ok(sections)
}

fn format_series_subtitle_section(section: SeriesSubtitleSection) -> String {
    format!(
        "## 第{}集：{}\n\n{}",
        section.episode_number, section.title, section.subtitle
    )
}

fn split_series_subtitle_chunks(sections: Vec<SeriesSubtitleSection>) -> Vec<SeriesSubtitleChunk> {
    let mut chunks = Vec::new();
    let mut current_numbers = Vec::new();
    let mut current_sections = Vec::new();
    let mut current_chars = 0usize;

    for section in sections {
        let episode_number = section.episode_number;
        let formatted = format!(
            "## 第{}段：{}\n\n{}",
            section.episode_number, section.title, section.subtitle
        );
        let formatted_chars = formatted.chars().count();
        let exceeds_limit = !current_sections.is_empty()
            && (current_sections.len() >= SHORT_CLIP_SCRIPT_CHUNK_MAX_EPISODES
                || current_chars + 2 + formatted_chars > SHORT_CLIP_SCRIPT_CHUNK_MAX_CHARS);
        if exceeds_limit {
            chunks.push(SeriesSubtitleChunk {
                episode_numbers: std::mem::take(&mut current_numbers),
                text: std::mem::take(&mut current_sections).join("\n\n"),
            });
            current_chars = 0;
        }
        if !current_sections.is_empty() {
            current_chars += 2;
        }
        current_chars += formatted_chars;
        current_numbers.push(episode_number);
        current_sections.push(formatted);
    }
    if !current_sections.is_empty() {
        chunks.push(SeriesSubtitleChunk {
            episode_numbers: current_numbers,
            text: current_sections.join("\n\n"),
        });
    }
    chunks
}

fn take_first_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn take_last_chars(value: &str, max_chars: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    chars[chars.len().saturating_sub(max_chars)..]
        .iter()
        .collect()
}

fn build_series_chunk_boundary_context(
    chunks: &[SeriesSubtitleChunk],
    chunk_index: usize,
    max_chars_per_side: usize,
) -> String {
    let previous = chunk_index
        .checked_sub(1)
        .and_then(|index| chunks.get(index))
        .map(|chunk| chunk.text.as_str());
    let next = chunks.get(chunk_index + 1).map(|chunk| chunk.text.as_str());
    build_neighbor_text_boundary_context(previous, next, max_chars_per_side)
}

fn build_neighbor_text_boundary_context(
    previous: Option<&str>,
    next: Option<&str>,
    max_chars_per_side: usize,
) -> String {
    let mut sections = Vec::new();
    if let Some(previous) = previous {
        sections.push(format!(
            "【上一批结尾】\n{}",
            take_last_chars(previous, max_chars_per_side)
        ));
    }
    if let Some(next) = next {
        sections.push(format!(
            "【下一批开头】\n{}",
            take_first_chars(next, max_chars_per_side)
        ));
    }
    if sections.is_empty() {
        "无相邻批次".to_string()
    } else {
        sections.join("\n\n")
    }
}

fn series_script_section_episode_number(section: &str) -> Option<i64> {
    let heading = section.lines().next()?.trim();
    let suffix = heading.strip_prefix("## 第")?;
    let digits = suffix
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn validate_series_script_chunk(
    script: &str,
    expected_episode_numbers: &[i64],
) -> Result<Vec<String>, String> {
    let sections = split_series_script_sections(script);
    let actual_episode_numbers = sections
        .iter()
        .filter_map(|section| series_script_section_episode_number(section))
        .collect::<Vec<_>>();
    if actual_episode_numbers != expected_episode_numbers {
        return Err(format!(
            "合集剧本生成不完整：预期包含第 {} 段，实际包含第 {} 段，请重试",
            expected_episode_numbers
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("、"),
            if actual_episode_numbers.is_empty() {
                "无".to_string()
            } else {
                actual_episode_numbers
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("、")
            }
        ));
    }
    Ok(sections)
}

fn status_label_for_backend(status: &str) -> &'static str {
    match status {
        "pending" => "准备中",
        "extracting" => "提取音频中",
        "transcribing" => "识别字幕中",
        "subtitle_ready" => "字幕已完成",
        "generating_script" => "生成剧本中",
        "script_ready" => "剧本已完成",
        "importing" => "创建项目中",
        "imported" => "已完成",
        "failed" => "失败",
        "cancelled" => "已取消",
        _ => "未完成",
    }
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
        series_id: row.get(17)?,
        episode_number: row.get(18)?,
        is_series_group: row.get(19)?,
    })
}

fn load_artifacts(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<VideoImportArtifactView>, ApiError> {
    let mut stmt = conn
        .prepare("SELECT id, task_id, kind, path, mime_type, size_bytes, sha256, metadata_json, created_at FROM video_import_artifacts WHERE task_id = ?1 ORDER BY created_at DESC")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt
        .query_map(params![task_id], |row| {
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

fn load_step_runs(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<VideoImportStepRunView>, ApiError> {
    let mut stmt = conn
        .prepare("SELECT id, task_id, step, attempt, status, started_at, ended_at, duration_ms, provider, external_task_id, error_message, metadata_json FROM video_import_step_runs WHERE task_id = ?1 ORDER BY started_at DESC LIMIT 100")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt
        .query_map(params![task_id], |row| {
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

fn latest_artifact_text(
    conn: &Connection,
    task_id: &str,
    kind: &str,
) -> Result<Option<String>, ApiError> {
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

fn start_step_run(
    conn: &Connection,
    task_id: &str,
    step: &str,
    provider: Option<&str>,
) -> Result<String, ApiError> {
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
         WHERE id = ?8 AND status != 'cancelled'",
        params![
            status,
            current_step,
            progress,
            error_message,
            now,
            completed_at,
            now,
            task_id
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn ensure_video_import_task_active(conn: &Connection, task_id: &str) -> Result<(), ApiError> {
    let status = conn
        .query_row(
            "SELECT status FROM video_import_tasks WHERE id = ?1 LIMIT 1",
            params![task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "视频导入任务不存在"))?;
    if status == "cancelled" {
        return Err(ApiError::new(StatusCode::CONFLICT, "视频导入任务已取消"));
    }
    Ok(())
}

fn ensure_video_import_cancellation_state(
    cancellation: Option<(&BackendState, &str)>,
) -> Result<(), ApiError> {
    let Some((state, task_id)) = cancellation else {
        return Ok(());
    };
    let conn = db_connection(state)?;
    ensure_video_import_task_active(&conn, task_id)
}

fn mark_task_failed(
    state: &BackendState,
    task_id: &str,
    step: &str,
    message: &str,
) -> Result<(), ApiError> {
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

fn cleanup_empty_import_project(conn: &Connection, project_id: &str) -> Result<(), ApiError> {
    conn.execute(
        "DELETE FROM projects
         WHERE id = ?1
           AND NOT EXISTS (SELECT 1 FROM scripts WHERE project_id = ?1 LIMIT 1)",
        params![project_id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
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
        Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "Bcut ASR 未识别到字幕",
        ))
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

fn is_short_clip_series_task(task: &VideoImportTaskRecord) -> bool {
    parse_json_object(&task.config_json)
        .get("seriesImportMode")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "short_clips")
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
        "mp4"
            | "mov"
            | "mkv"
            | "avi"
            | "webm"
            | "flv"
            | "wmv"
            | "m4v"
            | "mpeg"
            | "mpg"
            | "ts"
            | "m2ts"
            | "mts"
            | "3gp"
    ) {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的视频格式"))
    }
}

fn validate_asr_media_extension(extension: &str) -> Result<(), ApiError> {
    if matches!(
        extension,
        "mp3"
            | "wav"
            | "m4a"
            | "aac"
            | "flac"
            | "ogg"
            | "opus"
            | "wma"
            | "amr"
            | "mp4"
            | "mov"
            | "mkv"
            | "avi"
            | "webm"
            | "flv"
            | "wmv"
            | "m4v"
            | "mpeg"
            | "mpg"
            | "ts"
            | "m2ts"
            | "mts"
            | "3gp"
    ) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不支持的音频或视频格式",
        ))
    }
}

fn scan_series_video_files(folder: &FsPath) -> Result<Vec<(String, PathBuf)>, ApiError> {
    if !folder.is_dir() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "路径必须是文件夹"));
    }

    let mut video_files = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("读取文件夹失败: {}", error),
        )
    })? {
        let entry = entry
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(filename) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(extension) = file_extension(filename) else {
            continue;
        };
        if validate_video_extension(&extension).is_ok() {
            video_files.push((filename.to_string(), path));
        }
    }

    video_files.sort_by(|a, b| compare_episode_filenames(&a.0, &b.0));
    Ok(video_files)
}

fn build_series_duration_summary(video_files: &[(String, PathBuf)]) -> SeriesDurationSummary {
    let durations = video_files
        .iter()
        .filter_map(|(_, path)| probe_video_duration_seconds(path).ok().flatten())
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect::<Vec<_>>();
    let known_count = durations.len();
    let short_count = durations
        .iter()
        .filter(|value| **value <= SHORT_CLIP_MAX_SECONDS)
        .count();
    let total_seconds = durations.iter().sum::<f64>();
    let average_seconds = if known_count > 0 {
        Some(total_seconds / known_count as f64)
    } else {
        None
    };
    let short_clip_recommended = known_count > 0
        && (short_count as f64 / known_count as f64) >= SHORT_CLIP_MIN_RATIO
        && video_files.len() > 1;

    SeriesDurationSummary {
        known_count,
        short_count,
        total_seconds,
        average_seconds,
        short_clip_recommended,
    }
}

fn probe_video_duration_seconds(path: &FsPath) -> Result<Option<f64>, ApiError> {
    let ffprobe = std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".to_string());
    let output = hidden_command(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output();
    let Ok(output) = output else {
        return Ok(None);
    };
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    Ok(raw.trim().parse::<f64>().ok())
}

fn compare_episode_filenames(a: &str, b: &str) -> std::cmp::Ordering {
    match (first_number_in_text(a), first_number_in_text(b)) {
        (Some(left), Some(right)) if left != right => left.cmp(&right),
        _ => a.cmp(b),
    }
}

fn first_number_in_text(value: &str) -> Option<i64> {
    let mut number = String::new();
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            number.push(ch);
        } else if !number.is_empty() {
            break;
        }
    }
    number.parse::<i64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asr_history_id_validation_rejects_path_traversal() {
        assert!(validate_asr_history_id("asr_0123456789abcdef").is_ok());
        assert!(validate_asr_history_id("../../asr_record").is_err());
        assert!(validate_asr_history_id("asr_record.json").is_err());
    }

    #[test]
    fn asr_media_kind_distinguishes_audio_and_video() {
        assert_eq!(asr_media_kind("mp3"), "audio");
        assert_eq!(asr_media_kind("mp4"), "video");
    }

    #[test]
    fn bcut_upload_retries_only_transient_statuses() {
        assert!(is_transient_bcut_status(
            reqwest::StatusCode::REQUEST_TIMEOUT
        ));
        assert!(is_transient_bcut_status(
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(is_transient_bcut_status(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!is_transient_bcut_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!is_transient_bcut_status(reqwest::StatusCode::UNAUTHORIZED));
    }

    #[test]
    fn bcut_upload_retry_uses_exponential_backoff() {
        assert_eq!(bcut_upload_retry_delay_ms(1), 1_000);
        assert_eq!(bcut_upload_retry_delay_ms(2), 2_000);
        assert_eq!(bcut_upload_retry_delay_ms(3), 4_000);
    }

    #[test]
    fn split_series_script_sections_drops_prelude_when_episode_headings_exist() {
        let sections = split_series_script_sections(
            "# 总标题\n\n## 角色\n- A\n\n## 第1段：开场\n正文1\n\n## 第2集：反转\n正文2",
        );

        assert_eq!(sections.len(), 2);
        assert!(sections[0].starts_with("## 第1段"));
        assert!(sections[1].starts_with("## 第2集"));
        assert!(!sections[0].contains("## 角色"));
    }

    fn subtitle_section(episode_number: i64, subtitle: String) -> SeriesSubtitleSection {
        SeriesSubtitleSection {
            episode_number,
            title: format!("片段{episode_number}"),
            subtitle,
        }
    }

    #[test]
    fn short_clip_script_chunks_limit_episode_count() {
        let sections = (1..=25)
            .map(|episode| subtitle_section(episode, "字幕内容".to_string()))
            .collect();

        let chunks = split_series_subtitle_chunks(sections);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].episode_numbers, (1..=12).collect::<Vec<_>>());
        assert_eq!(chunks[1].episode_numbers, (13..=24).collect::<Vec<_>>());
        assert_eq!(chunks[2].episode_numbers, vec![25]);
        assert_eq!(SERIES_SCRIPT_MAX_CONCURRENT_GENERATIONS, 3);
    }

    #[test]
    fn short_clip_script_chunks_limit_character_count_without_splitting_episode() {
        let sections = vec![
            subtitle_section(1, "甲".repeat(3_500)),
            subtitle_section(2, "乙".repeat(3_500)),
        ];

        let chunks = split_series_subtitle_chunks(sections);

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].episode_numbers, vec![1]);
        assert_eq!(chunks[1].episode_numbers, vec![2]);
        assert!(chunks[0].text.contains(&"甲".repeat(3_500)));
    }

    #[test]
    fn series_script_chunk_validation_requires_every_expected_episode() {
        let complete = "## 第9段：开场\n正文9\n\n## 第10段：反转\n正文10";
        let incomplete = "## 第9段：开场\n正文9";

        assert_eq!(
            validate_series_script_chunk(complete, &[9, 10])
                .unwrap()
                .len(),
            2
        );
        let error = validate_series_script_chunk(incomplete, &[9, 10]).unwrap_err();
        assert!(error.contains("预期包含第 9、10 段"));
        assert!(error.contains("实际包含第 9 段"));
    }

    #[test]
    fn series_script_chunk_boundary_context_includes_both_neighbors() {
        let sections = (1..=25)
            .map(|episode| subtitle_section(episode, format!("第{episode}段字幕")))
            .collect();
        let chunks = split_series_subtitle_chunks(sections);

        let context = build_series_chunk_boundary_context(&chunks, 1, 800);

        assert!(context.contains("【上一批结尾】"));
        assert!(context.contains("第12段字幕"));
        assert!(context.contains("【下一批开头】"));
        assert!(context.contains("第25段字幕"));
    }
}
