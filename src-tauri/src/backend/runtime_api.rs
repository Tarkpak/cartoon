use super::*;
use axum::body::{Body, Bytes};
use futures_util::stream;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::convert::Infallible;
use std::process::Command;
use ve_tos_rust_sdk::object::{ListObjectsType2Input, ObjectAPI};
use ve_tos_rust_sdk::tos;

type HmacSha256 = Hmac<Sha256>;

const PROMPT_TEMPLATE_SCRIPT_EPISODE_PLAN: &str = "script_episode_plan";
const PROMPT_TEMPLATE_SCRIPT_PARSING: &str = "script_parsing";
const PROMPT_TEMPLATE_SCRIPT_PARSING_SHORT_DRAMA: &str = "script_parsing_short_drama";
const PROMPT_TEMPLATE_SCRIPT_PARSING_EPISODE_DRAMA_CONTEXT: &str =
    "script_parsing_episode_drama_context";
const PROMPT_TEMPLATE_CHARACTER_SHEET: &str = "character_sheet";
const PROMPT_TEMPLATE_CHARACTER_REGENERATION: &str = "character_regeneration";
const PROMPT_TEMPLATE_ENVIRONMENT_REFERENCE_GENERATION: &str = "environment_reference_generation";
const PROMPT_TEMPLATE_PROP_ASSET_GENERATION: &str = "prop_asset_generation";
const PROMPT_TEMPLATE_SCENE_DESCRIPTION_REFINEMENT: &str = "scene_description_refinement";
const PROMPT_TEMPLATE_SCENE_VIDEO_GENERATION: &str = "scene_video_generation";
const SCRIPT_PARSE_MIN_DURATION: &str = "2";
const SCRIPT_PARSE_MAX_DURATION: &str = "15";
const ENVIRONMENT_CAPTURE_MODE_PROMPT_RULES: &str = "【环境视角打标（必须执行）】\n1. 每个 scenes[i] 必须输出 environmentCaptureMode 字段：single 或 four_view。\n2. 当场景描述存在明确多视角/多机位/镜头切换（含时间轴多段切镜）时，environmentCaptureMode=four_view。\n3. 单一连续视角表达时，environmentCaptureMode=single。\n4. 禁止省略该字段。";

fn render_runtime_prompt(template: &str, variables: &[(&str, &str)]) -> String {
    let mut output = template.to_string();
    for (key, value) in variables {
        output = output.replace(&format!("{{{{{key}}}}}"), value);
    }
    output
}

#[cfg(debug_assertions)]
macro_rules! llm_dev_log {
    ($phase:expr, $provider:expr, $model:expr, $operation:expr, $duration_ms:expr $(, $key:expr => $value:expr)* $(,)?) => {{
        let fields: Vec<(&str, String)> = vec![
            $(($key, $value.to_string())),*
        ];
        llm_dev_log_line($phase, $provider, $model, $operation, $duration_ms, &fields);
    }};
}

#[cfg(not(debug_assertions))]
macro_rules! llm_dev_log {
    ($($tokens:tt)*) => {};
}

fn llm_dev_log_preview(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_chars {
        return compact;
    }

    let truncated = compact.chars().take(max_chars).collect::<String>();
    format!("{}...", truncated)
}

fn llm_dev_log_source_summary(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.starts_with("data:") {
        return format!("data-url({} chars)", trimmed.len());
    }
    if is_http_url(trimmed) {
        return llm_dev_log_url_summary(trimmed, 220);
    }
    format!("base64-or-inline({} chars)", trimmed.len())
}

fn llm_dev_log_url_summary(value: &str, max_chars: usize) -> String {
    let query_index = value.find('?');
    let fragment_index = value.find('#');
    let cut_index = match (query_index, fragment_index) {
        (Some(query), Some(fragment)) => Some(query.min(fragment)),
        (Some(query), None) => Some(query),
        (None, Some(fragment)) => Some(fragment),
        (None, None) => None,
    };

    if let Some(index) = cut_index {
        return format!("{}?...", llm_dev_log_preview(&value[..index], max_chars));
    }

    llm_dev_log_preview(value, max_chars)
}

fn llm_dev_log_line_value(value: &str) -> String {
    llm_dev_log_preview(&value.replace('\n', "\\n"), 500)
}

fn llm_dev_log_line(
    phase: &str,
    provider: &str,
    model: &str,
    operation: &str,
    duration_ms: Option<i64>,
    fields: &[(&str, String)],
) {
    let mut parts = vec![
        format!("provider={}", llm_dev_log_line_value(provider)),
        format!("model={}", llm_dev_log_line_value(model)),
        format!("operation={}", llm_dev_log_line_value(operation)),
    ];

    if let Some(duration_ms) = duration_ms {
        parts.push(format!("durationMs={}", duration_ms.max(1)));
    }

    for (key, value) in fields {
        let rendered = if key.eq_ignore_ascii_case("endpoint") {
            llm_dev_log_url_summary(value, 500)
        } else {
            llm_dev_log_line_value(value)
        };
        parts.push(format!("{}={}", key, rendered));
    }

    eprintln!("[LLM][{}] {}", phase, parts.join(" "));
}

fn llm_dev_log_url_without_query(value: &str) -> String {
    let trimmed = value.trim();
    if let Ok(mut url) = reqwest::Url::parse(trimmed) {
        url.set_query(None);
        url.set_fragment(None);
        return url.to_string();
    }

    let query_index = trimmed.find('?');
    let fragment_index = trimmed.find('#');
    let cut_index = match (query_index, fragment_index) {
        (Some(query), Some(fragment)) => Some(query.min(fragment)),
        (Some(query), None) => Some(query),
        (None, Some(fragment)) => Some(fragment),
        (None, None) => None,
    };

    cut_index
        .map(|index| trimmed[..index].to_string())
        .unwrap_or_else(|| trimmed.to_string())
}

fn llm_dev_file_key_is_sensitive(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("apikey")
        || normalized.contains("api_key")
        || normalized.contains("accesskey")
        || normalized.contains("access_key")
        || normalized.contains("secret")
        || normalized.contains("token")
        || normalized == "authorization"
        || normalized == "key"
}

fn llm_dev_file_key_is_media(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("image")
        || normalized.contains("audio")
        || normalized.contains("video")
        || normalized.contains("base64")
        || normalized.contains("b64")
        || normalized.contains("inline")
        || normalized.contains("reference")
        || normalized.contains("source")
}

fn llm_dev_file_sanitize_string(key: Option<&str>, value: &str) -> Value {
    if key.is_some_and(llm_dev_file_key_is_sensitive) {
        return json!("<redacted>");
    }

    let trimmed = value.trim();
    if is_http_url(trimmed) {
        return json!(llm_dev_log_url_without_query(trimmed));
    }

    let key_is_media = key.is_some_and(llm_dev_file_key_is_media);
    if trimmed.starts_with("data:") {
        return json!({
          "kind": "data-url",
          "chars": value.chars().count(),
          "preview": llm_dev_log_preview(value, 160)
        });
    }
    if key_is_media && value.chars().count() > 4096 {
        return json!({
          "kind": "large-media-or-inline-string",
          "chars": value.chars().count(),
          "preview": llm_dev_log_preview(value, 160)
        });
    }

    json!(value)
}

fn llm_dev_file_sanitize_value(value: &Value, key: Option<&str>) -> Value {
    match value {
        Value::String(text) => llm_dev_file_sanitize_string(key, text),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| llm_dev_file_sanitize_value(item, key))
                .collect(),
        ),
        Value::Object(object) => {
            let mut sanitized = serde_json::Map::new();
            for (child_key, child_value) in object {
                sanitized.insert(
                    child_key.clone(),
                    llm_dev_file_sanitize_value(child_value, Some(child_key)),
                );
            }
            Value::Object(sanitized)
        }
        _ => value.clone(),
    }
}

fn llm_dev_file_response_raw_value(raw: &str) -> Value {
    if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
        return llm_dev_file_sanitize_value(&parsed, None);
    }
    if raw.chars().count() > 200_000 {
        return json!({
          "kind": "large-raw-response",
          "chars": raw.chars().count(),
          "preview": llm_dev_log_preview(raw, 400)
        });
    }
    json!(raw)
}

fn llm_dev_write_db_log(
    provider: &str,
    model: &str,
    operation: &str,
    status: &str,
    started_at_ms: i64,
    endpoint: Option<&str>,
    request: Option<&Value>,
    response: Option<&Value>,
    response_raw: Option<&str>,
    error: Option<&str>,
) {
    llm_dev_write_db_log_impl(
        provider,
        model,
        operation,
        status,
        started_at_ms,
        endpoint,
        request,
        response,
        response_raw,
        error,
    );
}

fn llm_dev_write_db_log_impl(
    provider: &str,
    model: &str,
    operation: &str,
    status: &str,
    started_at_ms: i64,
    endpoint: Option<&str>,
    request: Option<&Value>,
    response: Option<&Value>,
    response_raw: Option<&str>,
    error: Option<&str>,
) {
    let now = Utc::now();
    let duration_ms = (now.timestamp_millis() - started_at_ms).max(1);
    let endpoint_value = endpoint.map(llm_dev_log_url_without_query);
    let request_id = current_request_id();
    let context = current_model_log_context();
    let request_value = request.map(|value| llm_dev_file_sanitize_value(value, None));
    let response_value = response.map(|value| llm_dev_file_sanitize_value(value, None));
    let response_raw_value = response_raw.map(llm_dev_file_response_raw_value);
    let error_value = error.map(|message| json!({ "message": message }));
    let log_payload = json!({
      "requestId": request_id.clone(),
      "provider": provider,
      "modelId": model,
      "operation": operation,
      "projectId": context.project_id.clone(),
      "sceneId": context.scene_id.clone(),
      "status": status,
      "durationMs": duration_ms,
      "errorMessage": error.unwrap_or_default(),
      "request": request_value.clone().unwrap_or(Value::Null),
      "response": response_value
        .clone()
        .or(response_raw_value.clone())
        .unwrap_or(Value::Null),
      "error": error_value.clone().unwrap_or(Value::Null),
      "createdAt": now.to_rfc3339()
    });

    if let Some(conn) = config_connection() {
        let _ = conn.execute(
            "INSERT INTO model_debug_logs (
          id, timestamp, provider, model, operation, status, duration_ms, endpoint, request_id,
          project_id, scene_id, task_id, request_json, request_raw_json, response_json,
          response_raw_json, media_refs_json, error_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                format!("log_{}", Uuid::new_v4().simple()),
                now.to_rfc3339(),
                provider,
                model,
                operation,
                status,
                duration_ms,
                endpoint_value,
                request_id,
                context.project_id,
                context.scene_id,
                context.task_id,
                request_value.as_ref().map(Value::to_string),
                request_value.as_ref().map(Value::to_string),
                response_value.as_ref().map(Value::to_string),
                response_raw_value.as_ref().map(Value::to_string),
                None::<String>,
                error_value.as_ref().map(Value::to_string),
                now_iso()
            ],
        );
        if should_run_log_retention() {
            prune_log_table(&conn, "model_debug_logs", MODEL_DEBUG_LOG_RETENTION_LIMIT);
        }
    }
    cloud_spawn_model_call_log_upload(log_payload);
}

async fn resolve_source_bytes(
    state: &BackendState,
    source: &str,
    max_bytes: usize,
) -> Result<(Vec<u8>, Option<String>), ApiError> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "资源内容不能为空"));
    }

    if let Some((mime, bytes)) = parse_data_url(trimmed) {
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, Some(mime)));
    }

    if is_http_url(trimmed) {
        let response = http_client()
            .get(trimmed)
            .send()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
        if !response.status().is_success() {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("下载资源失败: {}", response.status()),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }

        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase()
            })
            .filter(|value| !value.is_empty());
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
            .to_vec();
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, mime));
    }

    if let Some(path) = resolve_api_file_path(
        trimmed,
        "/api/image/file/",
        &state.public_dir.join("generated-images"),
    ) {
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "图片文件不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }
    if let Some(path) = resolve_api_file_path(
        trimmed,
        "/api/video/file/",
        &state.public_dir.join("videos"),
    ) {
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "媒体文件不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }
    if let Some(rest) = trimmed.strip_prefix("/generated-images/") {
        if let Some(safe) = sanitize_rel_path(rest) {
            if !safe.contains('/') {
                let path = state.public_dir.join("generated-images").join(safe);
                let bytes = fs::read(&path)
                    .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "图片文件不存在"))?;
                return Ok((
                    bytes,
                    Some(
                        path_content_type(&path)
                            .split(';')
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    ),
                ));
            }
        }
    }
    if let Some(rest) = trimmed.strip_prefix("/videos/") {
        if let Some(safe) = sanitize_rel_path(rest) {
            if !safe.contains('/') {
                let path = state.public_dir.join("videos").join(safe);
                let bytes = fs::read(&path)
                    .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?;
                return Ok((
                    bytes,
                    Some(
                        path_content_type(&path)
                            .split(';')
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    ),
                ));
            }
        }
    }
    if trimmed.starts_with('/') {
        let safe = sanitize_rel_path(trimmed)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效本地资源路径"))?;
        let path = state.public_dir.join(safe);
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "本地资源不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }

    if let Some(bytes) = decode_base64_bytes(trimmed) {
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, None));
    }

    Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的资源格式"))
}

async fn persist_image_source(
    state: &BackendState,
    source: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    let (bytes, mime) = resolve_source_bytes(state, source, 35 * 1024 * 1024).await?;
    let detected_mime = detect_image_proxy_mime_type(&bytes);
    let normalized_mime = mime
        .as_deref()
        .filter(|value| value.starts_with("image/"))
        .or(detected_mime)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "仅支持图片 dataURL、base64 或图片 URL",
            )
        })?;
    persist_image_bytes_async(state, prefix, Some(normalized_mime), "png", bytes).await
}

async fn upload_media_bytes_to_tos_async(
    category: &'static str,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, ApiError> {
    tokio::task::spawn_blocking(move || upload_media_bytes_to_tos(category, &filename, &bytes))
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("等待 TOS 上传任务失败: {}", error),
            )
        })?
}

async fn persist_image_bytes_async(
    state: &BackendState,
    prefix: &str,
    mime_type: Option<&str>,
    fallback_ext: &str,
    bytes: Vec<u8>,
) -> Result<String, ApiError> {
    let ext = infer_extension_from_mime(mime_type.unwrap_or(""), fallback_ext);
    let filename = build_unique_filename(prefix, &ext);
    if load_backend_tos_config().enabled {
        return match upload_media_bytes_to_tos_async("images", filename, bytes).await? {
            Some(url) => Ok(url),
            None => Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "TOS 已启用但未返回图片上传地址",
            )),
        };
    }
    let path = state.public_dir.join("generated-images").join(&filename);
    write_file_bytes(&path, &bytes)?;
    Ok(format!("/api/image/file/{}", filename))
}

fn detect_audio_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && &bytes[0..3] == b"ID3" {
        return Some("audio/mpeg");
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0 {
        return Some("audio/mpeg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"OggS" {
        return Some("audio/ogg");
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"fLaC" {
        return Some("audio/flac");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some("audio/mp4");
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"\x1a\x45\xdf\xa3" {
        return Some("audio/webm");
    }
    None
}

async fn normalize_image_reference_sources(
    state: &BackendState,
    sources: Vec<String>,
    limit: usize,
) -> Result<Vec<String>, ApiError> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for source in sources.into_iter().take(limit) {
        let raw = source.trim();
        if raw.is_empty() {
            continue;
        }
        let (bytes, mime) = resolve_source_bytes(state, raw, 35 * 1024 * 1024).await?;
        let mime = mime
            .filter(|value| value.starts_with("image/"))
            .unwrap_or_else(|| {
                detect_image_proxy_mime_type(&bytes)
                    .unwrap_or("image/png")
                    .to_string()
            });
        let normalized = format!("data:{};base64,{}", mime, BASE64_STANDARD.encode(bytes));
        if seen.insert(normalized.clone()) {
            output.push(normalized);
        }
    }
    Ok(output)
}

fn push_optional_reference_source(target: &mut Vec<String>, value: Option<&Value>) {
    if let Some(raw) = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        target.push(raw.to_string());
    }
}

fn push_reference_source_array(target: &mut Vec<String>, value: Option<&Value>) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    for item in items {
        push_optional_reference_source(target, Some(item));
    }
}

async fn persist_video_source(
    state: &BackendState,
    source: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    let (bytes, mime) = resolve_source_bytes(state, source, 250 * 1024 * 1024).await?;
    persist_video_bytes_async(state, prefix, mime.as_deref(), "mp4", bytes).await
}

async fn persist_video_bytes_async(
    state: &BackendState,
    prefix: &str,
    mime_type: Option<&str>,
    fallback_ext: &str,
    bytes: Vec<u8>,
) -> Result<String, ApiError> {
    let ext = infer_extension_from_mime(mime_type.unwrap_or(""), fallback_ext);
    let filename = build_unique_filename(prefix, &ext);
    if load_backend_tos_config().enabled {
        return match upload_media_bytes_to_tos_async("videos", filename, bytes).await? {
            Some(url) => Ok(url),
            None => Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "TOS 已启用但未返回视频上传地址",
            )),
        };
    }
    let path = state.public_dir.join("videos").join(&filename);
    write_file_bytes(&path, &bytes)?;
    Ok(format!("/api/video/file/{}", filename))
}

async fn persist_audio_bytes_async(
    state: &BackendState,
    prefix: &str,
    mime_type: Option<&str>,
    bytes: Vec<u8>,
) -> Result<String, ApiError> {
    let ext = infer_extension_from_mime(mime_type.unwrap_or(""), "mp3");
    let filename = build_unique_filename(prefix, &ext);
    if load_backend_tos_config().enabled {
        return match upload_media_bytes_to_tos_async("voice-assets", filename, bytes).await? {
            Some(url) => Ok(url),
            None => Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "TOS 已启用但未返回音频上传地址",
            )),
        };
    }
    let path = state.public_dir.join("audios").join(&filename);
    write_file_bytes(&path, &bytes)?;
    Ok(format!("/audios/{}", filename))
}

async fn persist_audio_source(
    state: &BackendState,
    source: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    let trimmed = source.trim();
    if !(trimmed.starts_with("data:audio/") || is_http_url(trimmed)) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持音频 dataURL 或音频 URL",
        ));
    }
    let (bytes, mime) = resolve_source_bytes(state, trimmed, 40 * 1024 * 1024).await?;
    let detected_mime = detect_audio_mime_type(&bytes);
    let normalized_mime = mime
        .as_deref()
        .filter(|value| value.starts_with("audio/"))
        .or(detected_mime)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "仅支持音频 dataURL 或音频 URL"))?;
    persist_audio_bytes_async(state, prefix, Some(normalized_mime), bytes).await
}

fn extract_scene_split_lines(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = normalized
        .split('\n')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return vec![];
    }

    if lines.len() == 1 {
        let one = lines.remove(0);
        let chunks = one
            .split(['。', '！', '？', ';', '；'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !chunks.is_empty() {
            return chunks;
        }
        return vec![one];
    }

    lines
}

fn extract_character_names(text: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some((speaker, _content)) = trimmed.split_once('：') {
            let candidate = speaker.trim();
            if !candidate.is_empty()
                && candidate.chars().count() <= 8
                && !names.iter().any(|item| item == candidate)
            {
                names.push(candidate.to_string());
            }
        }
        if names.len() >= 8 {
            break;
        }
    }
    names
}

const EPISODE_PLAN_SINGLE_PASS_MAX_CHARS: usize = 32_000;
const EPISODE_PLAN_CHUNK_TARGET_CHARS: usize = 24_000;
const EPISODE_PLAN_CHUNK_MAX_CHARS: usize = 32_000;
const EPISODE_PLAN_CHUNK_MIN_CHARS: usize = 10_000;
const EPISODE_PLAN_MAX_CHUNK_COUNT: usize = 64;
const SCRIPT_PARSE_MAX_TEXT_CHARS: usize = EPISODE_PLAN_CHUNK_MAX_CHARS;

struct EpisodePlanChunk {
    index: usize,
    start_offset: usize,
    end_offset: usize,
    text: String,
}

fn normalize_script_input_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn find_backward_break(
    chars: &[char],
    from: usize,
    min: usize,
    break_chars: &[char],
) -> Option<usize> {
    let mut cursor = from.min(chars.len());
    while cursor > min {
        cursor -= 1;
        if break_chars.contains(&chars[cursor]) {
            return Some(cursor + 1);
        }
    }
    None
}

fn find_forward_break(
    chars: &[char],
    from: usize,
    max: usize,
    break_chars: &[char],
) -> Option<usize> {
    let upper = max.min(chars.len());
    for index in from.min(upper)..upper {
        if break_chars.contains(&chars[index]) {
            return Some(index + 1);
        }
    }
    None
}

fn resolve_episode_chunk_break(chars: &[char], cursor: usize) -> usize {
    let min_offset = (cursor + EPISODE_PLAN_CHUNK_MIN_CHARS).min(chars.len());
    let preferred_offset = (cursor + EPISODE_PLAN_CHUNK_TARGET_CHARS).min(chars.len());
    let max_offset = (cursor + EPISODE_PLAN_CHUNK_MAX_CHARS).min(chars.len());
    if max_offset >= chars.len() {
        return chars.len();
    }

    for marker in ["\n\n", "\n"] {
        let marker_chars = marker.chars().collect::<Vec<_>>();
        let mut best = None;
        let start = min_offset.min(preferred_offset);
        let end = max_offset.min(chars.len());
        for index in start..end.saturating_sub(marker_chars.len().saturating_sub(1)) {
            if chars[index..].starts_with(&marker_chars) {
                let candidate = index + marker_chars.len();
                if best
                    .map(|current: usize| {
                        candidate.abs_diff(preferred_offset) < current.abs_diff(preferred_offset)
                    })
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        if let Some(candidate) = best {
            return candidate;
        }
    }

    let sentence_breaks = ['。', '！', '？', '!', '?'];
    if let Some(candidate) =
        find_backward_break(chars, preferred_offset, min_offset, &sentence_breaks)
    {
        return candidate;
    }
    if let Some(candidate) =
        find_forward_break(chars, preferred_offset, max_offset, &sentence_breaks)
    {
        return candidate;
    }
    let punctuation_breaks = ['；', ';', '，', ',', '、'];
    find_backward_break(chars, preferred_offset, min_offset, &punctuation_breaks)
        .unwrap_or(max_offset)
}

fn split_text_into_episode_plan_chunks(text: &str) -> Vec<EpisodePlanChunk> {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
    }
    if chars.len() <= EPISODE_PLAN_CHUNK_MAX_CHARS {
        return vec![EpisodePlanChunk {
            index: 1,
            start_offset: 0,
            end_offset: chars.len(),
            text: text.to_string(),
        }];
    }

    let mut chunks = Vec::new();
    let mut cursor = 0usize;
    while cursor < chars.len() && chunks.len() < EPISODE_PLAN_MAX_CHUNK_COUNT {
        let next = resolve_episode_chunk_break(&chars, cursor)
            .max(cursor + 1)
            .min(chars.len());
        chunks.push(EpisodePlanChunk {
            index: chunks.len() + 1,
            start_offset: cursor,
            end_offset: next,
            text: chars[cursor..next].iter().collect(),
        });
        cursor = next;
    }
    if cursor < chars.len() {
        chunks.push(EpisodePlanChunk {
            index: chunks.len() + 1,
            start_offset: cursor,
            end_offset: chars.len(),
            text: chars[cursor..].iter().collect(),
        });
    }
    chunks
}

fn build_parsed_script_payload(body: &Value) -> Value {
    let raw_text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let parse_mode = json_string(body.get("scriptParseMode"), "short_drama");
    let style = json_string(body.get("style"), "默认画风");
    let lines = extract_scene_split_lines(raw_text);
    let episode_plan = body
        .get("episodePlan")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_episode_plan = !episode_plan.is_empty();
    let scenes_per_episode = if has_episode_plan {
        ((lines.len() as f64) / (episode_plan.len() as f64))
            .ceil()
            .max(1.0) as usize
    } else {
        4usize
    };
    let characters = extract_character_names(raw_text);

    let scenes = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let episode_index = if has_episode_plan {
                (index / scenes_per_episode).min(episode_plan.len().saturating_sub(1))
            } else {
                0
            };
            let episode_meta = episode_plan.get(episode_index);
            let episode_id = episode_meta
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("episode_001");
            let episode_title = episode_meta
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("第1集");
            let episode_number = episode_meta
                .and_then(|item| item.get("index"))
                .and_then(Value::as_i64)
                .unwrap_or(1);
            let duration = 8i64;
            json!({
              "id": format!("scene_{:03}", index + 1),
              "episodeId": episode_id,
              "episodeTitle": episode_title,
              "episodeIndex": episode_number,
              "title": format!("场景 {}", index + 1),
              "description": format!("0-{}秒：中景，固定镜头。{}", duration, line.trim()),
              "characters": characters.iter().take(3).map(|name| json!({"name": name})).collect::<Vec<_>>(),
              "narration": Value::Null,
              "duration": duration,
              "setting": {
                "location": "未指定场景",
                "timeOfDay": "day"
              }
            })
        })
        .collect::<Vec<_>>();

    let formatted_lines = scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let title = scene.get("title").and_then(Value::as_str).unwrap_or("场景");
            let desc = scene
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("暂无描述");
            format!("场景 {} - {}: {}", index + 1, title, desc)
        })
        .collect::<Vec<_>>();

    json!({
      "success": true,
      "data": {
        "title": format!("{}脚本", style),
        "scenes": scenes,
        "characters": characters.into_iter().map(|name| json!({"name": name, "role": "supporting"})).collect::<Vec<_>>()
      },
      "formattedTimeline": {
        "lines": formatted_lines,
        "text": formatted_lines.join("\n")
      },
      "parseStrategy": {
        "segmented": has_episode_plan && episode_plan.len() > 1,
        "chunkCount": if has_episode_plan { episode_plan.len() } else { 1 },
        "episodeCount": if has_episode_plan { episode_plan.len() } else { 1 },
        "recommendedMinScenes": scenes_per_episode.max(1),
        "scriptParseMode": parse_mode
      }
    })
}

fn scene_duration_seconds(scene: &Value) -> f64 {
    scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(8.0)
}

fn episode_title_for_split(base_title: &str, split_index: usize) -> String {
    if split_index <= 1 {
        base_title.to_string()
    } else {
        format!("{}-{}", base_title, split_index)
    }
}

fn enforce_short_drama_episode_duration_limit(mut payload: Value, limit_seconds: f64) -> Value {
    if limit_seconds <= 0.0 || !limit_seconds.is_finite() {
        return payload;
    }

    let Some(data) = payload.get_mut("data").and_then(Value::as_object_mut) else {
        return payload;
    };
    let Some(scene_values) = data.get("scenes").and_then(Value::as_array).cloned() else {
        return payload;
    };
    if scene_values.is_empty() {
        return payload;
    }

    let mut next_scenes = Vec::new();
    let mut next_episodes = Vec::new();
    let mut current_source_episode = String::new();
    let mut current_base_title = String::new();
    let mut current_split_index = 0usize;
    let mut current_episode_duration = 0.0f64;
    let mut did_split = false;

    for (scene_index, scene) in scene_values.into_iter().enumerate() {
        let mut scene_obj = scene.as_object().cloned().unwrap_or_default();
        let source_episode_id = scene_obj
            .get("episodeId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "episode_001".to_string());
        let source_episode_title = scene_obj
            .get("episodeTitle")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("第{}集", next_episodes.len() + 1));
        let duration = scene_duration_seconds(&Value::Object(scene_obj.clone()));

        if current_source_episode != source_episode_id {
            current_source_episode = source_episode_id;
            current_base_title = source_episode_title;
            current_split_index = 1;
            current_episode_duration = 0.0;
        } else if current_episode_duration > 0.0
            && current_episode_duration + duration > limit_seconds
        {
            current_split_index += 1;
            current_episode_duration = 0.0;
            did_split = true;
        }

        let episode_number = next_episodes.len() + 1;
        let episode_id = format!("episode_{:03}", episode_number);
        let episode_title = episode_title_for_split(&current_base_title, current_split_index);
        if next_episodes
            .last()
            .and_then(|item: &Value| item.get("id"))
            .and_then(Value::as_str)
            != Some(episode_id.as_str())
        {
            next_episodes.push(json!({
              "id": episode_id,
              "title": episode_title,
              "index": episode_number
            }));
        }

        scene_obj.insert(
            "id".to_string(),
            json!(format!("scene_{:03}", scene_index + 1)),
        );
        scene_obj.insert(
            "episodeId".to_string(),
            json!(format!("episode_{:03}", episode_number)),
        );
        scene_obj.insert("episodeTitle".to_string(), json!(episode_title));
        scene_obj.insert("episodeIndex".to_string(), json!(episode_number));
        next_scenes.push(Value::Object(scene_obj));
        current_episode_duration += duration;
    }

    let mut updated_episode_count = None;
    if did_split {
        updated_episode_count = Some(next_episodes.len());
        data.insert("episodes".to_string(), Value::Array(next_episodes));
        data.insert("scenes".to_string(), Value::Array(next_scenes));
    }

    if let Some(episode_count) = updated_episode_count {
        if let Some(strategy) = payload
            .get_mut("parseStrategy")
            .and_then(Value::as_object_mut)
        {
            strategy.insert("episodeDurationLimited".to_string(), json!(true));
            strategy.insert(
                "episodeDurationLimitSeconds".to_string(),
                json!(limit_seconds),
            );
            strategy.insert("episodeCount".to_string(), json!(episode_count));
        }
    }

    payload
}

fn apply_script_parse_postprocessing(payload: Value, body: &Value) -> Value {
    let parse_mode = json_string(body.get("scriptParseMode"), "short_drama");
    if parse_mode == "short_drama" {
        enforce_short_drama_episode_duration_limit(payload, 300.0)
    } else {
        payload
    }
}

fn scene_time_of_day_text(value: &str) -> &str {
    match value.trim() {
        "dawn" => "清晨",
        "morning" => "上午",
        "noon" => "正午",
        "afternoon" => "下午",
        "dusk" => "黄昏",
        "night" => "夜晚",
        "midnight" => "深夜",
        "day" => "白天",
        _ => value,
    }
}

fn normalize_scene_era_value(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized == "unknown" || normalized == "unspecified" {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn infer_scene_era_from_text(text: &str) -> Option<String> {
    let normalized = text.trim();
    if normalized.contains("古代")
        || normalized.contains("宫廷")
        || normalized.contains("皇")
        || normalized.contains("王府")
    {
        Some("古代".to_string())
    } else if normalized.contains("民国") || normalized.contains("租界") {
        Some("民国".to_string())
    } else if normalized.contains("未来")
        || normalized.contains("赛博")
        || normalized.contains("星际")
    {
        Some("未来".to_string())
    } else if normalized.contains("现代")
        || normalized.contains("公司")
        || normalized.contains("都市")
    {
        Some("现代".to_string())
    } else {
        None
    }
}

fn asset_type_label(value: &str) -> &str {
    match value.trim() {
        "character" => "角色",
        "environment" => "环境",
        "prop" => "道具",
        "other" => "其他",
        _ => "资产",
    }
}

fn build_scene_setting_text(scene: &Value) -> String {
    let Some(setting) = scene.get("setting") else {
        return "无".to_string();
    };
    let title = scene.get("title").and_then(Value::as_str).unwrap_or("");
    let description = scene
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let location = setting
        .get("location")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let era = setting
        .get("era")
        .and_then(Value::as_str)
        .and_then(normalize_scene_era_value)
        .or_else(|| {
            infer_scene_era_from_text(&format!("{}\n{}\n{}", title, description, location))
        });

    let mut lines = Vec::new();
    if !location.is_empty() {
        lines.push(format!("- 地点：{}", location));
    }
    if let Some(time_of_day) = setting
        .get("timeOfDay")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 时间：{}", scene_time_of_day_text(time_of_day)));
    }
    if let Some(era) = era {
        lines.push(format!("- 时代：{}", era));
    }
    if let Some(mood) = setting
        .get("mood")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 氛围：{}", mood));
    }
    if let Some(weather) = setting
        .get("weather")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 天气：{}", weather));
    }
    if lines.is_empty() {
        "无".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_scene_character_text(scene: &Value) -> String {
    let lines = scene
        .get("characters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|character| {
                    let name = character
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let appearance = character
                        .get("appearance")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let emotion = character
                        .get("emotion")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let mut parts = Vec::new();
                    if !name.is_empty() {
                        parts.push(name.to_string());
                    }
                    if !appearance.is_empty() {
                        parts.push(format!("外观：{}", appearance));
                    }
                    if !emotion.is_empty() {
                        parts.push(format!("情绪：{}", emotion));
                    }
                    if parts.is_empty() {
                        None
                    } else {
                        Some(format!("- {}", parts.join("，")))
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if lines.is_empty() {
        "无".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_scene_refine_history_text(body: &Value) -> String {
    let lines = body
        .get("history")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(12)
                .filter_map(|item| {
                    let role = match item.get("role").and_then(Value::as_str).unwrap_or("user") {
                        "assistant" => "助手",
                        _ => "用户",
                    };
                    let content = item
                        .get("content")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if content.is_empty() {
                        None
                    } else {
                        Some(format!("{}：{}", role, content))
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if lines.is_empty() {
        "无".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_mentioned_assets_text(body: &Value) -> String {
    let lines = body
        .get("mentionedAssets")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(24)
                .filter_map(|asset| {
                    let name = asset
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if name.is_empty() {
                        return None;
                    }
                    let kind = asset.get("type").and_then(Value::as_str).unwrap_or("");
                    let description = asset
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let has_reference = asset
                        .get("hasReferenceImage")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let mut parts = vec![format!("{}：{}", asset_type_label(kind), name)];
                    if !description.is_empty() {
                        parts.push(format!("描述：{}", description));
                    }
                    if has_reference {
                        parts.push("有参考图".to_string());
                    }
                    Some(format!("- {}", parts.join("，")))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if lines.is_empty() {
        "无".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_environment_consistency_text(body: &Value) -> String {
    let Some(context) = body.get("environmentContext").and_then(Value::as_object) else {
        return "无".to_string();
    };

    let mut lines = Vec::new();
    if let Some(root) = context
        .get("environmentRoot")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("主环境锚点：{}", root));
    }

    let anchor_title = context
        .get("anchorSceneTitle")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let anchor_location = context
        .get("anchorLocation")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !anchor_title.is_empty() || !anchor_location.is_empty() {
        let anchor_text = match (anchor_title.is_empty(), anchor_location.is_empty()) {
            (false, false) => format!("母体参考场景：{}（{}）", anchor_title, anchor_location),
            (false, true) => format!("母体参考场景：{}", anchor_title),
            (true, false) => format!("母体参考位置：{}", anchor_location),
            (true, true) => String::new(),
        };
        if !anchor_text.is_empty() {
            lines.push(anchor_text);
        }
    }

    if let Some(anchor_description) = context
        .get("anchorDescription")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("母体参考描述：{}", anchor_description));
    }

    let sibling_locations = context
        .get("siblingLocations")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .take(12)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !sibling_locations.is_empty() {
        lines.push(format!("同组子空间：{}", sibling_locations.join("、")));
    }

    if lines.is_empty() {
        "无".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_scene_description_refinement_prompt(
    conn: &rusqlite::Connection,
    body: &Value,
) -> Result<String, ApiError> {
    let scene = body.get("scene").cloned().unwrap_or_else(|| json!({}));
    let duration_hint = scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.round().max(2.0) as i64)
        .unwrap_or(8);
    let scene_title = json_string(scene.get("title").or_else(|| scene.get("id")), "未命名场景");
    let scene_description = json_string(scene.get("description"), "");
    let style = json_string(body.get("style"), "未指定");
    let user_message = json_string(body.get("userMessage"), "保持原意进行精炼");
    let narration = scene
        .get("narration")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");

    let duration = duration_hint.to_string();
    let setting = build_scene_setting_text(&scene);
    let characters = build_scene_character_text(&scene);
    let history = build_scene_refine_history_text(body);
    let assets = build_mentioned_assets_text(body);
    render_configured_prompt(
        conn,
        PROMPT_TEMPLATE_SCENE_DESCRIPTION_REFINEMENT,
        &[
            ("duration", duration.as_str()),
            ("durationHint", duration.as_str()),
            ("style", style.as_str()),
            ("sceneTitle", scene_title.as_str()),
            ("sceneDescription", scene_description.as_str()),
            ("setting", setting.as_str()),
            ("characters", characters.as_str()),
            ("narration", narration),
            ("history", history.as_str()),
            ("assets", assets.as_str()),
            ("mentionedAssets", assets.as_str()),
            ("userMessage", user_message.as_str()),
        ],
    )
}

fn strip_legacy_audio_constraint(text: &str) -> String {
    let mut normalized = text.trim().to_string();
    for suffix in [
        "不添加字幕，不添加BGM。",
        "不添加字幕，不添加BGM.",
        "不添加字幕，不添加BGM",
    ] {
        if normalized.ends_with(suffix) {
            normalized.truncate(normalized.len().saturating_sub(suffix.len()));
            normalized = normalized.trim().to_string();
            break;
        }
    }
    normalized
}

fn extract_timeline_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| {
            let Some((range, rest)) = line.split_once(['：', ':']) else {
                return false;
            };
            if rest.trim().is_empty() || !range.contains('-') {
                return false;
            }
            let normalized = range.replace('秒', "").replace('s', "").replace('S', "");
            let mut parts = normalized.split('-');
            let start = parts.next().unwrap_or("").trim().parse::<f64>();
            let end = parts.next().unwrap_or("").trim().parse::<f64>();
            start.is_ok() && end.is_ok()
        })
        .map(str::to_string)
        .collect()
}

fn normalize_refined_scene_description(
    refined: &str,
    fallback: &str,
    duration_hint: f64,
) -> String {
    let refined_core = strip_legacy_audio_constraint(refined);
    let fallback_core = strip_legacy_audio_constraint(fallback);
    let refined_timeline_lines = extract_timeline_lines(&refined_core);
    if !refined_timeline_lines.is_empty() {
        return refined_core;
    }

    let fallback_timeline_lines = extract_timeline_lines(&fallback_core);
    if !fallback_timeline_lines.is_empty() {
        if refined_core.is_empty() {
            return fallback_core;
        }
        if refined_core.contains("镜头设计：") || refined_core.contains("镜头设计:") {
            return format!("{}\n{}", refined_core, fallback_timeline_lines.join("\n"))
                .trim()
                .to_string();
        }
        return format!(
            "{}\n\n镜头设计：\n{}",
            refined_core,
            fallback_timeline_lines.join("\n")
        )
        .trim()
        .to_string();
    }

    let safe_duration = if duration_hint.is_finite() {
        duration_hint.round().max(2.0) as i64
    } else {
        8
    };
    let line_body = refined_core
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let line_body = if line_body.is_empty() {
        let fallback_body = fallback_core
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if fallback_body.is_empty() {
            "保持原场景动作与情绪推进。".to_string()
        } else {
            fallback_body
        }
    } else {
        line_body
    };
    let fallback_timeline = format!("0-{}秒：中景，固定镜头。{}", safe_duration, line_body);
    if refined_core.is_empty() {
        fallback_timeline
    } else if refined_core.contains("镜头设计：") || refined_core.contains("镜头设计:") {
        format!("{}\n{}", refined_core, fallback_timeline)
            .trim()
            .to_string()
    } else {
        format!("{}\n\n镜头设计：\n{}", refined_core, fallback_timeline)
            .trim()
            .to_string()
    }
}

fn extract_json_from_text(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("模型返回为空".to_string());
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }

    let without_fence = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let Ok(value) = serde_json::from_str::<Value>(without_fence) {
        return Ok(value);
    }

    let start = without_fence
        .find('{')
        .ok_or_else(|| "模型返回中未找到 JSON 对象".to_string())?;
    let end = without_fence
        .rfind('}')
        .ok_or_else(|| "模型返回中未找到 JSON 对象结尾".to_string())?;
    if end <= start {
        return Err("模型返回 JSON 范围无效".to_string());
    }

    serde_json::from_str::<Value>(&without_fence[start..=end])
        .map_err(|error| format!("解析模型 JSON 失败: {}", error))
}

fn normalize_model_scene_characters(value: Option<Value>) -> Value {
    let Some(Value::Array(items)) = value else {
        return json!([]);
    };

    let normalized = items
        .into_iter()
        .filter_map(|item| match item {
            Value::String(name) => {
                let name = name.trim();
                if name.is_empty() {
                    None
                } else {
                    Some(json!({ "name": name }))
                }
            }
            Value::Object(mut object) => {
                let name = object
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?
                    .to_string();
                object.insert("name".to_string(), json!(name));
                Some(Value::Object(object))
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    Value::Array(normalized)
}

fn is_narration_speaker(value: &str) -> bool {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '_', '.', ':', '：'], "");
    matches!(
        normalized.as_str(),
        "旁白" | "画外音" | "narration" | "voiceover" | "os" | "vo" | "内心独白"
    )
}

fn normalize_model_scene_dialogue_lines(value: Option<Value>) -> (Vec<String>, Vec<String>) {
    let Some(Value::Array(items)) = value else {
        return (Vec::new(), Vec::new());
    };

    let mut dialogue_lines = Vec::new();
    let mut narration_lines = Vec::new();
    for item in items {
        let Value::Object(object) = item else {
            continue;
        };
        let character = object
            .get("character")
            .or_else(|| object.get("speaker"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let text = object
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let (Some(character), Some(text)) = (character, text) else {
            continue;
        };
        if is_narration_speaker(character) {
            narration_lines.push(text.to_string());
        } else {
            dialogue_lines.push(format!("- {}：{}", character, text));
        }
    }

    (dialogue_lines, narration_lines)
}

fn append_dialogue_lines_to_description(description: &str, dialogue_lines: &[String]) -> String {
    let trimmed = description.trim();
    let lines = dialogue_lines
        .iter()
        .filter(|line| !trimmed.contains(line.trim_start_matches("- ")))
        .cloned()
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return trimmed.to_string();
    }

    [vec![trimmed.to_string(), "对白：".to_string()], lines]
        .concat()
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn trimmed_json_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn pick_dramatic_text_from_description(description: &str, label: &str) -> Option<String> {
    for line in description.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix(label) else {
            continue;
        };
        let text = rest
            .trim_start_matches(|character| character == '：' || character == ':')
            .trim()
            .to_string();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn normalize_model_scene_dramatic(
    value: Option<Value>,
    fallback_description: &str,
) -> Option<Value> {
    let object = match value {
        Some(Value::Object(object)) => object,
        _ => serde_json::Map::new(),
    };

    let mut normalized = serde_json::Map::new();
    if let Some(function) = object.get("function").and_then(trimmed_json_string) {
        if matches!(
            function.as_str(),
            "hook"
                | "escalation"
                | "confrontation"
                | "reversal"
                | "payoff"
                | "cliffhanger"
                | "aftermath"
        ) {
            normalized.insert("function".to_string(), json!(function));
        }
    }

    for (key, label) in [
        ("conflict", Some("戏剧冲突")),
        ("emotionalCurve", Some("情绪曲线")),
        ("audienceHook", None),
        ("painPoint", Some("爽点/痛点")),
        ("payoff", Some("反击或反转")),
        ("powerShift", None),
        ("antagonistPressure", None),
        ("protagonistCounter", None),
        ("cliffhanger", Some("结尾钩子")),
    ] {
        let text = object.get(key).and_then(trimmed_json_string).or_else(|| {
            label.and_then(|label| pick_dramatic_text_from_description(fallback_description, label))
        });
        if let Some(text) = text {
            normalized.insert(key.to_string(), json!(text));
        }
    }

    if normalized.is_empty() {
        None
    } else {
        Some(Value::Object(normalized))
    }
}

fn infer_model_scene_shot_type_from_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    let lower = text.to_ascii_lowercase();
    let normalized = match lower.as_str() {
        "extreme_wide" | "extreme wide" | "establishing" => "extreme_wide",
        "wide" | "wide shot" | "full shot" => "wide",
        "medium_wide" | "medium wide" => "medium_wide",
        "medium" | "medium shot" => "medium",
        "medium_close" | "medium close" | "medium close-up" | "medium closeup" => "medium_close",
        "close" | "close-up" | "closeup" | "close shot" => "close",
        "extreme_close" | "extreme close-up" | "extreme closeup" => "extreme_close",
        "detail" | "detail shot" | "insert shot" => "detail",
        _ if text.contains("大远景") || text.contains("超远景") => "extreme_wide",
        _ if text.contains("中全景") => "medium_wide",
        _ if text.contains("中近景") => "medium_close",
        _ if text.contains("中景") => "medium",
        _ if text.contains("全景") || text.contains("远景") => "wide",
        _ if text.contains("近景") => "close",
        _ if text.contains("大特写") || text.contains("特写") => "extreme_close",
        _ if text.contains("细节") || text.contains("插入镜头") => "detail",
        _ => return None,
    };

    Some(normalized.to_string())
}

fn normalize_model_scene_shot_type(value: Option<Value>, fallback_text: &str) -> String {
    if let Some(Value::String(raw)) = value {
        if let Some(normalized) = infer_model_scene_shot_type_from_text(&raw) {
            return normalized;
        }
    }

    infer_model_scene_shot_type_from_text(fallback_text).unwrap_or_else(|| "medium".to_string())
}

fn infer_model_scene_camera_movement_from_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    let lower = text.to_ascii_lowercase();
    let normalized = match lower.as_str() {
        "static" | "fixed" | "locked" | "still" => "static",
        "push" | "push in" | "push-in" => "push",
        "pull" | "pull out" | "pull-out" => "pull",
        "pan_left" | "pan left" => "pan_left",
        "pan_right" | "pan right" => "pan_right",
        "tilt_up" | "tilt up" => "tilt_up",
        "tilt_down" | "tilt down" => "tilt_down",
        "track" | "tracking" | "tracking shot" => "track",
        "dolly" => "dolly",
        "zoom_in" | "zoom in" => "zoom_in",
        "zoom_out" | "zoom out" => "zoom_out",
        "crane" => "crane",
        "handheld" | "handheld shot" => "handheld",
        "arc" | "orbit" | "arc shot" => "arc",
        _ if text.contains("固定") || text.contains("定镜") || text.contains("静止") => {
            "static"
        }
        _ if text.contains("推镜") || text.contains("推进") || text.contains("推近") => {
            "push"
        }
        _ if text.contains("拉镜") || text.contains("拉远") || text.contains("后拉") => {
            "pull"
        }
        _ if text.contains("左摇") => "pan_left",
        _ if text.contains("右摇") => "pan_right",
        _ if text.contains("上摇") => "tilt_up",
        _ if text.contains("下摇") => "tilt_down",
        _ if text.contains("跟拍") || text.contains("跟镜") => "track",
        _ if text.contains("变焦推") || text.contains("放大") => "zoom_in",
        _ if text.contains("变焦拉") || text.contains("缩小") => "zoom_out",
        _ if text.contains("升降") => "crane",
        _ if text.contains("手持") => "handheld",
        _ if text.contains("环绕") => "arc",
        _ => return None,
    };

    Some(normalized.to_string())
}

fn normalize_model_scene_camera_movement(value: Option<Value>, fallback_text: &str) -> String {
    if let Some(Value::String(raw)) = value {
        if let Some(normalized) = infer_model_scene_camera_movement_from_text(&raw) {
            return normalized;
        }
    }

    infer_model_scene_camera_movement_from_text(fallback_text)
        .unwrap_or_else(|| "static".to_string())
}

fn normalize_model_scene_environment_capture_mode_value(value: Option<Value>) -> Option<String> {
    let Some(Value::String(raw)) = value else {
        return None;
    };
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    let lower = text.to_ascii_lowercase();
    let normalized = match lower.as_str() {
        "single" | "single view" | "single image" => "single",
        "four_view" | "four view" | "four views" | "multi view" | "multi-view" => "four_view",
        _ if text.contains("单视角") || text.contains("单张") || text.contains("单图") => {
            "single"
        }
        _ if text.contains("四视图")
            || text.contains("四视角")
            || text.contains("多视角")
            || text.contains("多角度") =>
        {
            "four_view"
        }
        _ => return None,
    };

    Some(normalized.to_string())
}

fn count_model_scene_timeline_segments(text: &str) -> usize {
    text.lines()
        .filter(|line| {
            let line = line.trim();
            (line.contains('-') || line.contains('－'))
                && line.contains('秒')
                && (line.contains('：') || line.contains(':'))
        })
        .count()
}

fn count_model_scene_shot_keyword_kinds(text: &str) -> usize {
    let lower = text.to_ascii_lowercase();
    [
        "全景",
        "远景",
        "中景",
        "近景",
        "特写",
        "俯拍",
        "仰拍",
        "主观镜头",
        "pov",
        "over-the-shoulder",
    ]
    .iter()
    .filter(|keyword| lower.contains(*keyword))
    .count()
}

fn infer_model_scene_environment_capture_mode(description: &str, camera_note: &str) -> String {
    let text = [description.trim(), camera_note.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        return "single".to_string();
    }

    if count_model_scene_timeline_segments(description) >= 2 {
        return "four_view".to_string();
    }

    let lower = text.to_ascii_lowercase();
    if [
        "多视角",
        "多个视角",
        "多机位",
        "多镜头",
        "多景别",
        "镜头切换",
        "切换镜头",
        "视角切换",
        "镜头切到",
        "切到",
        "转到",
        "angle switch",
        "multi-angle",
        "multi angle",
        "multi-shot",
        "multi shot",
    ]
    .iter()
    .any(|keyword| lower.contains(*keyword))
    {
        return "four_view".to_string();
    }

    if count_model_scene_shot_keyword_kinds(description) >= 2 {
        return "four_view".to_string();
    }

    "single".to_string()
}

fn normalize_model_scene_environment_capture_mode(
    value: Option<Value>,
    description: &str,
    camera_note: &str,
) -> String {
    normalize_model_scene_environment_capture_mode_value(value)
        .unwrap_or_else(|| infer_model_scene_environment_capture_mode(description, camera_note))
}

fn normalize_model_scene_narration(value: Option<Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        Value::Array(items) => {
            let lines = items
                .into_iter()
                .filter_map(|item| match item {
                    Value::String(text) => {
                        let text = text.trim().to_string();
                        if text.is_empty() {
                            None
                        } else {
                            Some(text)
                        }
                    }
                    Value::Object(object) => object.get("text").and_then(trimmed_json_string),
                    _ => None,
                })
                .collect::<Vec<_>>();

            if lines.is_empty() {
                None
            } else {
                Some(lines.join("\n"))
            }
        }
        _ => None,
    }
}

fn normalize_model_script_result(model_value: Value, fallback_body: &Value) -> Value {
    let fallback = build_parsed_script_payload(fallback_body);
    let data = if model_value.get("data").is_some() {
        model_value.get("data").cloned().unwrap_or(Value::Null)
    } else {
        model_value.clone()
    };

    let scenes = data
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            fallback
                .get("data")
                .and_then(|value| value.get("scenes"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        });
    let characters = data
        .get("characters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| {
            fallback
                .get("data")
                .and_then(|value| value.get("characters"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        });
    let title = data
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            fallback
                .get("data")
                .and_then(|value| value.get("title"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let normalized_scenes = scenes
        .into_iter()
        .enumerate()
        .map(|(index, scene)| {
            let mut scene_obj = scene.as_object().cloned().unwrap_or_default();
            let title_text = scene_obj
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            let description_text = scene_obj
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            let location_text = scene_obj
                .get("setting")
                .and_then(|value| value.get("location"))
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            let fallback_text = [
                title_text.as_str(),
                description_text.as_str(),
                location_text.as_str(),
            ]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
            let camera_note_text = scene_obj
                .get("cameraNote")
                .or_else(|| scene_obj.get("camera_note"))
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            if scene_obj
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
            {
                scene_obj.insert("id".to_string(), json!(format!("scene_{:03}", index + 1)));
            }
            if !scene_obj.contains_key("duration") {
                scene_obj.insert("duration".to_string(), json!(8));
            }
            let characters = normalize_model_scene_characters(scene_obj.remove("characters"));
            scene_obj.insert("characters".to_string(), characters);
            let (dialogue_lines, legacy_narration_lines) =
                normalize_model_scene_dialogue_lines(scene_obj.remove("dialogues"));
            if !dialogue_lines.is_empty() {
                let description = scene_obj
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let merged_description =
                    append_dialogue_lines_to_description(description, &dialogue_lines);
                scene_obj.insert("description".to_string(), json!(merged_description));
            }
            if let Some(dramatic) =
                normalize_model_scene_dramatic(scene_obj.remove("dramatic"), &description_text)
            {
                scene_obj.insert("dramatic".to_string(), dramatic);
            }
            let shot_type = normalize_model_scene_shot_type(
                scene_obj
                    .remove("shotType")
                    .or_else(|| scene_obj.remove("shot_type")),
                &fallback_text,
            );
            scene_obj.insert("shotType".to_string(), json!(shot_type));
            let camera_movement = normalize_model_scene_camera_movement(
                scene_obj
                    .remove("cameraMovement")
                    .or_else(|| scene_obj.remove("camera_movement")),
                &fallback_text,
            );
            scene_obj.insert("cameraMovement".to_string(), json!(camera_movement));
            let environment_capture_mode = normalize_model_scene_environment_capture_mode(
                scene_obj
                    .remove("environmentCaptureMode")
                    .or_else(|| scene_obj.remove("environment_capture_mode")),
                &description_text,
                &camera_note_text,
            );
            scene_obj.insert(
                "environmentCaptureMode".to_string(),
                json!(environment_capture_mode),
            );
            let mut narration_lines = Vec::new();
            if let Some(narration) = normalize_model_scene_narration(scene_obj.remove("narration"))
            {
                narration_lines.push(narration);
            }
            narration_lines.extend(legacy_narration_lines);
            if !narration_lines.is_empty() {
                scene_obj.insert("narration".to_string(), json!(narration_lines.join("\n")));
            }
            if !scene_obj.contains_key("setting") {
                scene_obj.insert(
                    "setting".to_string(),
                    json!({ "location": "未指定场景", "timeOfDay": "day" }),
                );
            }
            Value::Object(scene_obj)
        })
        .collect::<Vec<_>>();

    let formatted_lines = normalized_scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let title = scene.get("title").and_then(Value::as_str).unwrap_or("场景");
            let desc = scene
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("暂无描述");
            format!("场景 {} - {}: {}", index + 1, title, desc)
        })
        .collect::<Vec<_>>();

    json!({
      "success": true,
      "data": {
        "title": title,
        "scenes": normalized_scenes,
        "characters": characters
      },
      "formattedTimeline": {
        "lines": formatted_lines,
        "text": formatted_lines.join("\n")
      },
      "parseStrategy": fallback.get("parseStrategy").cloned().unwrap_or_else(|| json!({
        "segmented": false,
        "chunkCount": 1,
        "episodeCount": 1
      }))
    })
}

fn configured_prompt_template_content(
    conn: &rusqlite::Connection,
    template_id: &str,
) -> Result<String, ApiError> {
    let templates = get_prompt_templates_config(conn)?;
    let content = templates
        .as_array()
        .and_then(|items| {
            items.iter().find_map(|item| {
                if item.get("id").and_then(Value::as_str) == Some(template_id) {
                    item.get("content")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("未找到提示词模板: {template_id}"),
            )
        })?;
    Ok(content)
}

fn render_configured_prompt(
    conn: &rusqlite::Connection,
    template_id: &str,
    variables: &[(&str, &str)],
) -> Result<String, ApiError> {
    let template = configured_prompt_template_content(conn, template_id)?;
    Ok(render_runtime_prompt(&template, variables))
}

fn prompt_template_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_runtime_script_parse_mode(value: &str) -> &'static str {
    match value.trim() {
        "premium_drama" => "premium_drama",
        _ => "short_drama",
    }
}

fn runtime_script_parse_mode_label(mode: &str) -> &'static str {
    match mode {
        "premium_drama" => "精品剧",
        _ => "短剧",
    }
}

fn runtime_script_parse_mode_rules(mode: &str) -> &'static str {
    match mode {
        "premium_drama" => "根据剧情节奏与情绪起伏安排场景密度，保证每集叙事完整。",
        _ => "硬性约束：当前为短剧分集解析。每一集场景总时长必须小于等于300秒（5分钟）；若超出请主动拆分为更多集，并保持剧情连续。",
    }
}

fn runtime_script_parse_template_id(mode: &str) -> &'static str {
    match mode {
        "short_drama" => PROMPT_TEMPLATE_SCRIPT_PARSING_SHORT_DRAMA,
        _ => PROMPT_TEMPLATE_SCRIPT_PARSING,
    }
}

fn runtime_scene_count_hint(body: &Value) -> String {
    body.get("maxScenes")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 1)
        .map(|value| value.min(240).to_string())
        .unwrap_or_else(|| "由模型根据剧情承载自行决定（不设固定场数）".to_string())
}

fn resolve_runtime_script_era_hint(text: &str, style: &str) -> String {
    let combined = format!("{text}\n{style}");
    if combined.contains("古代")
        || combined.contains("古装")
        || combined.contains("宫廷")
        || combined.contains("王府")
        || combined.contains("皇")
    {
        return "古代".to_string();
    }
    if combined.contains("民国") || combined.contains("租界") || combined.contains("少帅") {
        return "民国".to_string();
    }
    if combined.contains("近未来")
        || combined.contains("未来")
        || combined.contains("末日")
        || combined.contains("废土")
        || combined.contains("赛博")
        || combined.contains("星际")
    {
        return "近未来".to_string();
    }
    if combined.contains("架空") || combined.contains("玄幻") || combined.contains("异世界")
    {
        return "架空".to_string();
    }
    if combined.contains("现代")
        || combined.contains("都市")
        || combined.contains("公司")
        || combined.contains("医院")
        || combined.contains("手机")
    {
        return "现代".to_string();
    }

    let style_lower = style.to_ascii_lowercase();
    if style_lower.contains("ai真人")
        || style_lower.contains("真人剧")
        || style_lower.contains("live-action")
        || style_lower.contains("live action")
    {
        return "现代".to_string();
    }

    String::new()
}

fn normalize_asset_brief_text(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    format!(
        "{}...",
        normalized
            .chars()
            .take(max_chars)
            .collect::<String>()
            .trim()
    )
}

fn build_episode_asset_parsing_brief(episode: &Value) -> String {
    let Some(assets) = episode.get("episodeAssets") else {
        return String::new();
    };

    let character_lines = assets
        .get("characters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = prompt_template_string(item.get("name"))?;
                    let mut details = Vec::new();
                    if let Some(gender) = prompt_template_string(item.get("gender")) {
                        details.push(gender);
                    }
                    if let Some(role) = prompt_template_string(item.get("role")) {
                        details.push(role);
                    }
                    if let Some(description) = prompt_template_string(item.get("description")) {
                        details.push(normalize_asset_brief_text(&description, 90));
                    }
                    if details.is_empty() {
                        Some(format!("- {name}"))
                    } else {
                        Some(format!("- {name}：{}", details.join("，")))
                    }
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let prop_lines = assets
        .get("props")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = prompt_template_string(item.get("name"))?;
                    let description = prompt_template_string(item.get("description"))
                        .map(|value| normalize_asset_brief_text(&value, 80));
                    Some(match description {
                        Some(description) if !description.is_empty() => {
                            format!("- {name}：{description}")
                        }
                        _ => format!("- {name}"),
                    })
                })
                .take(10)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let environment_lines = assets
        .get("environments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let location = prompt_template_string(item.get("location"))?;
                    let mut details = Vec::new();
                    if let Some(time_of_day) = prompt_template_string(item.get("timeOfDay")) {
                        details.push(time_of_day);
                    }
                    if let Some(mood) = prompt_template_string(item.get("mood")) {
                        details.push(normalize_asset_brief_text(&mood, 48));
                    }
                    if details.is_empty() {
                        Some(format!("- {location}"))
                    } else {
                        Some(format!("- {location}：{}", details.join("，")))
                    }
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if character_lines.is_empty() && prop_lines.is_empty() && environment_lines.is_empty() {
        return String::new();
    }

    [
        "资产锚点（来自分集目录，优先沿用，不足再补充）：".to_string(),
        if character_lines.is_empty() {
            String::new()
        } else {
            format!("角色资产：\n{}", character_lines.join("\n"))
        },
        if prop_lines.is_empty() {
            String::new()
        } else {
            format!("关键道具：\n{}", prop_lines.join("\n"))
        },
        if environment_lines.is_empty() {
            String::new()
        } else {
            format!("环境锚点：\n{}", environment_lines.join("\n"))
        },
        "执行要求：保持角色外观基线与性别呈现一致；关键道具名称和核心功能一致；环境地点与时段命名优先沿用上述锚点。"
            .to_string(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn build_episode_drama_brief(episode: &Value) -> String {
    let mut lines = Vec::new();
    for (label, key) in [
        ("开场钩子", "episodeHook"),
        ("压迫/羞辱", "humiliationOrThreat"),
        ("反击/反转", "reversalPoint"),
        ("情绪曲线", "emotionalCurve"),
        ("结尾钩子", "cliffhanger"),
        ("爽点类型", "payoffType"),
    ] {
        if let Some(value) = prompt_template_string(episode.get(key)) {
            lines.push(format!("{label}：{value}"));
        }
    }

    let asset_brief = build_episode_asset_parsing_brief(episode);
    if !asset_brief.is_empty() {
        lines.push(asset_brief);
    }

    lines.join("\n")
}

fn build_episode_context_brief(episode_plan: &Value) -> String {
    let Some(episodes) = episode_plan.as_array() else {
        return String::new();
    };

    let multi_episode = episodes.len() > 1;
    episodes
        .iter()
        .filter_map(|episode| {
            let brief = build_episode_drama_brief(episode);
            if brief.trim().is_empty() {
                return None;
            }
            if multi_episode {
                let title = prompt_template_string(episode.get("title"))
                    .unwrap_or_else(|| "未命名分集".to_string());
                Some(format!("【{title}】\n{brief}"))
            } else {
                Some(brief)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn append_environment_capture_mode_rule(prompt: String) -> String {
    if prompt.contains("environmentCaptureMode") {
        prompt
    } else {
        format!("{prompt}\n\n{ENVIRONMENT_CAPTURE_MODE_PROMPT_RULES}")
    }
}

fn build_script_parse_prompt(
    conn: &rusqlite::Connection,
    body: &Value,
) -> Result<String, ApiError> {
    let text = json_string(body.get("text"), "");
    let style = json_string(body.get("style"), "默认画风");
    let parse_mode = normalize_runtime_script_parse_mode(&json_string(
        body.get("scriptParseMode"),
        "short_drama",
    ));
    let episode_plan = body
        .get("episodePlan")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let template =
        configured_prompt_template_content(conn, runtime_script_parse_template_id(parse_mode))?;
    let text_length = text.chars().count().to_string();
    let recommended_min_scenes = runtime_scene_count_hint(body);
    let era_hint = resolve_runtime_script_era_hint(&text, &style);
    let rendered = render_runtime_prompt(
        &template,
        &[
            ("novelText", text.as_str()),
            ("style", style.as_str()),
            ("textLength", text_length.as_str()),
            ("recommendedMinScenes", recommended_min_scenes.as_str()),
            ("sceneDurationMin", SCRIPT_PARSE_MIN_DURATION),
            ("sceneDurationMax", SCRIPT_PARSE_MAX_DURATION),
            (
                "scriptParseModeLabel",
                runtime_script_parse_mode_label(parse_mode),
            ),
            (
                "scriptParseModeRules",
                runtime_script_parse_mode_rules(parse_mode),
            ),
            ("eraHint", era_hint.as_str()),
        ],
    );

    let episode_context_brief = build_episode_context_brief(&episode_plan);
    let with_episode_context = if episode_context_brief.trim().is_empty() {
        rendered
    } else {
        let context_template = configured_prompt_template_content(
            conn,
            PROMPT_TEMPLATE_SCRIPT_PARSING_EPISODE_DRAMA_CONTEXT,
        )?;
        render_runtime_prompt(
            &context_template,
            &[
                ("basePrompt", rendered.as_str()),
                ("episodeDramaBrief", episode_context_brief.as_str()),
            ],
        )
    };

    Ok(append_environment_capture_mode_rule(with_episode_context))
}

fn build_episode_plan_prompt_text(
    conn: &rusqlite::Connection,
    text: &str,
    script_parse_mode: &str,
    chunk_index: Option<usize>,
    chunk_count: Option<usize>,
) -> Result<String, ApiError> {
    let chunk_count = chunk_count.unwrap_or(1).max(1);
    let chunk_index = chunk_index.unwrap_or(1).max(1);
    let is_segmented = chunk_count > 1;
    let mode_rule = if normalize_runtime_script_parse_mode(script_parse_mode) == "short_drama" {
        "短剧模式额外约束：请由剧情节奏决定分集数量，并确保每集对应的场景合成总时长目标不超过 300 秒（5 分钟）。"
    } else {
        "精品剧模式：由剧情结构自行决定分集数量。"
    };
    let chunk_rule = if is_segmented {
        format!(
            "当前仅提供原文第 {}/{} 段，请严格基于本段文本拆分，不得补写未提供段落。",
            chunk_index, chunk_count
        )
    } else {
        "当前提供的是完整原文。".to_string()
    };
    let first_anchor_rule = if is_segmented {
        "第1集 startAnchor 必须取“本段开头”的连续片段。"
    } else {
        "第1集 startAnchor 必须取原文开头连续片段。"
    };
    let template = configured_prompt_template_content(conn, PROMPT_TEMPLATE_SCRIPT_EPISODE_PLAN)?;
    Ok(render_runtime_prompt(
        &template,
        &[
            ("novelText", text),
            ("modeRule", mode_rule),
            ("chunkRule", chunk_rule.as_str()),
            ("firstAnchorRule", first_anchor_rule),
        ],
    ))
}

fn find_anchor_offset(text: &str, anchor: &str, from_offset: usize) -> Option<usize> {
    let normalized = anchor.trim();
    if normalized.chars().count() < 8 || from_offset >= text.len() {
        return None;
    }
    let search_from = if text.is_char_boundary(from_offset) {
        from_offset
    } else {
        text.char_indices()
            .find_map(|(index, _)| (index > from_offset).then_some(index))
            .unwrap_or(text.len())
    };
    if search_from >= text.len() {
        return None;
    }
    text.get(search_from..)
        .and_then(|slice| slice.find(normalized))
        .map(|offset| search_from + offset)
}

fn byte_offset_to_char_offset(text: &str, byte_offset: usize) -> usize {
    text.char_indices()
        .take_while(|(index, _)| *index < byte_offset)
        .count()
}

fn episode_asset_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn episode_asset_field(item: &Value, keys: &[&str]) -> Option<String> {
    let object = item.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(episode_asset_string))
}

fn insert_episode_asset_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
}

fn normalize_episode_asset_character(item: &Value) -> Option<Value> {
    if let Some(name) = episode_asset_string(item) {
        return Some(json!({ "name": name }));
    }

    let name = episode_asset_field(
        item,
        &[
            "name",
            "角色名",
            "姓名",
            "角色",
            "人物",
            "character",
            "characterName",
        ],
    )?;
    let mut object = serde_json::Map::new();
    object.insert("name".to_string(), json!(name));
    insert_episode_asset_field(
        &mut object,
        "description",
        episode_asset_field(
            item,
            &[
                "description",
                "描述",
                "外观",
                "人物描述",
                "角色描述",
                "appearance",
            ],
        ),
    );
    insert_episode_asset_field(
        &mut object,
        "role",
        episode_asset_field(item, &["role", "定位", "角色定位", "人物定位"]),
    );
    insert_episode_asset_field(
        &mut object,
        "gender",
        episode_asset_field(item, &["gender", "性别"]),
    );
    Some(Value::Object(object))
}

fn normalize_episode_asset_prop(item: &Value) -> Option<Value> {
    if let Some(name) = episode_asset_string(item) {
        return Some(json!({ "name": name }));
    }

    let name = episode_asset_field(
        item,
        &["name", "道具名", "道具", "物品", "prop", "propName", "item"],
    )?;
    let mut object = serde_json::Map::new();
    object.insert("name".to_string(), json!(name));
    insert_episode_asset_field(
        &mut object,
        "description",
        episode_asset_field(item, &["description", "描述", "用途", "道具描述", "外观"]),
    );
    Some(Value::Object(object))
}

fn split_episode_environment_text(raw: &str) -> (String, Option<String>, Option<String>) {
    let parts = raw
        .split(|ch| matches!(ch, '/' | '|' | '｜'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return (raw.trim().to_string(), None, None);
    }
    (
        parts[0].to_string(),
        parts.get(1).map(|value| (*value).to_string()),
        parts.get(2).map(|value| (*value).to_string()),
    )
}

fn normalize_episode_asset_environment(item: &Value) -> Option<Value> {
    if let Some(raw) = episode_asset_string(item) {
        let (location, time_of_day, mood) = split_episode_environment_text(&raw);
        if location.is_empty() {
            return None;
        }
        let mut object = serde_json::Map::new();
        object.insert("location".to_string(), json!(location));
        insert_episode_asset_field(&mut object, "timeOfDay", time_of_day);
        insert_episode_asset_field(&mut object, "mood", mood);
        return Some(Value::Object(object));
    }

    let location = episode_asset_field(
        item,
        &[
            "location",
            "地点",
            "场景地点",
            "场景",
            "环境",
            "环境地点",
            "environment",
            "place",
            "name",
        ],
    )?;
    let mut object = serde_json::Map::new();
    object.insert("location".to_string(), json!(location));
    insert_episode_asset_field(
        &mut object,
        "timeOfDay",
        episode_asset_field(
            item,
            &["timeOfDay", "时间", "时段", "时间段", "daytime", "time"],
        ),
    );
    insert_episode_asset_field(
        &mut object,
        "mood",
        episode_asset_field(
            item,
            &["mood", "氛围", "气氛", "环境氛围", "description", "描述"],
        ),
    );
    Some(Value::Object(object))
}

fn episode_asset_collection<'a>(source: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = source.as_object()?;
    keys.iter().find_map(|key| object.get(*key))
}

fn normalize_episode_asset_items(
    source: &Value,
    source_keys: &[&str],
    identity_key: &str,
    normalize: fn(&Value) -> Option<Value>,
) -> Vec<Value> {
    let Some(raw_items) = episode_asset_collection(source, source_keys) else {
        return Vec::new();
    };
    let candidates = match raw_items {
        Value::Array(items) => items.iter().collect::<Vec<_>>(),
        Value::Object(_) | Value::String(_) => vec![raw_items],
        _ => Vec::new(),
    };

    let mut output = Vec::new();
    let mut seen = Vec::new();
    for candidate in candidates {
        let Some(item) = normalize(candidate) else {
            continue;
        };
        let Some(identity) = item
            .get(identity_key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let identity_key = identity.to_lowercase();
        if seen.iter().any(|value: &String| value == &identity_key) {
            continue;
        }
        seen.push(identity_key);
        output.push(item);
    }
    output
}

fn normalize_episode_assets_for_episode(episode: &Value) -> Value {
    let source = episode
        .get("episodeAssets")
        .or_else(|| episode.get("assets"))
        .unwrap_or(episode);
    json!({
      "characters": normalize_episode_asset_items(
        source,
        &["characters", "characterAssets", "角色", "人物", "角色资产", "人物资产"],
        "name",
        normalize_episode_asset_character,
      ),
      "props": normalize_episode_asset_items(
        source,
        &["props", "propAssets", "道具", "关键道具", "道具资产"],
        "name",
        normalize_episode_asset_prop,
      ),
      "environments": normalize_episode_asset_items(
        source,
        &["environments", "environmentAssets", "locations", "场景", "环境", "地点", "环境资产"],
        "location",
        normalize_episode_asset_environment,
      )
    })
}

fn build_episode_plan_from_model_output(text: &str, value: Value) -> Vec<Value> {
    let episodes = value
        .get("episodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if episodes.is_empty() {
        return vec![];
    }

    let mut starts: Vec<(usize, Value)> = vec![(0, episodes[0].clone())];
    let mut last_start = 0usize;
    for episode in episodes.iter().skip(1) {
        let anchor = episode
            .get("startAnchor")
            .and_then(Value::as_str)
            .unwrap_or("");
        if let Some(start) = find_anchor_offset(text, anchor, last_start.saturating_add(1)) {
            if start > last_start {
                starts.push((start, episode.clone()));
                last_start = start;
            }
        }
    }
    starts.sort_by_key(|(start, _)| *start);

    starts
        .iter()
        .enumerate()
        .filter_map(|(index, (start, episode))| {
            let end = starts.get(index + 1).map(|(next, _)| *next).unwrap_or(text.len());
            if end <= *start {
                return None;
            }
            let start_offset = byte_offset_to_char_offset(text, *start);
            let end_offset = byte_offset_to_char_offset(text, end);
            let char_count = end_offset.saturating_sub(start_offset);
            Some(json!({
              "id": format!("episode_{:03}", index + 1),
              "title": episode.get("title").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).unwrap_or("第1集"),
              "index": index + 1,
              "startOffset": start_offset,
              "endOffset": end_offset,
              "charCount": char_count,
              "episodeHook": episode.get("episodeHook").cloned().unwrap_or(Value::Null),
              "humiliationOrThreat": episode.get("humiliationOrThreat").cloned().unwrap_or(Value::Null),
              "reversalPoint": episode.get("reversalPoint").cloned().unwrap_or(Value::Null),
              "emotionalCurve": episode.get("emotionalCurve").cloned().unwrap_or(Value::Null),
              "cliffhanger": episode.get("cliffhanger").cloned().unwrap_or(Value::Null),
              "payoffType": episode.get("payoffType").cloned().unwrap_or(Value::Null),
              "episodeAssets": normalize_episode_assets_for_episode(episode)
            }))
        })
        .collect()
}

fn episode_start_offset(episode: &Value) -> usize {
    episode
        .get("startOffset")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize
}

fn merge_chunked_episode_plans(
    text: &str,
    chunk_results: Vec<(EpisodePlanChunk, Vec<Value>)>,
) -> Vec<Value> {
    let text_char_count = text.chars().count();
    let mut starts: Vec<(usize, Value)> = Vec::new();

    for (chunk, episodes) in chunk_results {
        if episodes.is_empty() {
            starts.push((
                chunk.start_offset,
                json!({ "title": format!("第{}集", starts.len() + 1) }),
            ));
            continue;
        }
        for episode in episodes {
            let local_start = episode_start_offset(&episode)
                .min(chunk.end_offset.saturating_sub(chunk.start_offset));
            let global_start = (chunk.start_offset + local_start).min(text_char_count);
            starts.push((global_start, episode));
        }
    }

    starts.sort_by_key(|(start, _)| *start);
    starts.dedup_by(|left, right| left.0 == right.0);
    if starts.first().map(|(start, _)| *start != 0).unwrap_or(true) {
        starts.insert(0, (0, json!({ "title": "第1集" })));
    }

    let mut episodes = Vec::new();
    for (index, (start, episode)) in starts.iter().enumerate() {
        let end = starts
            .get(index + 1)
            .map(|(next, _)| *next)
            .unwrap_or(text_char_count)
            .min(text_char_count);
        if end <= *start {
            continue;
        }
        episodes.push(json!({
          "id": format!("episode_{:03}", episodes.len() + 1),
          "title": episode.get("title").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).unwrap_or("第1集"),
          "index": episodes.len() + 1,
          "startOffset": start,
          "endOffset": end,
          "charCount": end.saturating_sub(*start),
          "episodeHook": episode.get("episodeHook").cloned().unwrap_or(Value::Null),
          "humiliationOrThreat": episode.get("humiliationOrThreat").cloned().unwrap_or(Value::Null),
          "reversalPoint": episode.get("reversalPoint").cloned().unwrap_or(Value::Null),
          "emotionalCurve": episode.get("emotionalCurve").cloned().unwrap_or(Value::Null),
          "cliffhanger": episode.get("cliffhanger").cloned().unwrap_or(Value::Null),
          "payoffType": episode.get("payoffType").cloned().unwrap_or(Value::Null),
          "episodeAssets": normalize_episode_assets_for_episode(episode)
        }));
    }
    episodes
}

async fn build_model_episode_plan(
    state: &BackendState,
    text: &str,
    script_parse_mode: &str,
) -> Result<(Vec<Value>, String, String, bool), String> {
    let normalized_text = normalize_script_input_text(text);
    if normalized_text.chars().count() <= EPISODE_PLAN_SINGLE_PASS_MAX_CHARS {
        let prompt = {
            let conn = db_connection(state).map_err(|error| error.message)?;
            build_episode_plan_prompt_text(&conn, &normalized_text, script_parse_mode, None, None)
                .map_err(|error| error.message)?
        };
        let (model_text, provider, model_id) =
            run_workflow_text_model(state, "script_parsing", &prompt).await?;
        let value = extract_json_from_text(&model_text)?;
        let episodes = build_episode_plan_from_model_output(&normalized_text, value);
        return Ok((episodes, provider, model_id, false));
    }

    let chunks = split_text_into_episode_plan_chunks(&normalized_text);
    let chunk_count = chunks.len();
    let mut chunk_results = Vec::new();
    let mut provider_name = String::new();
    let mut model_name = String::new();
    for chunk in chunks {
        let prompt = {
            let conn = db_connection(state).map_err(|error| error.message)?;
            build_episode_plan_prompt_text(
                &conn,
                &chunk.text,
                script_parse_mode,
                Some(chunk.index),
                Some(chunk_count),
            )
            .map_err(|error| error.message)?
        };
        let (model_text, provider, model_id) =
            run_workflow_text_model(state, "script_parsing", &prompt).await?;
        if provider_name.is_empty() {
            provider_name = provider;
            model_name = model_id;
        }
        let value = extract_json_from_text(&model_text)?;
        let episodes = build_episode_plan_from_model_output(&chunk.text, value);
        chunk_results.push((chunk, episodes));
    }
    Ok((
        merge_chunked_episode_plans(&normalized_text, chunk_results),
        provider_name,
        model_name,
        true,
    ))
}

async fn run_workflow_text_model(
    state: &BackendState,
    workflow_step: &str,
    prompt: &str,
) -> Result<(String, String, String), String> {
    let conn = db_connection(state).map_err(|error| error.message)?;
    let creds = load_provider_creds(&conn);
    let model_id = resolve_runtime_workflow_model_id(&conn, workflow_step)?;
    let provider = resolve_model_provider_required_string(&model_id, &creds)?;
    let text = run_text_model_test_remote(&provider, &model_id, prompt, &creds).await?;
    Ok((text, provider, model_id))
}

fn resolve_runtime_workflow_model_id(
    conn: &rusqlite::Connection,
    workflow_step: &str,
) -> Result<String, String> {
    let available = build_available_models(conn).map_err(|error| error.message)?;
    let selections =
        workflow_current_selections(conn, &available).map_err(|error| error.message)?;
    selections
        .get(workflow_step)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "未配置{}模型，请先在设置中选择模型",
                workflow_step_label(workflow_step)
            )
        })
}

fn workflow_step_label(workflow_step: &str) -> &'static str {
    match workflow_step {
        "script_parsing" => "分集目录规划与剧本解析",
        "scene_description_refinement" => "场景描述二次改写",
        "character_portrait" => "角色资产生成",
        "frame_generation" => "环境参考图生成",
        "video_generation" => "分镜视频生成",
        _ => "工作流",
    }
}

fn provider_images_generations_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized
        .to_ascii_lowercase()
        .ends_with("/images/generations")
    {
        normalized.to_string()
    } else {
        format!("{}/images/generations", normalized)
    }
}

fn provider_images_edits_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    for suffix in [
        "/images/generations",
        "/chat/completions",
        "/responses",
        "/models",
    ] {
        if normalized.to_ascii_lowercase().ends_with(suffix) {
            return format!(
                "{}/images/edits",
                &normalized[..normalized.len() - suffix.len()]
            );
        }
    }
    if normalized.to_ascii_lowercase().ends_with("/images/edits") {
        normalized.to_string()
    } else {
        format!("{}/images/edits", normalized)
    }
}

fn provider_image_task_endpoint(base_url: &str, task_id: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    let task_id = tos_percent_encode(task_id.trim());
    for suffix in [
        "/images/generations",
        "/images/edits",
        "/chat/completions",
        "/responses",
        "/models",
    ] {
        if normalized.to_ascii_lowercase().ends_with(suffix) {
            return format!(
                "{}/tasks/{}",
                &normalized[..normalized.len() - suffix.len()],
                task_id
            );
        }
    }
    if normalized.to_ascii_lowercase().ends_with("/tasks") {
        format!("{}/{}", normalized, task_id)
    } else {
        format!("{}/tasks/{}", normalized, task_id)
    }
}

fn is_apimart_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    if normalized.contains("apimart") {
        return true;
    }
    reqwest::Url::parse(base_url)
        .ok()
        .map(|url| {
            url.host_str()
                .unwrap_or("")
                .to_ascii_lowercase()
                .contains("apimart")
        })
        .unwrap_or(false)
}

fn normalize_openai_quality(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_ascii_lowercase();
    matches!(normalized.as_str(), "auto" | "low" | "medium" | "high").then_some(normalized)
}

fn normalize_apimart_resolution(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "1k" | "2k" | "4k" => Some(normalized),
        "medium" => Some("2k".to_string()),
        "high" => Some("4k".to_string()),
        "auto" | "low" => Some("1k".to_string()),
        _ => None,
    }
}

fn normalize_apimart_aspect_ratio(value: Option<&str>) -> Option<String> {
    let normalized = value?.replace(char::is_whitespace, "").to_ascii_lowercase();
    if normalized == "auto" {
        return Some("auto".to_string());
    }
    let (width_raw, height_raw) = normalized.split_once(':')?;
    let width = width_raw.parse::<u32>().ok()?;
    let height = height_raw.parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let divisor = gcd_u32(width, height).max(1);
    let reduced = format!("{}:{}", width / divisor, height / divisor);
    match reduced.as_str() {
        "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "2:1" | "1:2"
        | "21:9" | "9:21" => Some(reduced),
        "7:3" => Some("21:9".to_string()),
        "3:7" => Some("9:21".to_string()),
        _ => None,
    }
}

fn gcd_u32(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let next = a % b;
        a = b;
        b = next;
    }
    a
}

fn parse_image_dimensions(size: &str) -> Option<(u32, u32)> {
    let normalized = size
        .replace(char::is_whitespace, "")
        .replace('*', "x")
        .to_ascii_lowercase();
    let (width_raw, height_raw) = normalized.split_once('x')?;
    let width = width_raw.parse::<u32>().ok()?;
    let height = height_raw.parse::<u32>().ok()?;
    (width > 0 && height > 0).then_some((width, height))
}

fn nearest_apimart_aspect_ratio(width: u32, height: u32) -> String {
    const RATIOS: &[(&str, f64)] = &[
        ("1:1", 1.0),
        ("3:2", 1.5),
        ("2:3", 2.0 / 3.0),
        ("4:3", 4.0 / 3.0),
        ("3:4", 3.0 / 4.0),
        ("5:4", 1.25),
        ("4:5", 4.0 / 5.0),
        ("16:9", 16.0 / 9.0),
        ("9:16", 9.0 / 16.0),
        ("2:1", 2.0),
        ("1:2", 0.5),
        ("21:9", 21.0 / 9.0),
        ("9:21", 9.0 / 21.0),
    ];
    let target = width as f64 / height as f64;
    RATIOS
        .iter()
        .min_by(|(_, left), (_, right)| {
            (target / *left)
                .ln()
                .abs()
                .partial_cmp(&(target / *right).ln().abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(ratio, _)| (*ratio).to_string())
        .unwrap_or_else(|| "1:1".to_string())
}

fn resolve_apimart_image_size(size: &str) -> String {
    let size_ratio = size.replace('*', "x");
    if let Some(ratio) = normalize_apimart_aspect_ratio(Some(&size_ratio)) {
        return ratio;
    }
    if let Some((width, height)) = parse_image_dimensions(size) {
        normalize_apimart_aspect_ratio(Some(&format!("{}:{}", width, height)))
            .unwrap_or_else(|| nearest_apimart_aspect_ratio(width, height))
    } else {
        "1:1".to_string()
    }
}

fn parse_openai_compatible_image_result(payload: &Value) -> Option<(String, Option<String>)> {
    fn pick_first_string(value: Option<&Value>) -> Option<String> {
        match value? {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            Value::Array(items) => items.iter().find_map(|item| pick_first_string(Some(item))),
            _ => None,
        }
    }

    fn parse_item(item: &Value) -> Option<(String, Option<String>)> {
        if let Some(url) = pick_first_string(item.get("url")) {
            return Some((url, None));
        }
        if let Some(base64_data) = pick_first_string(item.get("b64_json")) {
            return Some((base64_data, Some("image/png".to_string())));
        }
        None
    }

    if let Some(data) = payload.get("data") {
        if let Some(items) = data.as_array() {
            for item in items {
                if let Some(result) = parse_item(item) {
                    return Some(result);
                }
            }
        } else if data.is_object() {
            if let Some(images) = data
                .get("result")
                .and_then(|result| result.get("images"))
                .and_then(Value::as_array)
            {
                for image in images {
                    if let Some(result) = parse_item(image) {
                        return Some(result);
                    }
                }
            }
            if let Some(result) = parse_item(data) {
                return Some(result);
            }
        }
    }

    parse_item(payload)
}

fn parse_openai_compatible_image_task_id(payload: &Value) -> Option<String> {
    let pick = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
    };
    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        for item in items {
            if let Some(task_id) = pick(item.get("task_id"))
                .or_else(|| pick(item.get("taskId")))
                .or_else(|| pick(item.get("id")))
            {
                return Some(task_id);
            }
        }
    }
    if let Some(data) = payload.get("data").filter(|value| value.is_object()) {
        if let Some(task_id) = pick(data.get("id"))
            .or_else(|| pick(data.get("task_id")))
            .or_else(|| pick(data.get("taskId")))
        {
            return Some(task_id);
        }
    }
    pick(payload.get("task_id"))
}

fn openai_compatible_task_status(payload: &Value) -> String {
    payload
        .get("status")
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("data")
                .and_then(|data| data.get("status"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            payload
                .get("data")
                .and_then(|data| data.get("task_status"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn openai_compatible_task_failed(status: &str) -> bool {
    matches!(
        status,
        "failed" | "cancelled" | "canceled" | "error" | "rejected" | "expired"
    )
}

fn openai_compatible_task_success(status: &str) -> bool {
    matches!(
        status,
        "completed" | "succeeded" | "succeed" | "success" | "done" | "finished"
    )
}

fn openai_compatible_task_error_message(payload: &Value) -> String {
    payload
        .get("data")
        .and_then(|data| data.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("data")
                .and_then(|data| data.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .unwrap_or("图片生成任务失败")
        .to_string()
}

fn openai_auth_header(api_key: &str) -> String {
    let trimmed = api_key.trim();
    if trimmed
        .split_once(char::is_whitespace)
        .map(|(scheme, rest)| {
            !scheme.is_empty()
                && !rest.trim().is_empty()
                && scheme
                    .chars()
                    .next()
                    .is_some_and(|ch| ch.is_ascii_alphabetic())
        })
        .unwrap_or(false)
    {
        trimmed.to_string()
    } else {
        format!("Bearer {}", trimmed)
    }
}

fn reference_image_part(reference: &str, index: usize) -> Result<reqwest::multipart::Part, String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return Err("参考图不能为空".to_string());
    }
    let (mime, bytes) = if let Some((mime, bytes)) = parse_data_url(trimmed) {
        (mime, bytes)
    } else {
        let compact = trimmed.replace(|ch: char| ch.is_whitespace(), "");
        let bytes = BASE64_STANDARD
            .decode(compact)
            .map_err(|error| format!("参考图格式无效: {}", error))?;
        ("image/png".to_string(), bytes)
    };
    if bytes.is_empty() {
        return Err("参考图数据为空".to_string());
    }
    let ext = infer_extension_from_mime(&mime, "png");
    reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("reference-{}.{}", index, ext))
        .mime_str(&mime)
        .map_err(|error| error.to_string())
}

async fn poll_openai_compatible_image_task(
    base_url: &str,
    api_key: &str,
    model_id: &str,
    task_id: &str,
) -> Result<(String, Option<String>), String> {
    tokio::time::sleep(Duration::from_secs(10)).await;
    let endpoint = provider_image_task_endpoint(base_url, task_id);
    let started_at = Utc::now().timestamp_millis();
    let request_body = json!({ "taskId": task_id });
    loop {
        let response = llm_http_client()
            .get(&endpoint)
            .header(reqwest::header::AUTHORIZATION, openai_auth_header(api_key))
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = build_llm_transport_error_message(&error);
                llm_dev_write_db_log(
                    "custom_openai",
                    model_id,
                    "generateImage",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| {
            let message = build_llm_transport_error_message(&error);
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析图片任务状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(result) = parse_openai_compatible_image_result(&payload) {
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "success",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&json!({
                  "taskId": task_id,
                  "source": result.0.as_str(),
                  "mimeType": result.1.as_deref()
                })),
                Some(body_text.as_str()),
                None,
            );
            return Ok(result);
        }
        let task_status = openai_compatible_task_status(&payload);
        if openai_compatible_task_success(&task_status) {
            let message = "图片任务已完成但未返回图片 URL 或 base64".to_string();
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        if openai_compatible_task_failed(&task_status) {
            let message = openai_compatible_task_error_message(&payload);
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        tokio::time::sleep(Duration::from_secs(4)).await;
    }
}

async fn request_custom_openai_image_generation(
    model_id: &str,
    prompt: &str,
    size: &str,
    reference_images: &[String],
    creds: &Value,
) -> Result<(String, Option<String>), String> {
    let custom_openai = creds
        .get("custom_openai")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let api_keys = provider_sync_api_keys("custom_openai", creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            "custom_openai",
            model_id,
            "generateImage",
            None::<i64>,
            "error" => "未配置 API Key"
        );
        return Err("未配置 API Key".to_string());
    }
    let base_url = provider_sync_base_url("custom_openai", creds)
        .ok_or_else(|| "未配置 Base URL".to_string())?;
    let model = normalize_model_id_for_remote(model_id);
    let normalized_model = model.to_ascii_lowercase();
    let is_apimart = is_apimart_base_url(&base_url);
    let is_apimart_gpt_image_2 = is_apimart && normalized_model == "gpt-image-2";
    let is_apimart_gpt_image_2_official = is_apimart && normalized_model == "gpt-image-2-official";
    let is_apimart_gpt_image_2_series = is_apimart_gpt_image_2 || is_apimart_gpt_image_2_official;
    let supports_edit = normalized_model.starts_with("gpt-image");
    let use_image_urls_in_generations = is_apimart_gpt_image_2_series;
    if !reference_images.is_empty() && !supports_edit {
        return Err(format!("模型 {} 不支持参考图编辑", model));
    }

    let raw_quality = custom_openai
        .get("imageQuality")
        .and_then(Value::as_str)
        .or_else(|| custom_openai.get("quality").and_then(Value::as_str));
    let quality = normalize_openai_quality(raw_quality);
    let resolution = if is_apimart_gpt_image_2 {
        normalize_apimart_resolution(raw_quality)
    } else {
        normalize_apimart_resolution(
            custom_openai
                .get("imageResolution")
                .and_then(Value::as_str)
                .or(raw_quality),
        )
    };
    let resolved_size = if is_apimart_gpt_image_2_series {
        resolve_apimart_image_size(size)
    } else {
        size.replace('*', "x")
    };

    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        "custom_openai",
        model_id,
        "generateImage",
        None::<i64>,
        "endpoint" => if !reference_images.is_empty() && !use_image_urls_in_generations {
            provider_images_edits_endpoint(&base_url)
        } else {
            provider_images_generations_endpoint(&base_url)
        },
        "prompt" => llm_dev_log_preview(prompt, 220),
        "size" => resolved_size.as_str(),
        "referenceImages" => reference_images.len(),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let use_multipart_edit = !reference_images.is_empty() && !use_image_urls_in_generations;
        let endpoint_for_log = if use_multipart_edit {
            provider_images_edits_endpoint(&base_url)
        } else {
            provider_images_generations_endpoint(&base_url)
        };
        let mut request_log_payload = if use_multipart_edit {
            json!({
              "model": model.as_str(),
              "prompt": prompt,
              "size": resolved_size.as_str(),
              "n": 1,
              "transport": "multipart",
              "referenceImages": reference_images
            })
        } else {
            Value::Null
        };

        let response = if use_multipart_edit {
            let mut form = reqwest::multipart::Form::new()
                .text("model", model.clone())
                .text("prompt", prompt.to_string())
                .text("size", resolved_size.clone())
                .text("n", "1".to_string());
            if normalized_model.starts_with("gpt-image") && !is_apimart_gpt_image_2 {
                if let Some(quality) = &quality {
                    form = form.text("quality", quality.clone());
                }
            }
            for (index, reference) in reference_images.iter().enumerate() {
                form = form.part(
                    "image[]",
                    reference_image_part(reference, index).map_err(|error| {
                        llm_dev_write_db_log(
                            "custom_openai",
                            model_id,
                            "generateImage",
                            "error",
                            _log_started_at,
                            Some(endpoint_for_log.as_str()),
                            Some(&request_log_payload),
                            None,
                            None,
                            Some(error.as_str()),
                        );
                        llm_dev_log!(
                            "error",
                            "custom_openai",
                            model_id,
                            "generateImage",
                            Some(Utc::now().timestamp_millis() - _log_started_at),
                            "error" => error.as_str()
                        );
                        error
                    })?,
                );
            }
            llm_http_client()
                .post(&endpoint_for_log)
                .header(reqwest::header::AUTHORIZATION, openai_auth_header(&api_key))
                .header(reqwest::header::ACCEPT, "application/json")
                .multipart(form)
                .send()
                .await
                .map_err(|error| {
                    let message = build_llm_transport_error_message(&error);
                    llm_dev_write_db_log(
                        "custom_openai",
                        model_id,
                        "generateImage",
                        "error",
                        _log_started_at,
                        Some(endpoint_for_log.as_str()),
                        Some(&request_log_payload),
                        None,
                        None,
                        Some(message.as_str()),
                    );
                    llm_dev_log!(
                        "error",
                        "custom_openai",
                        model_id,
                        "generateImage",
                        Some(Utc::now().timestamp_millis() - _log_started_at),
                        "error" => message.as_str()
                    );
                    message
                })?
        } else {
            let mut request_body = json!({
              "model": model.as_str(),
              "prompt": prompt,
              "size": resolved_size.as_str(),
              "n": 1
            });
            if normalized_model.starts_with("gpt-image") && !is_apimart_gpt_image_2 {
                if let Some(quality) = &quality {
                    request_body["quality"] = json!(quality);
                }
            }
            if let Some(resolution) = &resolution {
                request_body["resolution"] = json!(resolution);
            }
            if !reference_images.is_empty() && use_image_urls_in_generations {
                request_body["image_urls"] = json!(reference_images);
            }
            request_log_payload = request_body.clone();
            llm_http_client()
                .post(&endpoint_for_log)
                .header(reqwest::header::AUTHORIZATION, openai_auth_header(&api_key))
                .header(reqwest::header::ACCEPT, "application/json")
                .json(&request_body)
                .send()
                .await
                .map_err(|error| {
                    let message = build_llm_transport_error_message(&error);
                    llm_dev_write_db_log(
                        "custom_openai",
                        model_id,
                        "generateImage",
                        "error",
                        _log_started_at,
                        Some(endpoint_for_log.as_str()),
                        Some(&request_log_payload),
                        None,
                        None,
                        Some(message.as_str()),
                    );
                    llm_dev_log!(
                        "error",
                        "custom_openai",
                        model_id,
                        "generateImage",
                        Some(Utc::now().timestamp_millis() - _log_started_at),
                        "error" => message.as_str()
                    );
                    message
                })?
        };

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint_for_log.as_str()),
                Some(&request_log_payload),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 OpenAI 兼容图片响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint_for_log.as_str()),
                Some(&request_log_payload),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(result) = parse_openai_compatible_image_result(&payload) {
            let parsed_response = json!({
              "source": result.0.as_str(),
              "mimeType": result.1.as_deref()
            });
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "success",
                _log_started_at,
                Some(endpoint_for_log.as_str()),
                Some(&request_log_payload),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                "custom_openai",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "result" => llm_dev_log_source_summary(&result.0)
            );
            return Ok(result);
        }
        if let Some(task_id) = parse_openai_compatible_image_task_id(&payload) {
            let parsed_response = json!({ "taskId": task_id.as_str() });
            llm_dev_write_db_log(
                "custom_openai",
                model_id,
                "generateImage",
                "task",
                _log_started_at,
                Some(endpoint_for_log.as_str()),
                Some(&request_log_payload),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "task",
                "custom_openai",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "taskId" => task_id.as_str()
            );
            return match poll_openai_compatible_image_task(&base_url, &api_key, model_id, &task_id)
                .await
            {
                Ok(result) => {
                    let parsed_response = json!({
                      "taskId": task_id.as_str(),
                      "source": result.0.as_str(),
                      "mimeType": result.1.as_deref()
                    });
                    llm_dev_write_db_log(
                        "custom_openai",
                        model_id,
                        "generateImage",
                        "success",
                        _log_started_at,
                        Some(endpoint_for_log.as_str()),
                        Some(&request_log_payload),
                        Some(&parsed_response),
                        None,
                        None,
                    );
                    llm_dev_log!(
                        "success",
                        "custom_openai",
                        model_id,
                        "generateImage",
                        Some(Utc::now().timestamp_millis() - _log_started_at),
                        "taskId" => task_id.as_str(),
                        "result" => llm_dev_log_source_summary(&result.0)
                    );
                    Ok(result)
                }
                Err(error) => {
                    llm_dev_write_db_log(
                        "custom_openai",
                        model_id,
                        "generateImage",
                        "error",
                        _log_started_at,
                        Some(endpoint_for_log.as_str()),
                        Some(&request_log_payload),
                        Some(&json!({ "taskId": task_id })),
                        None,
                        Some(error.as_str()),
                    );
                    llm_dev_log!(
                        "error",
                        "custom_openai",
                        model_id,
                        "generateImage",
                        Some(Utc::now().timestamp_millis() - _log_started_at),
                        "taskId" => task_id.as_str(),
                        "error" => error.as_str()
                    );
                    Err(error)
                }
            };
        }
        let message = "OpenAI 兼容图片生成未返回图片 URL 或 base64".to_string();
        llm_dev_write_db_log(
            "custom_openai",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint_for_log.as_str()),
            Some(&request_log_payload),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "OpenAI 兼容图片生成失败".to_string());
    llm_dev_log!(
        "error",
        "custom_openai",
        model_id,
        "generateImage",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

fn parse_qwen_multimodal_image_result(payload: &Value) -> Option<(String, Option<String>)> {
    let content = payload
        .get("output")
        .and_then(|output| output.get("choices"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)?;
    for item in content {
        if let Some(image) = item
            .get("image")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((image.to_string(), None));
        }
    }
    None
}

fn parse_gemini_image_result(payload: &Value) -> Option<(String, Option<String>)> {
    let candidates = payload.get("candidates").and_then(Value::as_array)?;
    for candidate in candidates {
        let Some(parts) = candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for part in parts {
            if let Some(inline_data) = part.get("inlineData").or_else(|| part.get("inline_data")) {
                let data = inline_data
                    .get("data")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?;
                let mime_type = inline_data
                    .get("mimeType")
                    .or_else(|| inline_data.get("mime_type"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| Some("image/png".to_string()));
                return Some((data.to_string(), mime_type));
            }
        }
    }
    None
}

async fn request_openai_compatible_image_generation(
    provider: &str,
    model_id: &str,
    prompt: &str,
    size: &str,
    reference_images: &[String],
    creds: &Value,
) -> Result<(String, Option<String>), String> {
    if provider == "custom_openai" {
        return request_custom_openai_image_generation(
            model_id,
            prompt,
            size,
            reference_images,
            creds,
        )
        .await;
    }
    let api_keys = provider_sync_api_keys(provider, creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            provider,
            model_id,
            "generateImage",
            None::<i64>,
            "error" => "未配置 API Key"
        );
        return Err("未配置 API Key".to_string());
    }
    let base_url =
        provider_sync_base_url(provider, creds).ok_or_else(|| "未配置 Base URL".to_string())?;
    let endpoint = provider_images_generations_endpoint(&base_url);
    let model = normalize_model_id_for_remote(model_id);
    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        provider,
        model_id,
        "generateImage",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "size" => size,
        "referenceImages" => reference_images.len(),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let mut request_body = json!({
          "model": model.as_str(),
          "prompt": prompt,
          "size": size,
          "n": 1
        });
        if !reference_images.is_empty() {
            if provider == "volcengine" {
                request_body["image"] = json!(reference_images[0]);
            } else {
                request_body["reference_images"] = json!(reference_images);
            }
        }

        let response = llm_http_client()
            .post(&endpoint)
            .bearer_auth(api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    provider,
                    model_id,
                    "generateImage",
                    "error",
                    _log_started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    provider,
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "error" => message.as_str()
                );
                message
            })?;

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }

        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 images/generations 响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(result) = parse_openai_compatible_image_result(&payload) {
            let parsed_response = json!({
              "source": result.0.as_str(),
              "mimeType": result.1.as_deref()
            });
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateImage",
                "success",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                provider,
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "result" => llm_dev_log_source_summary(&result.0)
            );
            return Ok(result);
        }
        let message = "图片模型未返回可用图片".to_string();
        llm_dev_write_db_log(
            provider,
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "图片生成失败".to_string());
    llm_dev_log!(
        "error",
        provider,
        model_id,
        "generateImage",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

fn qwen_multimodal_generation_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.contains("/compatible-mode") {
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
            .to_string()
    } else if normalized.ends_with("/services/aigc/multimodal-generation/generation") {
        normalized.to_string()
    } else {
        format!(
            "{}/services/aigc/multimodal-generation/generation",
            normalized
        )
    }
}

fn qwen_image_size(model: &str, requested_size: &str) -> String {
    if !requested_size.trim().is_empty() {
        return requested_size.to_string();
    }
    if model == "wan2.7-image-pro" {
        return "2K".to_string();
    }
    if model == "wan2.7-image" {
        return "1K".to_string();
    }
    if model == "qwen-image-2.0-pro" || model == "qwen-image-2.0" {
        return "2048*2048".to_string();
    }
    "1664*928".to_string()
}

async fn request_qwen_image_generation(
    model_id: &str,
    prompt: &str,
    size: &str,
    reference_images: &[String],
    creds: &Value,
) -> Result<(String, Option<String>), String> {
    let api_keys = provider_sync_api_keys("qwen", creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "generateImage",
            None::<i64>,
            "error" => "未配置千问 API Key，请在设置中配置"
        );
        return Err("未配置千问 API Key，请在设置中配置".to_string());
    }
    let base_url = qwen_api_base_url();
    let endpoint = qwen_multimodal_generation_endpoint(&base_url);
    let model = normalize_model_id_for_remote(model_id);
    let mut content = vec![json!({ "text": prompt })];
    for image in reference_images.iter().take(4) {
        content.push(json!({ "image": image }));
    }
    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        "qwen",
        model_id,
        "generateImage",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "size" => qwen_image_size(&model, size),
        "referenceImages" => reference_images.len(),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let request_body = json!({
          "model": model.as_str(),
          "input": {
            "messages": [{
              "role": "user",
              "content": content
            }]
          },
          "parameters": {
            "prompt_extend": true,
            "size": qwen_image_size(&model, size),
            "n": 1,
            "watermark": false
          }
        });
        let response = llm_http_client()
            .post(&endpoint)
            .bearer_auth(api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "qwen",
                    model_id,
                    "generateImage",
                    "error",
                    _log_started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    "qwen",
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "error" => message.as_str()
                );
                message
            })?;

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }

        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Qwen 图片响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(result) = parse_qwen_multimodal_image_result(&payload) {
            let parsed_response = json!({
              "source": result.0.as_str(),
              "mimeType": result.1.as_deref()
            });
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateImage",
                "success",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                "qwen",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "result" => llm_dev_log_source_summary(&result.0)
            );
            return Ok(result);
        }
        let message = "Qwen 图片模型未返回可用图片".to_string();
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "Qwen 图片生成失败".to_string());
    llm_dev_log!(
        "error",
        "qwen",
        model_id,
        "generateImage",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

async fn request_gemini_image_generation(
    model_id: &str,
    prompt: &str,
    reference_images: &[String],
    creds: &Value,
) -> Result<(String, Option<String>), String> {
    let api_keys = provider_sync_api_keys("gemini", creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            "gemini",
            model_id,
            "generateImage",
            None::<i64>,
            "error" => "未配置 API Key"
        );
        return Err("未配置 API Key".to_string());
    }
    let base_url =
        provider_sync_base_url("gemini", creds).ok_or_else(|| "未配置 Base URL".to_string())?;
    let endpoint = provider_gemini_generate_endpoint(&base_url, model_id);
    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        "gemini",
        model_id,
        "generateImage",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "referenceImages" => reference_images.len(),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let mut parts = vec![json!({ "text": prompt })];
        for image in reference_images.iter().take(4) {
            if let Some((mime, payload)) = image
                .strip_prefix("data:")
                .and_then(|rest| rest.split_once(";base64,"))
            {
                parts.push(json!({
                  "inlineData": {
                    "data": payload,
                    "mimeType": mime
                  }
                }));
            } else {
                parts.push(json!({
                  "inlineData": {
                    "data": image,
                    "mimeType": "image/png"
                  }
                }));
            }
        }

        let request_body = json!({
          "contents": [
            {
              "role": "user",
              "parts": parts
            }
          ],
          "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
          }
        });
        let response = llm_http_client()
            .post(&endpoint)
            .query(&[("key", api_key.as_str())])
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "gemini",
                    model_id,
                    "generateImage",
                    "error",
                    _log_started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    "gemini",
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "error" => message.as_str()
                );
                message
            })?;

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }

        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Gemini 图片响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(result) = parse_gemini_image_result(&payload) {
            let parsed_response = json!({
              "source": result.0.as_str(),
              "mimeType": result.1.as_deref()
            });
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateImage",
                "success",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                "gemini",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "result" => llm_dev_log_source_summary(&result.0)
            );
            return Ok(result);
        }
        let message = "Gemini 未返回可用图片".to_string();
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "Gemini 图片生成失败".to_string());
    llm_dev_log!(
        "error",
        "gemini",
        model_id,
        "generateImage",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

async fn run_workflow_image_model(
    state: &BackendState,
    workflow_step: &str,
    prompt: &str,
    size: &str,
    prefix: &str,
    reference_images: &[String],
) -> Result<(String, String, String), String> {
    let conn = db_connection(state).map_err(|error| error.message)?;
    let creds = load_provider_creds(&conn);
    let model_id = resolve_runtime_workflow_model_id(&conn, workflow_step)?;
    let provider = infer_model_provider_required_string(&model_id)?;
    let (source, mime_type) = match provider.as_str() {
        "qwen" => {
            request_qwen_image_generation(&model_id, prompt, size, reference_images, &creds).await?
        }
        "volcengine" | "custom_openai" => {
            request_openai_compatible_image_generation(
                &provider,
                &model_id,
                prompt,
                size,
                reference_images,
                &creds,
            )
            .await?
        }
        "gemini" => {
            request_gemini_image_generation(&model_id, prompt, reference_images, &creds).await?
        }
        "kling" => {
            request_kling_image_generation(&model_id, prompt, size, reference_images).await?
        }
        _ => return Err(format!("供应商 {} 暂不支持图片生成", provider)),
    };

    let image_url = if is_http_url(&source) || source.starts_with("data:") {
        persist_image_source(state, &source, prefix)
            .await
            .map_err(|error| error.message)?
    } else {
        let bytes = BASE64_STANDARD
            .decode(source.replace(|c: char| c.is_whitespace(), ""))
            .map_err(|error| format!("解码图片 base64 失败: {}", error))?;
        persist_image_bytes_async(state, prefix, mime_type.as_deref(), "png", bytes)
            .await
            .map_err(|error| error.message)?
    };

    Ok((image_url, provider, model_id))
}

fn resolve_workflow_model_id(
    state: &BackendState,
    workflow_step: &str,
) -> Result<String, ApiError> {
    let conn = db_connection(state)?;
    resolve_runtime_workflow_model_id(&conn, workflow_step)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))
}

fn compact_prompt_text(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    format!(
        "{}...",
        normalized
            .chars()
            .take(max_chars)
            .collect::<String>()
            .trim()
    )
}

fn normalize_timeline_line_punctuation(value: &str) -> String {
    value
        .replace("秒：，", "秒：")
        .replace("秒：,", "秒：")
        .replace("秒:，", "秒:")
        .replace("秒:,", "秒:")
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SceneVideoReferenceLabel {
    url: String,
    label: String,
}

fn optional_trimmed_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(trimmed_json_string)
}

fn named_scene_video_reference_label(
    kind: &str,
    name: Option<&Value>,
    fallback_name: Option<&str>,
) -> String {
    let display_name = name
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(fallback_name);
    match display_name {
        Some(display_name) => format!("{kind}（{display_name}）"),
        None => kind.to_string(),
    }
}

fn character_asset_reference_kind(item: &Value) -> &'static str {
    match item.get("type").and_then(Value::as_str) {
        Some("prop") => "道具参考",
        Some("other") => "资产参考",
        _ => "角色参考",
    }
}

fn push_scene_video_reference_label(
    labels: &mut Vec<SceneVideoReferenceLabel>,
    url: Option<String>,
    label: String,
) {
    let Some(url) = url else {
        return;
    };
    if labels.iter().any(|item| item.url == url) {
        return;
    }
    labels.push(SceneVideoReferenceLabel { url, label });
}

fn push_unique_scene_video_url(
    urls: &mut Vec<String>,
    seen: &mut HashSet<String>,
    url: Option<String>,
) {
    if let Some(url) = url {
        if seen.insert(url.clone()) {
            urls.push(url);
        }
    }
}

fn scene_video_reference_label_candidates(config: &Value) -> Vec<SceneVideoReferenceLabel> {
    let references = config.get("references").unwrap_or(&Value::Null);
    let mut labels = Vec::new();

    let environment_image = optional_trimmed_json_string(references.get("environmentImage"))
        .or_else(|| {
            optional_trimmed_json_string(
                references
                    .get("environmentAsset")
                    .and_then(|asset| asset.get("image")),
            )
        });
    let environment_label = named_scene_video_reference_label(
        "环境参考",
        references
            .get("environmentAsset")
            .and_then(|asset| asset.get("name")),
        Some("环境参考图"),
    );
    push_scene_video_reference_label(&mut labels, environment_image, environment_label);

    push_scene_video_reference_label(
        &mut labels,
        optional_trimmed_json_string(references.get("continuityFirstFrame")),
        "连续性首帧（上一镜头末帧）".to_string(),
    );

    // Prefer named asset labels over generic character image labels when the
    // same URL appears in both arrays.
    if let Some(items) = references.get("characterAssets").and_then(Value::as_array) {
        for item in items {
            let kind = character_asset_reference_kind(item);
            let label = named_scene_video_reference_label(kind, item.get("name"), None);
            push_scene_video_reference_label(
                &mut labels,
                optional_trimmed_json_string(item.get("image")),
                label,
            );
        }
    }

    push_scene_video_reference_label(
        &mut labels,
        optional_trimmed_json_string(references.get("characterImage")),
        "角色参考".to_string(),
    );
    if let Some(items) = references.get("characterImages").and_then(Value::as_array) {
        for item in items {
            push_scene_video_reference_label(
                &mut labels,
                optional_trimmed_json_string(Some(item)),
                "角色参考".to_string(),
            );
        }
    }

    labels
}

fn scene_video_nested_reference_urls(config: &Value) -> Vec<String> {
    let references = config.get("references").unwrap_or(&Value::Null);
    let mut urls = Vec::new();
    let mut seen = HashSet::<String>::new();

    push_unique_scene_video_url(
        &mut urls,
        &mut seen,
        optional_trimmed_json_string(references.get("environmentImage")).or_else(|| {
            optional_trimmed_json_string(
                references
                    .get("environmentAsset")
                    .and_then(|asset| asset.get("image")),
            )
        }),
    );

    if let Some(items) = references.get("characterImages").and_then(Value::as_array) {
        for item in items {
            push_unique_scene_video_url(
                &mut urls,
                &mut seen,
                optional_trimmed_json_string(Some(item)),
            );
        }
    }
    push_unique_scene_video_url(
        &mut urls,
        &mut seen,
        optional_trimmed_json_string(references.get("characterImage")),
    );
    if let Some(items) = references.get("characterAssets").and_then(Value::as_array) {
        for item in items {
            push_unique_scene_video_url(
                &mut urls,
                &mut seen,
                optional_trimmed_json_string(item.get("image")),
            );
        }
    }
    if urls.is_empty() {
        push_unique_scene_video_url(
            &mut urls,
            &mut seen,
            optional_trimmed_json_string(references.get("continuityFirstFrame")),
        );
    }

    urls
}

fn scene_video_visual_reference_urls(config: &Value) -> Vec<String> {
    let reference_images = config
        .get("referenceImages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| trimmed_json_string(&item))
        .take(9)
        .collect::<Vec<_>>();
    if !reference_images.is_empty() {
        return reference_images;
    }

    let image_url = optional_trimmed_json_string(config.get("imageUrl"));
    let first_frame = optional_trimmed_json_string(config.get("firstFrame"));
    let last_frame = optional_trimmed_json_string(config.get("lastFrame"));
    if let (Some(first_frame), Some(last_frame)) = (first_frame.clone(), last_frame) {
        return vec![first_frame, last_frame];
    }
    if let Some(single_image) = image_url.or(first_frame) {
        return vec![single_image];
    }

    scene_video_nested_reference_urls(config)
}

fn scene_video_visual_reference_labels(config: &Value) -> Vec<String> {
    let candidates = scene_video_reference_label_candidates(config);
    scene_video_visual_reference_urls(config)
        .into_iter()
        .map(|url| {
            candidates
                .iter()
                .find(|item| item.url == url)
                .map(|item| item.label.clone())
                .unwrap_or_else(|| "参考图".to_string())
        })
        .collect()
}

fn scene_video_audio_reference_label(config: &Value) -> Option<String> {
    let audio_url = optional_trimmed_json_string(config.get("audioUrl"))?;
    let references = config.get("references").unwrap_or(&Value::Null);
    if let Some(voice_asset) = references.get("narrationVoiceAsset") {
        let voice_url = optional_trimmed_json_string(voice_asset.get("audioUrl"));
        if voice_url.as_deref() == Some(audio_url.as_str()) {
            return Some(named_scene_video_reference_label(
                "旁白音色参考",
                voice_asset.get("name"),
                Some("旁白音色"),
            ));
        }
    }
    Some("音色参考".to_string())
}

fn build_scene_video_reference_materials(config: &Value) -> String {
    let mut lines = Vec::new();

    for (index, label) in scene_video_visual_reference_labels(config)
        .into_iter()
        .enumerate()
    {
        lines.push(format!("- 图片{}：{}", index + 1, label));
    }

    if let Some(label) = scene_video_audio_reference_label(config) {
        lines.push(format!("- 音频1：{label}"));
    }

    if lines.is_empty() {
        "无额外参考素材".to_string()
    } else {
        lines.join("\n")
    }
}

fn scene_video_reference_label_name(label: &str) -> Option<String> {
    let start = label.find('（')? + '（'.len_utf8();
    let end = label[start..].find('）')? + start;
    let name = label[start..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn push_scene_video_reference_alias(aliases: &mut Vec<String>, value: &str) {
    let alias = value.trim();
    if alias.chars().count() < 2 {
        return;
    }
    if matches!(alias, "参考图" | "环境参考图" | "上一镜头末帧") {
        return;
    }
    if aliases.iter().any(|item| item == alias) {
        return;
    }
    aliases.push(alias.to_string());
}

fn scene_video_reference_binding_aliases(label: &str) -> Vec<String> {
    let Some(name) = scene_video_reference_label_name(label) else {
        return Vec::new();
    };

    let mut aliases = Vec::new();
    if label.starts_with("环境参考") {
        let location = name
            .split('/')
            .next()
            .unwrap_or(name.as_str())
            .split("||")
            .next()
            .unwrap_or(name.as_str());
        push_scene_video_reference_alias(&mut aliases, location);
    } else {
        push_scene_video_reference_alias(&mut aliases, &name);
    }
    aliases
}

fn scene_video_visual_reference_bindings(config: &Value) -> Vec<(usize, Vec<String>)> {
    scene_video_visual_reference_labels(config)
        .into_iter()
        .enumerate()
        .filter_map(|(index, label)| {
            let aliases = scene_video_reference_binding_aliases(&label);
            if aliases.is_empty() {
                None
            } else {
                Some((index + 1, aliases))
            }
        })
        .collect()
}

fn bind_scene_video_reference_name(value: &str, name: &str, image_number: usize) -> String {
    if name.is_empty() || !value.contains(name) {
        return value.to_string();
    }

    let tag = format!("（图片{}）", image_number);
    let mut result = String::with_capacity(value.len() + tag.len() * 4);
    let mut rest = value;

    while let Some(index) = rest.find(name) {
        result.push_str(&rest[..index]);
        result.push_str(name);

        let after = &rest[index + name.len()..];
        if !after.starts_with(&tag) && !after.starts_with("（图片") && !after.starts_with("@图片")
        {
            result.push_str(&tag);
        }
        rest = after;
    }

    result.push_str(rest);
    result
}

fn bind_scene_video_reference_numbers_to_text(value: &str, config: &Value) -> String {
    let mut output = value.to_string();
    for (image_number, aliases) in scene_video_visual_reference_bindings(config) {
        for alias in aliases {
            output = bind_scene_video_reference_name(&output, &alias, image_number);
        }
    }
    output
}

fn build_scene_video_reference_guide(scene: &Value, config: &Value) -> String {
    let references = config.get("references").unwrap_or(&Value::Null);
    let mut lines = Vec::new();
    if !scene_video_visual_reference_urls(config).is_empty() {
        lines.push("引用参考素材时必须使用图片1、图片2等编号，禁止使用资产 ID、文件名或 URL。");
    }
    if has_non_empty_string(references.get("environmentImage")) {
        lines.push("优先锁定环境参考图中的空间结构、材质、光线方向和主要陈设。");
    }
    if has_non_empty_string(references.get("characterImage"))
        || references
            .get("characterAssets")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
    {
        lines.push("优先保持角色参考图中的脸型、发型、服装、体态和关键配饰。");
    }
    if has_non_empty_string(references.get("continuityFirstFrame")) {
        lines.push("从连续性首帧自然承接，不要重置人物位置、镜头角度或物体状态。");
    }
    if let Some(camera_note) = scene
        .get("cameraNote")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(camera_note);
    }

    if lines.is_empty() {
        "按场景详细说明执行；若存在参考图，保持主体身份与空间关系一致。".to_string()
    } else {
        lines.join("\n")
    }
}

fn build_scene_video_execution_constraints(scene: &Value, config: &Value) -> String {
    let mut lines = vec![
        "画面稳定，镜头运动平滑，不生成字幕、水印、Logo 或 UI。".to_string(),
        "不得生成背景音乐；对白和旁白只体现为口型、表演节奏和画面情绪。".to_string(),
    ];
    if let Some(camera_note) = scene
        .get("cameraNote")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("镜头备注：{camera_note}"));
    }
    if let Some(negative_prompt) = config
        .get("negativePrompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("负向约束：{negative_prompt}"));
    }
    lines.join("\n")
}

fn build_video_prompt_from_scene(
    conn: &rusqlite::Connection,
    scene: &Value,
    config: &Value,
) -> Result<String, ApiError> {
    let prompt = json_string(config.get("prompt"), "");
    if !prompt.is_empty() {
        return Ok(prompt);
    }
    let title = json_string(scene.get("title"), "未命名场景");
    let raw_description = normalize_timeline_line_punctuation(&json_string(
        scene.get("description"),
        "未提供分镜描述",
    ));
    let description = bind_scene_video_reference_numbers_to_text(&raw_description, config);
    let scene_summary = compact_prompt_text(&description, 220);
    let style = json_string(config.get("style"), "保持项目默认画风");
    let aspect_ratio = json_string(config.get("aspectRatio"), "16:9");
    let duration = scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| {
            if value.fract() == 0.0 {
                format!("{}", value as i64)
            } else {
                format!("{:.1}", value)
            }
        })
        .unwrap_or_else(|| "8".to_string());
    let shot_number = scene
        .get("sceneIndex")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| json_string(scene.get("id"), "1"));
    let setting = build_scene_setting_text(scene);
    let reference_guide = build_scene_video_reference_guide(scene, config);
    let reference_materials = build_scene_video_reference_materials(config);
    let execution_constraints = build_scene_video_execution_constraints(scene, config);
    let narration = scene
        .get("narration")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");

    render_configured_prompt(
        conn,
        PROMPT_TEMPLATE_SCENE_VIDEO_GENERATION,
        &[
            ("shotNumber", shot_number.as_str()),
            ("sceneTitle", title.as_str()),
            ("sceneSummary", scene_summary.as_str()),
            ("style", style.as_str()),
            ("duration", duration.as_str()),
            ("aspectRatio", aspect_ratio.as_str()),
            ("setting", setting.as_str()),
            ("sceneDescription", description.as_str()),
            ("referenceGuide", reference_guide.as_str()),
            ("referenceMaterials", reference_materials.as_str()),
            ("executionConstraints", execution_constraints.as_str()),
            ("narration", narration),
        ],
    )
}

#[derive(Clone, Debug)]
struct VoiceReferenceCandidate {
    character_id: String,
    character_name: String,
    audio_url: String,
    locked: bool,
}

fn normalize_speaker_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| {
            !ch.is_whitespace()
                && !matches!(
                    *ch,
                    '"' | '\'' | '“' | '”' | '‘' | '’' | '-' | '_' | '.' | ':' | '：'
                )
        })
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_scene_dialogue_label(value: &str) -> bool {
    matches!(
        value,
        "场景功能"
            | "情绪定位"
            | "镜头设计"
            | "声音设计"
            | "台词节奏"
            | "表演关键点"
            | "对白"
            | "对话"
            | "台词"
            | "旁白"
            | "画外音"
    )
}

fn normalize_description_dialogue_speaker(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(['-', '*', '•', ' '])
        .trim_matches(['"', '\'', '“', '”', '‘', '’', '「', '」', '『', '』'])
        .trim()
        .to_string()
}

fn normalize_description_dialogue_text(value: &str) -> String {
    value
        .trim()
        .trim_matches(['"', '\'', '“', '”', '‘', '’', '「', '」', '『', '』'])
        .trim()
        .to_string()
}

fn last_dialogue_speaker_token(value: &str) -> String {
    let candidate = value
        .rsplit(['。', '，', '；', ',', '.', '!', '?', '！', '？', ' ', '\t'])
        .next()
        .unwrap_or(value);
    normalize_description_dialogue_speaker(candidate)
}

fn extract_description_dialogue_from_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    for marker in [
        "说：",
        "说:",
        "问：",
        "问:",
        "喊：",
        "喊:",
        "答：",
        "答:",
        "道：",
        "道:",
        "回应：",
        "回应:",
        "低语：",
        "低语:",
        "喃喃：",
        "喃喃:",
    ] {
        if let Some(index) = line.find(marker) {
            let speaker = last_dialogue_speaker_token(&line[..index]);
            let text = normalize_description_dialogue_text(&line[index + marker.len()..]);
            if !speaker.is_empty() && !text.is_empty() {
                return Some((speaker, text));
            }
        }
    }

    let (left, right) = line.split_once('：').or_else(|| line.split_once(':'))?;
    if left.contains('秒') {
        return None;
    }
    let speaker = normalize_description_dialogue_speaker(left);
    let text = normalize_description_dialogue_text(right);
    if speaker.is_empty() || text.is_empty() {
        None
    } else {
        Some((speaker, text))
    }
}

fn extract_description_dialogues(description: &str) -> Vec<(String, String)> {
    let mut seen = HashSet::<String>::new();
    let mut dialogues = Vec::new();
    for line in description.lines() {
        let Some((speaker, text)) = extract_description_dialogue_from_line(line) else {
            continue;
        };
        if speaker.chars().count() > 16
            || speaker.contains('秒')
            || is_scene_dialogue_label(&speaker)
            || is_narration_speaker(&speaker)
        {
            continue;
        }
        let key = format!("{}::{}", normalize_speaker_name(&speaker), text);
        if seen.insert(key) {
            dialogues.push((speaker, text));
        }
    }
    dialogues
}

fn scene_dialogue_speakers(scene: &Value) -> Vec<String> {
    let Some(description) = scene.get("description").and_then(Value::as_str) else {
        return Vec::new();
    };

    let mut speakers = Vec::new();
    let mut seen = HashSet::<String>::new();
    for (speaker, _) in extract_description_dialogues(description) {
        let key = normalize_speaker_name(&speaker);
        if !key.is_empty() && seen.insert(key) {
            speakers.push(speaker);
        }
    }
    speakers
}

fn voice_asset_audio_url(value: &Value) -> Option<String> {
    value
        .get("audioUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

fn model_supports_audio_reference(provider: &str, model_id: &str) -> bool {
    if provider == "qwen" {
        return true;
    }
    let (kind, config) = build_available_model_entry(provider, model_id);
    kind == AvailableModelKind::Video
        && config
            .get("supportAudioReference")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn select_voice_reference_candidate(
    speakers: &[String],
    candidates: &[VoiceReferenceCandidate],
    allow_multi_candidate_fallback: bool,
) -> Option<VoiceReferenceCandidate> {
    if candidates.len() == 1 {
        return candidates.first().cloned();
    }
    if allow_multi_candidate_fallback && candidates.len() > 1 {
        return candidates
            .iter()
            .find(|candidate| candidate.locked)
            .or_else(|| candidates.first())
            .cloned();
    }
    let unique_speakers = speakers
        .iter()
        .map(|speaker| normalize_speaker_name(speaker))
        .filter(|speaker| !speaker.is_empty())
        .collect::<HashSet<_>>();
    if unique_speakers.len() != 1 {
        return None;
    }
    candidates.first().cloned()
}

/// Flatten the workbench `references` object into the flat config keys that the
/// provider request builders actually read (`imageUrl` / `firstFrame` /
/// `referenceImages` / `audioUrl`). The asset workbench sends environment,
/// character, continuity and narration-voice references nested under
/// `config.references`, but `build_{qwen,volcengine,kling,gemini}_video_request`
/// only look at the flat keys — without this step a scene video is generated
/// with no image or audio references at all.
fn apply_scene_video_reference_inputs(
    config: &mut Value,
    scene: &Value,
    provider: &str,
    model_id: &str,
) {
    let references = config.get("references").cloned().unwrap_or(Value::Null);

    let read_str = |value: Option<&Value>| -> Option<String> {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
    };

    let environment_image = read_str(references.get("environmentImage")).or_else(|| {
        read_str(
            references
                .get("environmentAsset")
                .and_then(|asset| asset.get("image")),
        )
    });
    let continuity_first_frame = read_str(references.get("continuityFirstFrame"));

    let mut character_candidates: Vec<String> = Vec::new();
    if let Some(items) = references.get("characterImages").and_then(Value::as_array) {
        for item in items {
            if let Some(image) = read_str(Some(item)) {
                character_candidates.push(image);
            }
        }
    }
    if let Some(image) = read_str(references.get("characterImage")) {
        character_candidates.push(image);
    }
    if let Some(items) = references.get("characterAssets").and_then(Value::as_array) {
        for item in items {
            if let Some(image) = read_str(item.get("image")) {
                character_candidates.push(image);
            }
        }
    }
    let mut seen_character = HashSet::<String>::new();
    let character_images: Vec<String> = character_candidates
        .into_iter()
        .filter(|image| seen_character.insert(image.clone()))
        .collect();
    let has_character_ref = !character_images.is_empty();
    let primary_character_image = character_images.first().cloned();

    let (_, model_caps) = build_available_model_entry(provider, model_id);
    let support_image_to_video = model_caps
        .get("supportImageToVideo")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let support_reference_images = model_caps
        .get("supportReferenceImages")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let reference_limit = model_caps
        .get("maxReferenceImages")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(if support_reference_images { 3 } else { 1 })
        .clamp(1, 9);

    let mut seen_reference = HashSet::<String>::new();
    let mut ordered_references: Vec<String> = Vec::new();
    for image in environment_image.iter().chain(character_images.iter()) {
        if seen_reference.insert(image.clone()) {
            ordered_references.push(image.clone());
        }
    }

    let supports_multi_reference = support_reference_images && reference_limit > 1;
    let wants_multi_reference = has_character_ref && ordered_references.len() > 1;
    let multi_reference_images: Vec<String> = if supports_multi_reference && wants_multi_reference {
        ordered_references
            .iter()
            .take(reference_limit)
            .cloned()
            .collect()
    } else {
        Vec::new()
    };

    // Kling single-image mode treats `imageUrl` as a first frame, so prefer the
    // environment image as the anchor to avoid forcing a character into frame 1.
    let prefer_environment_as_primary = provider == "kling" && !supports_multi_reference;
    let primary_reference = continuity_first_frame.clone().or_else(|| {
        if has_character_ref {
            if supports_multi_reference || prefer_environment_as_primary {
                environment_image
                    .clone()
                    .or_else(|| primary_character_image.clone())
            } else {
                primary_character_image
                    .clone()
                    .or_else(|| environment_image.clone())
            }
        } else {
            environment_image
                .clone()
                .or_else(|| primary_character_image.clone())
        }
    });

    if let Some(object) = config.as_object_mut() {
        if support_image_to_video {
            if let Some(primary) = primary_reference.as_deref() {
                object.insert("imageUrl".to_string(), json!(primary));
            }
        }
        if let Some(first_frame) = continuity_first_frame.as_deref() {
            object.insert("firstFrame".to_string(), json!(first_frame));
        }
        if !multi_reference_images.is_empty() {
            object.insert("referenceImages".to_string(), json!(multi_reference_images));
        }
    }

    // Narration voice only applies when the scene narrates without spoken
    // dialogue; character dialogue voices are injected separately downstream.
    let has_narration = scene
        .get("narration")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if has_narration && scene_dialogue_speakers(scene).is_empty() {
        if let Some(audio_url) = read_str(
            references
                .get("narrationVoiceAsset")
                .and_then(|asset| asset.get("audioUrl")),
        ) {
            if let Some(object) = config.as_object_mut() {
                object.insert("audioUrl".to_string(), json!(audio_url));
            }
        }
    }
}

fn inject_scene_voice_reference(
    state: &BackendState,
    scene_id: &str,
    scene: &Value,
    config: &mut Value,
    provider: &str,
    model_id: &str,
) -> Result<(), ApiError> {
    if config
        .get("audioUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return Ok(());
    }
    if !model_supports_audio_reference(provider, model_id) {
        return Ok(());
    }

    let speakers = scene_dialogue_speakers(scene);
    if speakers.is_empty() {
        return Ok(());
    }
    let normalized_speakers = speakers
        .iter()
        .map(|speaker| normalize_speaker_name(speaker))
        .filter(|speaker| !speaker.is_empty())
        .collect::<HashSet<_>>();
    if normalized_speakers.is_empty() {
        return Ok(());
    }

    let conn = db_connection(state)?;
    let project_id = conn
        .query_row(
            "SELECT scripts.project_id FROM scenes JOIN scripts ON scenes.script_id = scripts.id WHERE scenes.id = ?1 LIMIT 1",
            params![scene_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let Some(project_id) = project_id else {
        return Ok(());
    };

    let mut stmt = conn
        .prepare("SELECT id, name, voice_asset FROM characters WHERE project_id = ?1")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut candidates = Vec::new();
    for row in rows {
        let (character_id, character_name, raw_voice_asset) = row
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let normalized_name = normalize_speaker_name(&character_name);
        if normalized_name.is_empty()
            || !normalized_speakers.iter().any(|speaker| {
                normalized_name.contains(speaker) || speaker.contains(&normalized_name)
            })
        {
            continue;
        }
        let Some(voice_asset) =
            raw_voice_asset.and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        else {
            continue;
        };
        let Some(audio_url) = voice_asset_audio_url(&voice_asset) else {
            continue;
        };
        candidates.push(VoiceReferenceCandidate {
            character_id,
            character_name,
            audio_url,
            locked: voice_asset
                .get("locked")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }

    let allow_multi_candidate_fallback =
        provider == "kling" && model_supports_audio_reference(provider, model_id);
    if let Some(candidate) =
        select_voice_reference_candidate(&speakers, &candidates, allow_multi_candidate_fallback)
    {
        if let Some(object) = config.as_object_mut() {
            object.insert("audioUrl".to_string(), json!(candidate.audio_url));
            object.insert(
                "audioReferenceSource".to_string(),
                json!({
                  "type": "character_voice_asset",
                  "characterId": candidate.character_id,
                  "characterName": candidate.character_name
                }),
            );
        }
    }
    Ok(())
}

fn resolve_project_id_for_scene(
    state: &BackendState,
    scene_id: &str,
) -> Result<Option<String>, ApiError> {
    let scene_id = scene_id.trim();
    if scene_id.is_empty() {
        return Ok(None);
    }

    let conn = db_connection(state)?;
    let project_id = conn
        .query_row(
            "SELECT scripts.project_id
             FROM scenes
             JOIN scripts ON scripts.id = scenes.script_id
             WHERE scenes.id = ?1
             LIMIT 1",
            params![scene_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .flatten();
    Ok(sanitize_model_log_context_value(project_id))
}

fn model_log_context_for_video_task(
    state: &BackendState,
    project_id: Option<String>,
    scene_id: &str,
    task_id: &str,
) -> Result<ModelLogContext, ApiError> {
    let project_id = match sanitize_model_log_context_value(project_id) {
        Some(value) => Some(value),
        None => resolve_project_id_for_scene(state, scene_id)?,
    };
    Ok(build_model_log_context(
        project_id,
        Some(scene_id.to_string()),
        Some(task_id.to_string()),
    ))
}

fn model_log_context_from_video_metadata(
    state: &BackendState,
    metadata: &Value,
    scene_id: &str,
    task_id: &str,
) -> ModelLogContext {
    let project_id = metadata
        .get("projectId")
        .and_then(trimmed_json_string)
        .or_else(|| resolve_project_id_for_scene(state, scene_id).ok().flatten());
    build_model_log_context(
        project_id,
        Some(scene_id.to_string()),
        Some(task_id.to_string()),
    )
}

fn model_log_context_from_workflow_body(
    body: &Value,
    scene_id: Option<String>,
    task_id: Option<String>,
) -> ModelLogContext {
    build_model_log_context(
        body.get("projectId").and_then(trimmed_json_string),
        scene_id,
        task_id,
    )
}

fn video_task_metadata_with_model_log_context(metadata: &Value) -> Value {
    let context = current_model_log_context();
    let mut output = metadata.clone();
    let Some(object) = output.as_object_mut() else {
        return output;
    };
    if let Some(project_id) = context.project_id.as_ref() {
        object.insert("projectId".to_string(), json!(project_id));
    }
    if let Some(scene_id) = context.scene_id.as_ref() {
        object.insert("sceneId".to_string(), json!(scene_id));
    }
    if let Some(task_id) = context.task_id.as_ref() {
        object.insert("taskId".to_string(), json!(task_id));
    }
    output
}

fn spawn_video_task_background<F>(context: ModelLogContext, future: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    tauri::async_runtime::spawn(CURRENT_MODEL_LOG_CONTEXT.scope(context, future));
}

fn insert_pending_video_task(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
    config: &Value,
    metadata: &Value,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let now = now_iso();
    let metadata = video_task_metadata_with_model_log_context(metadata);
    conn.execute(
        "INSERT INTO video_tasks (id, scene_id, status, progress, config, video_data, metadata, created_at, updated_at)
         VALUES (?1, ?2, 'pending', 0, ?3, NULL, ?4, ?5, ?6)",
        params![
            task_id,
            scene_id,
            config.to_string(),
            metadata.to_string(),
            now,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn update_video_task_progress(
    state: &BackendState,
    task_id: &str,
    status: &str,
    progress: i64,
    error: Option<&str>,
    video_data: Option<&str>,
    metadata: Option<&Value>,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let now = now_iso();
    let metadata_value = metadata.map(video_task_metadata_with_model_log_context);
    conn.execute(
        "UPDATE video_tasks
         SET status = ?2, progress = ?3, error = ?4, video_data = COALESCE(?5, video_data), metadata = COALESCE(?6, metadata), updated_at = ?7
         WHERE id = ?1",
        params![
            task_id,
            status,
            progress,
            error,
            video_data,
            metadata_value.as_ref().map(Value::to_string),
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn persist_last_frame_from_video_url(
    state: &BackendState,
    scene_id: &str,
    video_url: &str,
) -> Option<String> {
    let trimmed_video_url = video_url.trim();
    let video_input = if is_http_url(trimmed_video_url) {
        trimmed_video_url.to_string()
    } else {
        let video_path = resolve_video_source_path(state, trimmed_video_url)?;
        if !video_path.exists() {
            return None;
        }
        video_path.to_string_lossy().to_string()
    };

    let temp_dir = std::env::temp_dir().join(format!(
        "playlet_last_frame_{}_{}",
        Utc::now().timestamp_millis(),
        Uuid::new_v4().simple()
    ));
    fs::create_dir_all(&temp_dir).ok()?;
    let frame_path = temp_dir.join("last_frame.png");
    let result = run_ffmpeg(&[
        "-y".to_string(),
        "-sseof".to_string(),
        "-0.1".to_string(),
        "-i".to_string(),
        video_input,
        "-frames:v".to_string(),
        "1".to_string(),
        frame_path.to_string_lossy().to_string(),
    ])
    .ok()
    .and_then(|_| fs::read(&frame_path).ok())
    .and_then(|bytes| {
        persist_image_bytes(
            state,
            &format!("video_last_frame_{}", scene_id),
            Some("image/png"),
            "png",
            &bytes,
        )
        .ok()
    });
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn sync_scene_video_result(
    state: &BackendState,
    scene_id: &str,
    video_url: &str,
) -> Result<Option<String>, ApiError> {
    if scene_id.trim().is_empty() || video_url.trim().is_empty() {
        return Ok(None);
    }
    let last_frame = persist_last_frame_from_video_url(state, scene_id, video_url);
    let conn = db_connection(state)?;
    if let Some(last_frame_url) = last_frame.as_deref() {
        conn.execute(
            "UPDATE scenes SET video_url = ?1, last_frame = ?2, status = 'video_ready', updated_at = ?3 WHERE id = ?4",
            params![video_url.trim(), last_frame_url, now_iso(), scene_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    } else {
        conn.execute(
            "UPDATE scenes SET video_url = ?1, status = 'video_ready', updated_at = ?2 WHERE id = ?3",
            params![video_url.trim(), now_iso(), scene_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(last_frame)
}

fn persist_generated_video_record(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
    video_url: &str,
    metadata: &Value,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let duration = metadata.get("duration").and_then(Value::as_f64);
    let resolution = metadata.get("resolution").and_then(Value::as_str);
    let aspect_ratio = metadata.get("aspectRatio").and_then(Value::as_str);
    let fps = metadata.get("fps").and_then(Value::as_i64).unwrap_or(24);
    let has_audio = metadata
        .get("hasAudio")
        .and_then(Value::as_bool)
        .map(i64::from)
        .unwrap_or(1);
    conn.execute(
        "INSERT INTO generated_videos
           (id, scene_id, task_id, video_path, duration, resolution, aspect_ratio, fps, has_audio, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           scene_id = excluded.scene_id,
           task_id = excluded.task_id,
           video_path = excluded.video_path,
           duration = excluded.duration,
           resolution = excluded.resolution,
           aspect_ratio = excluded.aspect_ratio,
           fps = excluded.fps,
           has_audio = excluded.has_audio",
        params![
            format!("generated_{}", task_id),
            scene_id,
            task_id,
            video_url,
            duration,
            resolution,
            aspect_ratio,
            fps,
            has_audio,
            now_iso()
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

async fn complete_tracked_video_task(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
    provider: &str,
    model_id: Option<&str>,
    remote_video_url: &str,
    upstream_task: Value,
) -> Result<(), ApiError> {
    let local_video_url =
        persist_video_source(state, remote_video_url, &format!("video_{}", scene_id)).await?;
    let last_frame = sync_scene_video_result(state, scene_id, &local_video_url)?;
    let completed_metadata = json!({
      "provider": provider,
      "modelId": model_id.unwrap_or(""),
      "fallback": false,
      "lastFrame": last_frame,
      "remoteVideoUrl": remote_video_url,
      "upstreamTask": upstream_task
    });
    persist_generated_video_record(
        state,
        task_id,
        scene_id,
        &local_video_url,
        &completed_metadata,
    )?;
    update_video_task_progress(
        state,
        task_id,
        "completed",
        100,
        None,
        Some(&local_video_url),
        Some(&completed_metadata),
    )
}

async fn fail_tracked_video_task(
    state: &BackendState,
    task_id: &str,
    message: &str,
) -> Result<(), ApiError> {
    update_video_task_progress(state, task_id, "failed", 100, Some(message), None, None)
}

async fn refresh_tracked_video_task(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
    status: &str,
    metadata: &Value,
) {
    if status != "processing" {
        return;
    }
    let Some(upstream_task) = metadata.get("upstreamTask").and_then(Value::as_object) else {
        return;
    };
    let provider = upstream_task
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("");
    let model_id = metadata
        .get("modelId")
        .and_then(Value::as_str)
        .or_else(|| upstream_task.get("modelId").and_then(Value::as_str));

    let context = model_log_context_from_video_metadata(state, metadata, scene_id, task_id);
    let refresh_result = CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
        match provider {
            "qwen" => {
                let upstream_task_id = upstream_task.get("taskId").and_then(Value::as_str).unwrap_or("");
                if upstream_task_id.trim().is_empty() {
                    return Ok::<(), ApiError>(());
                }
                let payload = query_qwen_video_task(model_id, upstream_task_id)
                    .await
                    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
                match parse_qwen_task_status(&payload).as_str() {
                    "SUCCEEDED" => {
                        let remote_video_url = parse_qwen_video_url(&payload)
                            .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Qwen 视频成功但未返回 URL"))?;
                        complete_tracked_video_task(
                            state,
                            task_id,
                            scene_id,
                            "qwen",
                            model_id,
                            &remote_video_url,
                            json!({ "provider": "qwen", "taskId": upstream_task_id }),
                        )
                        .await?;
                    }
                    "FAILED" | "UNKNOWN" => {
                        let message = payload
                            .get("output")
                            .and_then(|output| output.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("Qwen 视频生成失败");
                        fail_tracked_video_task(state, task_id, message).await?;
                    }
                    _ => {}
                }
            }
            "volcengine" => {
                let upstream_task_id = upstream_task.get("taskId").and_then(Value::as_str).unwrap_or("");
                if upstream_task_id.trim().is_empty() {
                    return Ok::<(), ApiError>(());
                }
                let payload = query_volcengine_video_task(state, model_id, upstream_task_id)
                    .await
                    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
                match parse_volcengine_task_status(&payload).as_str() {
                    "succeeded" => {
                        let remote_video_url = parse_volcengine_video_url(&payload)
                            .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Volcengine 视频成功但未返回 URL"))?;
                        complete_tracked_video_task(
                            state,
                            task_id,
                            scene_id,
                            "volcengine",
                            model_id,
                            &remote_video_url,
                            json!({ "provider": "volcengine", "taskId": upstream_task_id }),
                        )
                        .await?;
                    }
                    "failed" | "cancelled" | "expired" => {
                        let message = payload
                            .get("error")
                            .and_then(|error| error.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("Volcengine 视频生成失败");
                        fail_tracked_video_task(state, task_id, message).await?;
                    }
                    _ => {}
                }
            }
            "kling" => {
                let upstream_task_id = upstream_task.get("taskId").and_then(Value::as_str).unwrap_or("");
                let endpoint = upstream_task.get("endpoint").and_then(Value::as_str).unwrap_or("");
                if upstream_task_id.trim().is_empty() || endpoint.trim().is_empty() {
                    return Ok::<(), ApiError>(());
                }
                let payload = query_kling_video_task(model_id, endpoint, upstream_task_id)
                    .await
                    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
                match parse_kling_task_status(&payload).as_str() {
                    "succeed" => {
                        let remote_video_url = parse_kling_video_url(&payload)
                            .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Kling 视频成功但未返回 URL"))?;
                        complete_tracked_video_task(
                            state,
                            task_id,
                            scene_id,
                            "kling",
                            model_id,
                            &remote_video_url,
                            json!({ "provider": "kling", "taskId": upstream_task_id, "endpoint": endpoint }),
                        )
                        .await?;
                    }
                    "failed" => {
                        let message = payload
                            .get("data")
                            .and_then(|data| data.get("task_status_msg"))
                            .and_then(Value::as_str)
                            .or_else(|| payload.get("message").and_then(Value::as_str))
                            .unwrap_or("Kling 视频生成失败");
                        fail_tracked_video_task(state, task_id, message).await?;
                    }
                    _ => {}
                }
            }
            "gemini" => {
                let operation_name = upstream_task.get("operationName").and_then(Value::as_str).unwrap_or("");
                if operation_name.trim().is_empty() {
                    return Ok::<(), ApiError>(());
                }
                let payload = query_gemini_video_task(state, model_id, operation_name)
                    .await
                    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
                if let Some(message) = parse_gemini_operation_error(&payload) {
                    fail_tracked_video_task(state, task_id, &message).await?;
                } else if parse_gemini_operation_done(&payload) {
                    let (source, mime, is_uri) = parse_gemini_video_source(&payload)
                        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "Gemini 视频完成但未返回可用视频"))?;
                    let local_video_url = persist_gemini_video_source(
                        state,
                        &source,
                        mime.as_deref(),
                        is_uri,
                        &format!("video_{}", scene_id),
                    )
                    .await?;
                    let last_frame = sync_scene_video_result(state, scene_id, &local_video_url)?;
                    let completed_metadata = json!({
                      "provider": "gemini",
                      "modelId": model_id.unwrap_or(""),
                      "fallback": false,
                      "lastFrame": last_frame,
                      "remoteVideoUrl": if is_uri { Value::String(source) } else { Value::Null },
                      "upstreamTask": { "provider": "gemini", "operationName": operation_name }
                    });
                    persist_generated_video_record(state, task_id, scene_id, &local_video_url, &completed_metadata)?;
                    update_video_task_progress(
                        state,
                        task_id,
                        "completed",
                        100,
                        None,
                        Some(&local_video_url),
                        Some(&completed_metadata),
                    )?;
                }
            }
            _ => {}
        }
        Ok::<(), ApiError>(())
        })
        .await;

    if let Err(error) = refresh_result {
        eprintln!(
            "[VideoStatus] 刷新上游任务状态失败: {}: {}",
            task_id, error.message
        );
    }
}

fn qwen_api_base_url() -> String {
    "https://dashscope.aliyuncs.com/api/v1".to_string()
}

fn qwen_video_endpoint(base_url: &str) -> String {
    format!(
        "{}/services/aigc/video-generation/video-synthesis",
        base_url
    )
}

fn qwen_task_endpoint(base_url: &str, task_id: &str) -> String {
    format!("{}/tasks/{}", base_url, task_id)
}

fn normalize_qwen_resolution(value: Option<&Value>) -> String {
    let raw = value.and_then(Value::as_str).unwrap_or("720P").trim();
    match raw.to_ascii_uppercase().replace('P', "").as_str() {
        "480" => "480P".to_string(),
        "1080" => "1080P".to_string(),
        _ => "720P".to_string(),
    }
}

fn normalize_video_duration(value: Option<&Value>) -> i64 {
    let numeric = value.and_then(Value::as_i64).unwrap_or(8);
    numeric.clamp(2, 15)
}

fn qwen_reference_media_type(url: &str) -> &'static str {
    let normalized = url.trim().to_ascii_lowercase();
    if normalized.starts_with("data:video/")
        || normalized.contains(".mp4")
        || normalized.contains(".mov")
        || normalized.contains(".webm")
    {
        "reference_video"
    } else {
        "reference_image"
    }
}

fn build_qwen_video_request(model_id: &str, config: &Value) -> Value {
    let prompt = json_string(config.get("prompt"), "");
    let aspect_ratio = json_string(config.get("aspectRatio"), "16:9");
    let duration = normalize_video_duration(config.get("duration"));
    let resolution = normalize_qwen_resolution(config.get("resolution"));
    let image_url = config
        .get("imageUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let first_frame = config
        .get("firstFrame")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let last_frame = config
        .get("lastFrame")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let reference_images = config
        .get("referenceImages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let audio_url = config
        .get("audioUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut input = serde_json::Map::new();
    input.insert("prompt".to_string(), json!(prompt));
    let mut parameters = serde_json::Map::new();
    parameters.insert("resolution".to_string(), json!(resolution));
    parameters.insert("duration".to_string(), json!(duration));
    parameters.insert("watermark".to_string(), json!(false));
    parameters.insert("prompt_extend".to_string(), json!(true));

    if model_id.contains("wan2.7-t2v")
        || (!model_id.contains("i2v")
            && !model_id.contains("r2v")
            && image_url.is_none()
            && first_frame.is_none()
            && reference_images.is_empty())
    {
        parameters.insert("ratio".to_string(), json!(aspect_ratio));
        if let Some(audio_url) = audio_url {
            input.insert("audio_url".to_string(), json!(audio_url));
        }
    } else if model_id.contains("wan2.7-r2v") || !reference_images.is_empty() {
        parameters.insert("ratio".to_string(), json!(aspect_ratio));
        let candidates = image_url
            .into_iter()
            .map(str::to_string)
            .chain(reference_images)
            .take(5)
            .enumerate()
            .map(|(index, url)| {
                let mut media = serde_json::Map::new();
                media.insert("type".to_string(), json!(qwen_reference_media_type(&url)));
                media.insert("url".to_string(), json!(url));
                if index == 0 {
                    if let Some(audio_url) = audio_url {
                        media.insert("reference_voice".to_string(), json!(audio_url));
                    }
                }
                Value::Object(media)
            })
            .collect::<Vec<_>>();
        input.insert("media".to_string(), Value::Array(candidates));
    } else {
        let mut media = Vec::new();
        if let Some(first) = first_frame.or(image_url) {
            media.push(json!({ "type": "first_frame", "url": first }));
        }
        if let Some(last) = last_frame {
            media.push(json!({ "type": "last_frame", "url": last }));
        }
        if let Some(audio_url) = audio_url {
            media.push(json!({ "type": "driving_audio", "url": audio_url }));
        }
        input.insert("media".to_string(), Value::Array(media));
    }

    json!({
      "model": model_id,
      "input": Value::Object(input),
      "parameters": Value::Object(parameters)
    })
}

fn parse_qwen_task_id(payload: &Value) -> Option<String> {
    payload
        .get("output")
        .and_then(|output| output.get("task_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_qwen_task_status(payload: &Value) -> String {
    payload
        .get("output")
        .and_then(|output| output.get("task_status"))
        .and_then(Value::as_str)
        .unwrap_or("UNKNOWN")
        .to_ascii_uppercase()
}

fn parse_qwen_video_url(payload: &Value) -> Option<String> {
    payload
        .get("output")
        .and_then(|output| output.get("video_url"))
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("output")
                .and_then(|output| output.get("results"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("url"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn submit_qwen_video_task(model_id: &str, config: &Value) -> Result<(String, Value), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let api_key = provider_sync_api_key("qwen", &current_provider_creds()).ok_or_else(|| {
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => "未配置千问 API Key，请在设置中配置"
        );
        "未配置千问 API Key，请在设置中配置".to_string()
    })?;
    let base_url = qwen_api_base_url();
    let request_body = build_qwen_video_request(model_id, config);
    let endpoint = qwen_video_endpoint(&base_url);

    llm_dev_log!(
        "request",
        "qwen",
        model_id,
        "generateVideo",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(&json_string(config.get("prompt"), ""), 220),
        "duration" => normalize_video_duration(config.get("duration"))
    );

    let response = llm_http_client()
        .post(&endpoint)
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .header("X-DashScope-Async", "enable")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "qwen",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Qwen 视频任务响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let upstream_task_id = match parse_qwen_task_id(&payload) {
        Some(task_id) => task_id,
        None => {
            let message = "Qwen 未返回 task_id";
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "qwen",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };
    llm_dev_log!(
        "task",
        "qwen",
        model_id,
        "generateVideo",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "status" => status.as_u16(),
        "taskId" => upstream_task_id.as_str()
    );
    llm_dev_write_db_log(
        "qwen",
        model_id,
        "generateVideo",
        "task",
        _log_started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&json!({ "taskId": upstream_task_id.as_str() })),
        Some(body_text.as_str()),
        None,
    );
    Ok((upstream_task_id, request_body))
}

async fn poll_qwen_video_task<F>(
    model_id: &str,
    upstream_task_id: &str,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(i64),
{
    let api_key = provider_sync_api_key("qwen", &current_provider_creds())
        .ok_or_else(|| "未配置千问 API Key，请在设置中配置".to_string())?;
    let base_url = qwen_api_base_url();
    let started_at = Utc::now().timestamp_millis();
    let progress_window_ms = 10 * 60 * 1000i64;
    let endpoint = qwen_task_endpoint(&base_url, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let elapsed = Utc::now().timestamp_millis() - started_at;
        let progress = 30 + ((elapsed as f64 / progress_window_ms as f64) * 60.0).round() as i64;
        on_progress(progress.clamp(30, 90));
        let response = llm_http_client()
            .get(&endpoint)
            .bearer_auth(&api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "qwen",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Qwen 视频状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        match parse_qwen_task_status(&payload).as_str() {
            "SUCCEEDED" => {
                let url = parse_qwen_video_url(&payload)
                    .ok_or_else(|| "Qwen 视频成功但未返回 URL".to_string())?;
                llm_dev_write_db_log(
                    "qwen",
                    model_id,
                    "generateVideo",
                    "success",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    Some(&json!({
                      "taskId": upstream_task_id,
                      "url": url.as_str()
                    })),
                    Some(body_text.as_str()),
                    None,
                );
                return Ok(url);
            }
            "FAILED" => {
                let message = payload
                    .get("output")
                    .and_then(|output| output.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Qwen 视频生成失败");
                llm_dev_write_db_log(
                    "qwen",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    Some(&payload),
                    Some(body_text.as_str()),
                    Some(message),
                );
                return Err(message.to_string());
            }
            "UNKNOWN" => {
                let message = "Qwen 视频任务不存在或已过期".to_string();
                llm_dev_write_db_log(
                    "qwen",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    Some(&payload),
                    Some(body_text.as_str()),
                    Some(message.as_str()),
                );
                return Err(message);
            }
            _ => {}
        }
    }
}

async fn query_qwen_video_task(
    model_id: Option<&str>,
    upstream_task_id: &str,
) -> Result<Value, String> {
    let model_id = model_id.unwrap_or("").trim();
    let started_at = Utc::now().timestamp_millis();
    let api_key = provider_sync_api_key("qwen", &current_provider_creds())
        .ok_or_else(|| "未配置千问 API Key，请在设置中配置".to_string())?;
    let base_url = qwen_api_base_url();
    let endpoint = qwen_task_endpoint(&base_url, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });
    let response = llm_http_client()
        .get(&endpoint)
        .bearer_auth(&api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        let message = error.to_string();
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            None,
            Some(message.as_str()),
        );
        message
    })?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Qwen 视频状态失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        message
    })?;
    llm_dev_write_db_log(
        "qwen",
        model_id,
        "generateVideo",
        "status",
        started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&payload),
        Some(body_text.as_str()),
        None,
    );
    Ok(payload)
}

fn qwen_tts_multimodal_endpoint(base_url: &str) -> String {
    format!(
        "{}/services/aigc/multimodal-generation/generation",
        base_url
    )
}

fn qwen_tts_legacy_endpoint(base_url: &str) -> String {
    format!("{}/services/aigc/text2audio/speech-synthesis", base_url)
}

fn qwen_audio_mime_from_format(format: &str) -> &'static str {
    match format.trim().to_ascii_lowercase().as_str() {
        "wav" => "audio/wav",
        "pcm" => "audio/pcm",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        _ => "audio/mpeg",
    }
}

fn parse_qwen_tts_result(payload: &Value) -> Option<(String, Option<String>, bool)> {
    if let Some(audio) = payload.get("output").and_then(|output| output.get("audio")) {
        if let Some(url) = audio
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((url.to_string(), None, true));
        }
        if let Some(data) = audio
            .get("data")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((data.to_string(), Some("audio/mpeg".to_string()), false));
        }
    }
    if let Some(url) = payload
        .get("output")
        .and_then(|output| output.get("audio_url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some((url.to_string(), None, true));
    }
    if let Some(data) = payload
        .get("output")
        .and_then(|output| output.get("audio"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some((data.to_string(), Some("audio/mpeg".to_string()), false));
    }
    None
}

async fn request_qwen_text_to_speech(
    model_id: &str,
    body: &Value,
) -> Result<(String, Option<String>, bool, Value), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let api_key = provider_sync_api_key("qwen", &current_provider_creds()).ok_or_else(|| {
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "textToSpeech",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => "未配置千问 API Key，请在设置中配置"
        );
        "未配置千问 API Key，请在设置中配置".to_string()
    })?;
    let base_url = qwen_api_base_url();
    let text = json_string(body.get("prompt"), "");
    let voice = json_string(body.get("voice"), "Cherry");
    let language_type = json_string(body.get("languageType"), "Chinese");
    let format = json_string(body.get("format"), "mp3");
    let sample_rate = body
        .get("sampleRate")
        .and_then(Value::as_i64)
        .unwrap_or(22050);

    let (endpoint, request_body) =
        if model_id == "qwen3-tts-instruct-flash" || model_id == "qwen3-tts-flash" {
            (
                qwen_tts_multimodal_endpoint(&base_url),
                json!({
                  "model": "qwen3-tts-instruct-flash",
                  "input": {
                    "text": text,
                    "voice": voice,
                    "language_type": language_type
                  }
                }),
            )
        } else {
            (
                qwen_tts_legacy_endpoint(&base_url),
                json!({
                  "model": model_id,
                  "input": { "text": text },
                  "parameters": {
                    "voice": voice,
                    "format": format,
                    "sample_rate": sample_rate
                  }
                }),
            )
        };

    llm_dev_log!(
        "request",
        "qwen",
        model_id,
        "textToSpeech",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "text" => llm_dev_log_preview(&text, 220),
        "voice" => voice.as_str(),
        "format" => format.as_str()
    );

    let response = llm_http_client()
        .post(&endpoint)
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "textToSpeech",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "qwen",
                model_id,
                "textToSpeech",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        let message = error.to_string();
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "textToSpeech",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            None,
            Some(message.as_str()),
        );
        message
    })?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "textToSpeech",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "textToSpeech",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Qwen TTS 响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "qwen",
            model_id,
            "textToSpeech",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "qwen",
            model_id,
            "textToSpeech",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let (source, mime_type, is_url) = match parse_qwen_tts_result(&payload) {
        Some(result) => result,
        None => {
            let message = "TTS 生成失败";
            llm_dev_write_db_log(
                "qwen",
                model_id,
                "textToSpeech",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "qwen",
                model_id,
                "textToSpeech",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };
    let mime_type = mime_type.or_else(|| Some(qwen_audio_mime_from_format(&format).to_string()));
    llm_dev_log!(
        "success",
        "qwen",
        model_id,
        "textToSpeech",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "status" => status.as_u16(),
        "result" => llm_dev_log_source_summary(&source),
        "mimeType" => mime_type.as_deref().unwrap_or("unknown"),
        "isUrl" => is_url
    );
    llm_dev_write_db_log(
        "qwen",
        model_id,
        "textToSpeech",
        "success",
        _log_started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&json!({
          "source": source.as_str(),
          "mimeType": mime_type.as_deref().unwrap_or("unknown"),
          "isUrl": is_url
        })),
        Some(body_text.as_str()),
        None,
    );
    Ok((source, mime_type, is_url, request_body))
}

async fn run_qwen_video_task_background(
    state: BackendState,
    task_id: String,
    scene_id: String,
    model_id: String,
    config: Value,
) {
    let result = async {
        update_video_task_progress(&state, &task_id, "processing", 10, None, None, None)?;
        let (upstream_task_id, request_body) = submit_qwen_video_task(&model_id, &config)
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        let metadata = json!({
          "provider": "qwen",
          "modelId": model_id,
          "fallback": false,
          "upstreamTask": {
            "provider": "qwen",
            "taskId": upstream_task_id,
            "request": request_body
          }
        });
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            30,
            None,
            None,
            Some(&metadata),
        )?;
        let remote_video_url = poll_qwen_video_task(&model_id, &upstream_task_id, |progress| {
            let _ = update_video_task_progress(
                &state,
                &task_id,
                "processing",
                progress,
                None,
                None,
                None,
            );
        })
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            95,
            None,
            None,
            Some(&metadata),
        )?;
        let local_video_url =
            persist_video_source(&state, &remote_video_url, &format!("video_{}", scene_id)).await?;
        let last_frame = sync_scene_video_result(&state, &scene_id, &local_video_url)?;
        let completed_metadata = json!({
          "provider": "qwen",
          "modelId": model_id,
          "fallback": false,
          "lastFrame": last_frame,
          "remoteVideoUrl": remote_video_url,
          "upstreamTask": {
            "provider": "qwen",
            "taskId": upstream_task_id
          }
        });
        persist_generated_video_record(
            &state,
            &task_id,
            &scene_id,
            &local_video_url,
            &completed_metadata,
        )?;
        update_video_task_progress(
            &state,
            &task_id,
            "completed",
            100,
            None,
            Some(&local_video_url),
            Some(&completed_metadata),
        )?;
        Ok::<(), ApiError>(())
    }
    .await;

    if let Err(error) = result {
        let _ = update_video_task_progress(
            &state,
            &task_id,
            "failed",
            100,
            Some(&error.message),
            None,
            None,
        );
    }
}

fn volcengine_video_base_url(creds: &Value) -> String {
    provider_sync_base_url("volcengine", creds)
        .unwrap_or_else(|| "https://ark.cn-beijing.volces.com/api/v3".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn volcengine_create_task_endpoint(base_url: &str) -> String {
    format!("{}/contents/generations/tasks", base_url)
}

fn volcengine_task_endpoint(base_url: &str, task_id: &str) -> String {
    format!("{}/contents/generations/tasks/{}", base_url, task_id)
}

fn normalize_volcengine_aspect_ratio(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str).map(str::trim) {
        Some("9:16") => "9:16".to_string(),
        Some("1:1") => "1:1".to_string(),
        _ => "16:9".to_string(),
    }
}

fn is_seedance_model(model_id: &str) -> bool {
    model_id.trim().to_ascii_lowercase().contains("seedance")
}

fn is_seedance_fast_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    normalized.contains("seedance") && normalized.contains("fast")
}

fn normalize_volcengine_resolution(model_id: &str, value: Option<&Value>) -> String {
    let resolution = match value.and_then(Value::as_str).map(str::trim) {
        Some("480p") => "480p",
        Some("1080p") => "1080p",
        _ => "720p",
    };
    if resolution == "1080p" && is_seedance_fast_model(model_id) {
        "720p".to_string()
    } else {
        resolution.to_string()
    }
}

fn workflow_seedance_video_resolution(
    workflow_model_options: &Value,
    model_id: &str,
) -> Option<String> {
    if !is_seedance_model(model_id) {
        return None;
    }
    let configured_quality = workflow_model_options
        .get("video_generation")
        .and_then(|value| value.get("seedance"))
        .and_then(|value| value.get("quality"));
    Some(normalize_volcengine_resolution(
        model_id,
        configured_quality,
    ))
}

fn apply_workflow_video_generation_options(
    config: &mut Value,
    workflow_model_options: &Value,
    provider: &str,
    model_id: &str,
) {
    if provider != "volcengine" {
        return;
    }
    if let Some(resolution) = workflow_seedance_video_resolution(workflow_model_options, model_id) {
        if let Some(object) = config.as_object_mut() {
            object.insert("resolution".to_string(), json!(resolution));
        }
    }
}

fn normalize_video_url_input(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn build_volcengine_video_request(model_id: &str, config: &Value) -> Value {
    let prompt = json_string(config.get("prompt"), "");
    let aspect_ratio = normalize_volcengine_aspect_ratio(config.get("aspectRatio"));
    let duration = normalize_video_duration(config.get("duration")).clamp(4, 15);
    let resolution = normalize_volcengine_resolution(model_id, config.get("resolution"));
    let image_url = normalize_video_url_input(config.get("imageUrl"));
    let first_frame = normalize_video_url_input(config.get("firstFrame"));
    let last_frame = normalize_video_url_input(config.get("lastFrame"));
    let audio_url = normalize_video_url_input(config.get("audioUrl"));
    let reference_images = config
        .get("referenceImages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .take(9)
        .collect::<Vec<_>>();

    let has_reference_images = !reference_images.is_empty();
    let using_first_last = !has_reference_images && first_frame.is_some() && last_frame.is_some();
    let using_single_image = !has_reference_images
        && !using_first_last
        && (image_url.is_some() || first_frame.is_some());
    let mut content = vec![json!({ "type": "text", "text": prompt })];

    if has_reference_images {
        for image in reference_images {
            content.push(json!({
              "type": "image_url",
              "role": "reference_image",
              "image_url": { "url": image }
            }));
        }
    } else if using_first_last {
        if let Some(first_frame) = first_frame {
            content.push(json!({
              "type": "image_url",
              "role": "first_frame",
              "image_url": { "url": first_frame }
            }));
        }
        if let Some(last_frame) = last_frame {
            content.push(json!({
              "type": "image_url",
              "role": "last_frame",
              "image_url": { "url": last_frame }
            }));
        }
    } else if using_single_image {
        if let Some(single_image) = image_url.or(first_frame) {
            content.push(json!({
              "type": "image_url",
              "role": "first_frame",
              "image_url": { "url": single_image }
            }));
        }
    }

    let has_visual_reference = has_reference_images || using_first_last || using_single_image;
    if has_visual_reference {
        if let Some(audio_url) = audio_url {
            content.push(json!({
              "type": "audio_url",
              "role": "reference_audio",
              "audio_url": { "url": audio_url }
            }));
        }
    }

    json!({
      "model": model_id,
      "content": content,
      "duration": duration,
      "ratio": aspect_ratio,
      "resolution": resolution,
      "watermark": false,
      "generate_audio": config.get("audio").and_then(Value::as_bool).unwrap_or(true)
    })
}

fn parse_volcengine_task_id(payload: &Value) -> Option<String> {
    payload
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_volcengine_task_status(payload: &Value) -> String {
    payload
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_ascii_lowercase()
}

fn parse_volcengine_video_url(payload: &Value) -> Option<String> {
    payload
        .get("content")
        .and_then(|content| content.get("video_url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn submit_volcengine_video_task(
    state: &BackendState,
    model_id: &str,
    config: &Value,
) -> Result<(String, Value), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let conn = db_connection(state).map_err(|error| error.message)?;
    let creds = load_provider_creds(&conn);
    let api_key = provider_sync_api_key("volcengine", &creds).ok_or_else(|| {
        llm_dev_log!(
            "error",
            "volcengine",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => "未配置火山引擎 API Key，请在设置中配置"
        );
        "未配置火山引擎 API Key，请在设置中配置".to_string()
    })?;
    let base_url = volcengine_video_base_url(&creds);
    let request_body = build_volcengine_video_request(model_id, config);
    let endpoint = volcengine_create_task_endpoint(&base_url);

    llm_dev_log!(
        "request",
        "volcengine",
        model_id,
        "generateVideo",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(&json_string(config.get("prompt"), ""), 220),
        "duration" => normalize_video_duration(config.get("duration"))
    );

    let response = llm_http_client()
        .post(&endpoint)
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "volcengine",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "volcengine",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "volcengine",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "volcengine",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Volcengine 视频任务响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "volcengine",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "volcengine",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let upstream_task_id = match parse_volcengine_task_id(&payload) {
        Some(task_id) => task_id,
        None => {
            let message = "Volcengine 未返回任务 id";
            llm_dev_write_db_log(
                "volcengine",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "volcengine",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };
    llm_dev_log!(
        "task",
        "volcengine",
        model_id,
        "generateVideo",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "status" => status.as_u16(),
        "taskId" => upstream_task_id.as_str()
    );
    llm_dev_write_db_log(
        "volcengine",
        model_id,
        "generateVideo",
        "task",
        _log_started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&json!({ "taskId": upstream_task_id.as_str() })),
        Some(body_text.as_str()),
        None,
    );
    Ok((upstream_task_id, request_body))
}

async fn poll_volcengine_video_task<F>(
    state: &BackendState,
    model_id: &str,
    upstream_task_id: &str,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(i64),
{
    let conn = db_connection(state).map_err(|error| error.message)?;
    let creds = load_provider_creds(&conn);
    let api_key = provider_sync_api_key("volcengine", &creds)
        .ok_or_else(|| "未配置火山引擎 API Key，请在设置中配置".to_string())?;
    let base_url = volcengine_video_base_url(&creds);
    let started_at = Utc::now().timestamp_millis();
    let progress_window_ms = 10 * 60 * 1000i64;
    let endpoint = volcengine_task_endpoint(&base_url, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });

    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let elapsed = Utc::now().timestamp_millis() - started_at;
        let progress = 30 + ((elapsed as f64 / progress_window_ms as f64) * 60.0).round() as i64;
        on_progress(progress.clamp(30, 90));

        let response = llm_http_client()
            .get(&endpoint)
            .bearer_auth(&api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "volcengine",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "volcengine",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Volcengine 视频状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "volcengine",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        match parse_volcengine_task_status(&payload).as_str() {
            "succeeded" => {
                let url = parse_volcengine_video_url(&payload)
                    .ok_or_else(|| "Volcengine 视频成功但未返回 URL".to_string())?;
                llm_dev_write_db_log(
                    "volcengine",
                    model_id,
                    "generateVideo",
                    "success",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    Some(&json!({
                      "taskId": upstream_task_id,
                      "url": url.as_str()
                    })),
                    Some(body_text.as_str()),
                    None,
                );
                return Ok(url);
            }
            "failed" | "cancelled" | "expired" => {
                let message = payload
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Volcengine 视频生成失败");
                llm_dev_write_db_log(
                    "volcengine",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    Some(&payload),
                    Some(body_text.as_str()),
                    Some(message),
                );
                return Err(message.to_string());
            }
            _ => {}
        }
    }
}

async fn query_volcengine_video_task(
    state: &BackendState,
    model_id: Option<&str>,
    upstream_task_id: &str,
) -> Result<Value, String> {
    let model_id = model_id.unwrap_or("").trim();
    let started_at = Utc::now().timestamp_millis();
    let conn = db_connection(state).map_err(|error| error.message)?;
    let creds = load_provider_creds(&conn);
    let api_key = provider_sync_api_key("volcengine", &creds)
        .ok_or_else(|| "未配置火山引擎 API Key，请在设置中配置".to_string())?;
    let base_url = volcengine_video_base_url(&creds);
    let endpoint = volcengine_task_endpoint(&base_url, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });
    let response = llm_http_client()
        .get(&endpoint)
        .bearer_auth(&api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "volcengine",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        let message = error.to_string();
        llm_dev_write_db_log(
            "volcengine",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            None,
            Some(message.as_str()),
        );
        message
    })?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "volcengine",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Volcengine 视频状态失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "volcengine",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        message
    })?;
    llm_dev_write_db_log(
        "volcengine",
        model_id,
        "generateVideo",
        "status",
        started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&payload),
        Some(body_text.as_str()),
        None,
    );
    Ok(payload)
}

async fn run_volcengine_video_task_background(
    state: BackendState,
    task_id: String,
    scene_id: String,
    model_id: String,
    config: Value,
) {
    let result = async {
        update_video_task_progress(&state, &task_id, "processing", 10, None, None, None)?;
        let (upstream_task_id, request_body) =
            submit_volcengine_video_task(&state, &model_id, &config)
                .await
                .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        let metadata = json!({
          "provider": "volcengine",
          "modelId": model_id,
          "fallback": false,
          "upstreamTask": {
            "provider": "volcengine",
            "taskId": upstream_task_id,
            "request": request_body
          }
        });
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            30,
            None,
            None,
            Some(&metadata),
        )?;
        let remote_video_url =
            poll_volcengine_video_task(&state, &model_id, &upstream_task_id, |progress| {
                let _ = update_video_task_progress(
                    &state,
                    &task_id,
                    "processing",
                    progress,
                    None,
                    None,
                    None,
                );
            })
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            95,
            None,
            None,
            Some(&metadata),
        )?;
        let local_video_url =
            persist_video_source(&state, &remote_video_url, &format!("video_{}", scene_id)).await?;
        let last_frame = sync_scene_video_result(&state, &scene_id, &local_video_url)?;
        let completed_metadata = json!({
          "provider": "volcengine",
          "modelId": model_id,
          "fallback": false,
          "lastFrame": last_frame,
          "remoteVideoUrl": remote_video_url,
          "upstreamTask": {
            "provider": "volcengine",
            "taskId": upstream_task_id
          }
        });
        persist_generated_video_record(
            &state,
            &task_id,
            &scene_id,
            &local_video_url,
            &completed_metadata,
        )?;
        update_video_task_progress(
            &state,
            &task_id,
            "completed",
            100,
            None,
            Some(&local_video_url),
            Some(&completed_metadata),
        )?;
        Ok::<(), ApiError>(())
    }
    .await;

    if let Err(error) = result {
        let _ = update_video_task_progress(
            &state,
            &task_id,
            "failed",
            100,
            Some(&error.message),
            None,
            None,
        );
    }
}

fn base64_url_encode_bytes(bytes: &[u8]) -> String {
    BASE64_STANDARD
        .encode(bytes)
        .replace('=', "")
        .replace('+', "-")
        .replace('/', "_")
}

fn build_kling_jwt(access_key: &str, secret_key: &str) -> Result<String, String> {
    let now = Utc::now().timestamp();
    let header = json!({ "alg": "HS256", "typ": "JWT" }).to_string();
    let payload = json!({
      "iss": access_key,
      "exp": now + 30 * 60,
      "nbf": now - 5
    })
    .to_string();
    let encoded_header = base64_url_encode_bytes(header.as_bytes());
    let encoded_payload = base64_url_encode_bytes(payload.as_bytes());
    let signing_input = format!("{}.{}", encoded_header, encoded_payload);
    let mut mac = HmacSha256::new_from_slice(secret_key.as_bytes())
        .map_err(|error| format!("Kling JWT 初始化失败: {}", error))?;
    mac.update(signing_input.as_bytes());
    let signature = mac.finalize().into_bytes();
    Ok(format!(
        "{}.{}",
        signing_input,
        base64_url_encode_bytes(&signature)
    ))
}

fn kling_base_url() -> String {
    provider_credential_field(&current_provider_creds(), "kling", "baseUrl")
        .unwrap_or_else(|| "https://api-beijing.klingai.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn kling_credentials() -> Result<(String, String), String> {
    let creds = current_provider_creds();
    let access_key = provider_credential_field(&creds, "kling", "accessKey")
        .ok_or_else(|| "未配置可灵 Access Key，请在设置中配置".to_string())?;
    let secret_key = provider_credential_field(&creds, "kling", "secretKey")
        .ok_or_else(|| "未配置可灵 Secret Key，请在设置中配置".to_string())?;
    Ok((access_key, secret_key))
}

fn strip_data_url_prefix(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.starts_with("data:") {
        return trimmed.to_string();
    }
    trimmed
        .split_once(',')
        .map(|(_, payload)| payload.trim().to_string())
        .unwrap_or_else(|| trimmed.to_string())
}

fn normalize_kling_image_reference(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        strip_data_url_prefix(trimmed)
    }
}

fn parse_size_ratio(size: &str) -> Option<f64> {
    let normalized = size.trim().replace('*', "x").to_ascii_lowercase();
    let (width_raw, height_raw) = normalized.split_once('x')?;
    let width = width_raw.parse::<f64>().ok()?;
    let height = height_raw.parse::<f64>().ok()?;
    if width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0 {
        Some(width / height)
    } else {
        None
    }
}

fn resolve_kling_image_aspect_ratio(size: &str, omni: bool) -> String {
    const RATIOS: &[(&str, f64)] = &[
        ("16:9", 16.0 / 9.0),
        ("9:16", 9.0 / 16.0),
        ("1:1", 1.0),
        ("4:3", 4.0 / 3.0),
        ("3:4", 3.0 / 4.0),
        ("3:2", 3.0 / 2.0),
        ("2:3", 2.0 / 3.0),
        ("21:9", 21.0 / 9.0),
    ];
    let Some(target) = parse_size_ratio(size) else {
        return if omni { "auto" } else { "1:1" }.to_string();
    };
    RATIOS
        .iter()
        .min_by(|(_, left), (_, right)| {
            (left - target)
                .abs()
                .partial_cmp(&(right - target).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(ratio, _)| (*ratio).to_string())
        .unwrap_or_else(|| if omni { "auto" } else { "1:1" }.to_string())
}

fn resolve_kling_image_resolution(size: &str, model_id: &str) -> String {
    let normalized = size.trim().to_ascii_lowercase();
    let mut resolution = if normalized.contains("4k") {
        "4k"
    } else if normalized.contains("2k") {
        "2k"
    } else if let Some(ratio) = parse_size_ratio(size) {
        if ratio.is_finite()
            && normalized
                .split(['x', '*'])
                .filter_map(|part| part.parse::<u32>().ok())
                .any(|value| value >= 1800)
        {
            "2k"
        } else {
            "1k"
        }
    } else {
        "1k"
    };
    if model_id == "kling-image-o1" && resolution == "4k" {
        resolution = "2k";
    }
    resolution.to_string()
}

async fn normalize_kling_image_input(
    state: &BackendState,
    value: Option<&Value>,
) -> Result<Option<String>, ApiError> {
    let Some(raw) = normalize_video_url_input(value) else {
        return Ok(None);
    };
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Ok(Some(raw));
    }
    if raw.starts_with("data:image/") {
        return Ok(Some(strip_data_url_prefix(&raw)));
    }
    let (bytes, _mime) = resolve_source_bytes(state, &raw, 35 * 1024 * 1024).await?;
    Ok(Some(BASE64_STANDARD.encode(bytes)))
}

async fn normalize_kling_reference_images(
    state: &BackendState,
    config: &Value,
) -> Result<Vec<String>, ApiError> {
    let items = config
        .get("referenceImages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in items.into_iter().take(9) {
        let Some(raw) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let normalized = if raw.starts_with("http://") || raw.starts_with("https://") {
            raw.to_string()
        } else if raw.starts_with("data:image/") {
            strip_data_url_prefix(raw)
        } else {
            let (bytes, _mime) = resolve_source_bytes(state, raw, 35 * 1024 * 1024).await?;
            BASE64_STANDARD.encode(bytes)
        };
        if seen.insert(normalized.clone()) {
            output.push(normalized);
        }
    }
    Ok(output)
}

fn normalize_kling_duration(value: Option<&Value>, model_id: &str) -> String {
    let max_duration = if model_id == "kling-video-o1" { 10 } else { 15 };
    normalize_video_duration(value)
        .clamp(3, max_duration)
        .to_string()
}

async fn build_kling_video_request(
    state: &BackendState,
    model_id: &str,
    config: &Value,
) -> Result<(String, Value), ApiError> {
    let prompt = json_string(config.get("prompt"), "");
    let aspect_ratio = json_string(config.get("aspectRatio"), "16:9");
    let duration = normalize_kling_duration(config.get("duration"), model_id);
    let with_audio = config
        .get("audio")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let sound = if with_audio { "on" } else { "off" };
    let image = normalize_kling_image_input(
        state,
        config.get("imageUrl").or_else(|| config.get("firstFrame")),
    )
    .await?;
    let image_tail = normalize_kling_image_input(state, config.get("lastFrame")).await?;
    let reference_images = normalize_kling_reference_images(state, config).await?;
    let audio_url = normalize_video_url_input(config.get("audioUrl"));
    let use_omni = matches!(model_id, "kling-video-o1" | "kling-v3-omni");
    let mut has_image_input = image.is_some() || image_tail.is_some();
    let endpoint = if use_omni {
        "/v1/videos/omni-video"
    } else if has_image_input || !reference_images.is_empty() {
        has_image_input = true;
        "/v1/videos/image2video"
    } else {
        "/v1/videos/text2video"
    };

    let mut body = serde_json::Map::new();
    body.insert("model_name".to_string(), json!(model_id));
    body.insert("prompt".to_string(), json!(prompt));
    body.insert("duration".to_string(), json!(duration));
    body.insert("mode".to_string(), json!("pro"));
    body.insert("sound".to_string(), json!(sound));

    if use_omni {
        let mut image_list = Vec::new();
        if let Some(image) = image {
            if image_tail.is_some() {
                image_list.push(json!({ "image_url": image, "type": "first_frame" }));
            } else {
                image_list.push(json!({ "image_url": image }));
            }
        }
        if let Some(image_tail) = image_tail {
            image_list.push(json!({ "image_url": image_tail, "type": "end_frame" }));
        }
        for reference in reference_images {
            image_list.push(json!({ "image_url": reference }));
        }
        if !image_list.is_empty() {
            body.insert(
                "image_list".to_string(),
                Value::Array(image_list.into_iter().take(9).collect()),
            );
        }
        if let Some(audio_url) = audio_url.filter(|_| model_id == "kling-v3-omni") {
            body.insert("audio_url".to_string(), json!(audio_url));
        }
        if !has_image_input || body.get("image_list").is_some() {
            body.insert("aspect_ratio".to_string(), json!(aspect_ratio));
        }
    } else {
        if has_image_input {
            let primary = image.or_else(|| reference_images.first().cloned());
            if let Some(primary) = primary {
                body.insert("image".to_string(), json!(primary));
            }
            if let Some(image_tail) = image_tail {
                body.insert("image_tail".to_string(), json!(image_tail));
            }
        } else {
            body.insert("aspect_ratio".to_string(), json!(aspect_ratio));
        }
    }

    Ok((endpoint.to_string(), Value::Object(body)))
}

fn parse_kling_task_id(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(|data| data.get("task_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_kling_task_status(payload: &Value) -> String {
    payload
        .get("data")
        .and_then(|data| data.get("task_status"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_ascii_lowercase()
}

fn parse_kling_video_url(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(|data| data.get("task_result"))
        .and_then(|result| result.get("videos"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|video| video.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_kling_image_url(payload: &Value) -> Option<String> {
    let task_result = payload
        .get("data")
        .and_then(|data| data.get("task_result"))?;
    task_result
        .get("images")
        .or_else(|| task_result.get("series_images"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|image| image.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn build_kling_image_request(
    model_id: &str,
    prompt: &str,
    size: &str,
    reference_images: &[String],
) -> (String, Value) {
    let model = normalize_model_id_for_remote(model_id);
    let use_omni = matches!(model.as_str(), "kling-image-o1" | "kling-v3-omni");
    let aspect_ratio = resolve_kling_image_aspect_ratio(size, use_omni);
    let normalized_references = reference_images
        .iter()
        .map(|item| normalize_kling_image_reference(item))
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    let mut body = serde_json::Map::new();
    body.insert("model_name".to_string(), json!(model));
    body.insert("prompt".to_string(), json!(prompt));
    body.insert("n".to_string(), json!(1));

    let endpoint = if use_omni {
        body.insert(
            "resolution".to_string(),
            json!(resolve_kling_image_resolution(size, &model)),
        );
        body.insert("aspect_ratio".to_string(), json!(aspect_ratio));
        body.insert("result_type".to_string(), json!("single"));
        if !normalized_references.is_empty() {
            body.insert(
                "image_list".to_string(),
                Value::Array(
                    normalized_references
                        .iter()
                        .take(9)
                        .map(|image| json!({ "image": image }))
                        .collect(),
                ),
            );
        }
        "/v1/images/omni-image"
    } else if normalized_references.len() > 1 && matches!(model.as_str(), "kling-v2" | "kling-v2-1")
    {
        body.insert("aspect_ratio".to_string(), json!(aspect_ratio));
        body.insert(
            "subject_image_list".to_string(),
            Value::Array(
                normalized_references
                    .iter()
                    .take(4)
                    .map(|image| json!({ "subject_image": image }))
                    .collect(),
            ),
        );
        "/v1/images/multi-image2image"
    } else {
        body.insert("aspect_ratio".to_string(), json!(aspect_ratio));
        if let Some(reference) = normalized_references.first() {
            body.insert("image".to_string(), json!(reference));
            if model == "kling-v1-5" {
                body.insert("image_reference".to_string(), json!("subject"));
                body.insert("image_fidelity".to_string(), json!(0.5));
                body.insert("human_fidelity".to_string(), json!(0.45));
            }
        }
        "/v1/images/generations"
    };

    (endpoint.to_string(), Value::Object(body))
}

async fn request_kling_image_generation(
    model_id: &str,
    prompt: &str,
    size: &str,
    reference_images: &[String],
) -> Result<(String, Option<String>), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let (access_key, secret_key) = kling_credentials().map_err(|error| {
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateImage",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => error.as_str()
        );
        error
    })?;
    let base_url = kling_base_url();
    let (endpoint, request_body) =
        build_kling_image_request(model_id, prompt, size, reference_images);
    let endpoint_url = format!("{}{}", base_url, endpoint);
    let token = build_kling_jwt(&access_key, &secret_key).map_err(|error| {
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateImage",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => error.as_str()
        );
        error
    })?;

    llm_dev_log!(
        "request",
        "kling",
        model_id,
        "generateImage",
        None::<i64>,
        "endpoint" => endpoint_url.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "size" => size,
        "referenceImages" => reference_images.len()
    );

    let response = llm_http_client()
        .post(&endpoint_url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint_url.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateImage",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Kling 图片任务响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateImage",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Kling API 错误");
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateImage",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateImage",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message
        );
        return Err(message.to_string());
    }
    let upstream_task_id = match parse_kling_task_id(&payload) {
        Some(task_id) => task_id,
        None => {
            let message = "Kling 未返回 task_id";
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(endpoint_url.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };

    llm_dev_log!(
        "task",
        "kling",
        model_id,
        "generateImage",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "taskId" => upstream_task_id.as_str()
    );
    llm_dev_write_db_log(
        "kling",
        model_id,
        "generateImage",
        "task",
        _log_started_at,
        Some(endpoint_url.as_str()),
        Some(&request_body),
        Some(&json!({ "taskId": upstream_task_id.as_str() })),
        Some(body_text.as_str()),
        None,
    );

    let poll_endpoint = format!("{}/{}", endpoint_url, upstream_task_id);
    let poll_request_body = json!({ "taskId": upstream_task_id.as_str() });
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let token = build_kling_jwt(&access_key, &secret_key).map_err(|error| {
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(poll_endpoint.as_str()),
                Some(&poll_request_body),
                None,
                None,
                Some(error.as_str()),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "taskId" => upstream_task_id.as_str(),
                "error" => error.as_str()
            );
            error
        })?;
        let response = llm_http_client()
            .get(&poll_endpoint)
            .bearer_auth(token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateImage",
                    "error",
                    _log_started_at,
                    Some(poll_endpoint.as_str()),
                    Some(&poll_request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    "kling",
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "taskId" => upstream_task_id.as_str(),
                    "error" => message.as_str()
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(poll_endpoint.as_str()),
                Some(&poll_request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(poll_endpoint.as_str()),
                Some(&poll_request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "taskId" => upstream_task_id.as_str(),
                "status" => status.as_u16(),
                "error" => message.as_str()
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Kling 图片状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(poll_endpoint.as_str()),
                Some(&poll_request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "taskId" => upstream_task_id.as_str(),
                "error" => message.as_str()
            );
            message
        })?;
        let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
        if code != 0 {
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Kling API 错误");
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateImage",
                "error",
                _log_started_at,
                Some(poll_endpoint.as_str()),
                Some(&poll_request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateImage",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "taskId" => upstream_task_id.as_str(),
                "status" => status.as_u16(),
                "error" => message
            );
            return Err(message.to_string());
        }
        match parse_kling_task_status(&payload).as_str() {
            "succeed" => {
                let Some(url) = parse_kling_image_url(&payload) else {
                    let message = "Kling 图片成功但未返回 URL";
                    llm_dev_write_db_log(
                        "kling",
                        model_id,
                        "generateImage",
                        "error",
                        _log_started_at,
                        Some(poll_endpoint.as_str()),
                        Some(&poll_request_body),
                        Some(&payload),
                        Some(body_text.as_str()),
                        Some(message),
                    );
                    llm_dev_log!(
                        "error",
                        "kling",
                        model_id,
                        "generateImage",
                        Some(Utc::now().timestamp_millis() - _log_started_at),
                        "taskId" => upstream_task_id.as_str(),
                        "error" => message
                    );
                    return Err(message.to_string());
                };
                llm_dev_log!(
                    "success",
                    "kling",
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "taskId" => upstream_task_id.as_str(),
                    "result" => llm_dev_log_source_summary(&url)
                );
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateImage",
                    "success",
                    _log_started_at,
                    Some(poll_endpoint.as_str()),
                    Some(&poll_request_body),
                    Some(&json!({
                      "taskId": upstream_task_id.as_str(),
                      "url": url.as_str()
                    })),
                    Some(body_text.as_str()),
                    None,
                );
                return Ok((url, None));
            }
            "failed" => {
                let message = payload
                    .get("data")
                    .and_then(|data| data.get("task_status_msg"))
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .unwrap_or("Kling 图片生成失败");
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateImage",
                    "error",
                    _log_started_at,
                    Some(poll_endpoint.as_str()),
                    Some(&poll_request_body),
                    Some(&payload),
                    Some(body_text.as_str()),
                    Some(message),
                );
                llm_dev_log!(
                    "error",
                    "kling",
                    model_id,
                    "generateImage",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "taskId" => upstream_task_id.as_str(),
                    "error" => message
                );
                return Err(message.to_string());
            }
            _ => {}
        }
    }
}

async fn submit_kling_video_task(
    state: &BackendState,
    model_id: &str,
    config: &Value,
) -> Result<(String, String, Value), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let (access_key, secret_key) = kling_credentials().map_err(|error| {
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => error.as_str()
        );
        error
    })?;
    let token = build_kling_jwt(&access_key, &secret_key).map_err(|error| {
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => error.as_str()
        );
        error
    })?;
    let base_url = kling_base_url();
    let (endpoint, request_body) = build_kling_video_request(state, model_id, config)
        .await
        .map_err(|error| {
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => error.message.as_str()
            );
            error.message
        })?;
    let endpoint_url = format!("{}{}", base_url, endpoint);

    llm_dev_log!(
        "request",
        "kling",
        model_id,
        "generateVideo",
        None::<i64>,
        "endpoint" => endpoint_url.as_str(),
        "prompt" => llm_dev_log_preview(&json_string(config.get("prompt"), ""), 220),
        "duration" => normalize_video_duration(config.get("duration"))
    );

    let response = llm_http_client()
        .post(&endpoint_url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint_url.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Kling 视频任务响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Kling API 错误");
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint_url.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message),
        );
        llm_dev_log!(
            "error",
            "kling",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message
        );
        return Err(message.to_string());
    }
    let upstream_task_id = match parse_kling_task_id(&payload) {
        Some(task_id) => task_id,
        None => {
            let message = "Kling 未返回 task_id";
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint_url.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "kling",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };
    llm_dev_log!(
        "task",
        "kling",
        model_id,
        "generateVideo",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "status" => status.as_u16(),
        "taskId" => upstream_task_id.as_str()
    );
    llm_dev_write_db_log(
        "kling",
        model_id,
        "generateVideo",
        "task",
        _log_started_at,
        Some(endpoint_url.as_str()),
        Some(&request_body),
        Some(&json!({ "taskId": upstream_task_id.as_str() })),
        Some(body_text.as_str()),
        None,
    );
    Ok((upstream_task_id, endpoint, request_body))
}

async fn poll_kling_video_task<F>(
    model_id: &str,
    endpoint: &str,
    upstream_task_id: &str,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(i64),
{
    let (access_key, secret_key) = kling_credentials()?;
    let base_url = kling_base_url();
    let started_at = Utc::now().timestamp_millis();
    let progress_window_ms = 12 * 60 * 1000i64;
    let endpoint_url = format!("{}{}", base_url, endpoint);
    let task_endpoint = format!("{}/{}", endpoint_url, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let elapsed = Utc::now().timestamp_millis() - started_at;
        let progress = 30 + ((elapsed as f64 / progress_window_ms as f64) * 60.0).round() as i64;
        on_progress(progress.clamp(30, 90));
        let token = build_kling_jwt(&access_key, &secret_key)?;
        let response = llm_http_client()
            .get(&task_endpoint)
            .bearer_auth(token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(task_endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(task_endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Kling 视频状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(task_endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
        if code != 0 {
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Kling API 错误");
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(task_endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            return Err(message.to_string());
        }
        match parse_kling_task_status(&payload).as_str() {
            "succeed" => {
                let url = parse_kling_video_url(&payload)
                    .ok_or_else(|| "Kling 视频成功但未返回 URL".to_string())?;
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateVideo",
                    "success",
                    started_at,
                    Some(task_endpoint.as_str()),
                    Some(&request_body),
                    Some(&json!({
                      "taskId": upstream_task_id,
                      "url": url.as_str()
                    })),
                    Some(body_text.as_str()),
                    None,
                );
                return Ok(url);
            }
            "failed" => {
                let message = payload
                    .get("data")
                    .and_then(|data| data.get("task_status_msg"))
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .unwrap_or("Kling 视频生成失败");
                llm_dev_write_db_log(
                    "kling",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(task_endpoint.as_str()),
                    Some(&request_body),
                    Some(&payload),
                    Some(body_text.as_str()),
                    Some(message),
                );
                return Err(message.to_string());
            }
            _ => {}
        }
    }
}

async fn run_kling_video_task_background(
    state: BackendState,
    task_id: String,
    scene_id: String,
    model_id: String,
    config: Value,
) {
    let result = async {
        update_video_task_progress(&state, &task_id, "processing", 10, None, None, None)?;
        let (upstream_task_id, endpoint, request_body) =
            submit_kling_video_task(&state, &model_id, &config)
                .await
                .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        let metadata = json!({
          "provider": "kling",
          "modelId": model_id,
          "fallback": false,
          "upstreamTask": {
            "provider": "kling",
            "taskId": upstream_task_id,
            "endpoint": endpoint,
            "request": request_body
          }
        });
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            30,
            None,
            None,
            Some(&metadata),
        )?;
        let remote_video_url =
            poll_kling_video_task(&model_id, &endpoint, &upstream_task_id, |progress| {
                let _ = update_video_task_progress(
                    &state,
                    &task_id,
                    "processing",
                    progress,
                    None,
                    None,
                    None,
                );
            })
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            95,
            None,
            None,
            Some(&metadata),
        )?;
        let local_video_url =
            persist_video_source(&state, &remote_video_url, &format!("video_{}", scene_id)).await?;
        let last_frame = sync_scene_video_result(&state, &scene_id, &local_video_url)?;
        let completed_metadata = json!({
          "provider": "kling",
          "modelId": model_id,
          "fallback": false,
          "lastFrame": last_frame,
          "remoteVideoUrl": remote_video_url,
          "upstreamTask": {
            "provider": "kling",
            "taskId": upstream_task_id,
            "endpoint": endpoint
          }
        });
        persist_generated_video_record(
            &state,
            &task_id,
            &scene_id,
            &local_video_url,
            &completed_metadata,
        )?;
        update_video_task_progress(
            &state,
            &task_id,
            "completed",
            100,
            None,
            Some(&local_video_url),
            Some(&completed_metadata),
        )?;
        Ok::<(), ApiError>(())
    }
    .await;

    if let Err(error) = result {
        let _ = update_video_task_progress(
            &state,
            &task_id,
            "failed",
            100,
            Some(&error.message),
            None,
            None,
        );
    }
}

async fn query_kling_video_task(
    model_id: Option<&str>,
    endpoint: &str,
    upstream_task_id: &str,
) -> Result<Value, String> {
    let model_id = model_id.unwrap_or("").trim();
    let started_at = Utc::now().timestamp_millis();
    let (access_key, secret_key) = kling_credentials()?;
    let base_url = kling_base_url();
    let token = build_kling_jwt(&access_key, &secret_key)?;
    let task_endpoint = format!("{}{}/{}", base_url, endpoint, upstream_task_id);
    let request_body = json!({ "taskId": upstream_task_id });
    let response = llm_http_client()
        .get(&task_endpoint)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "kling",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(task_endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        let message = error.to_string();
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(task_endpoint.as_str()),
            Some(&request_body),
            None,
            None,
            Some(message.as_str()),
        );
        message
    })?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(task_endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Kling 视频状态失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(task_endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        message
    })?;
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Kling API 错误");
        llm_dev_write_db_log(
            "kling",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(task_endpoint.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message),
        );
        return Err(message.to_string());
    }
    llm_dev_write_db_log(
        "kling",
        model_id,
        "generateVideo",
        "status",
        started_at,
        Some(task_endpoint.as_str()),
        Some(&request_body),
        Some(&payload),
        Some(body_text.as_str()),
        None,
    );
    Ok(payload)
}

fn gemini_api_base_url() -> String {
    provider_sync_base_url("gemini", &current_provider_creds())
        .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn gemini_predict_long_running_endpoint(base_url: &str, model_id: &str) -> String {
    format!(
        "{}/models/{}:predictLongRunning",
        base_url,
        normalize_model_id_for_remote(model_id)
    )
}

fn gemini_operation_endpoint(base_url: &str, operation_name: &str) -> String {
    format!("{}/{}", base_url, operation_name.trim_start_matches('/'))
}

async fn normalize_gemini_image_input(
    state: &BackendState,
    value: Option<&Value>,
) -> Result<Option<Value>, ApiError> {
    let Some(raw) = normalize_video_url_input(value) else {
        return Ok(None);
    };
    let (bytes, mime) = resolve_source_bytes(state, &raw, 35 * 1024 * 1024).await?;
    Ok(Some(json!({
      "bytesBase64Encoded": BASE64_STANDARD.encode(bytes),
      "mimeType": mime.unwrap_or_else(|| "image/png".to_string())
    })))
}

async fn normalize_gemini_reference_images(
    state: &BackendState,
    config: &Value,
) -> Result<Vec<Value>, ApiError> {
    let items = config
        .get("referenceImages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in items.into_iter().take(9) {
        let Some(raw) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let (bytes, mime) = resolve_source_bytes(state, raw, 35 * 1024 * 1024).await?;
        let encoded = BASE64_STANDARD.encode(bytes);
        if seen.insert(encoded.clone()) {
            output.push(json!({
              "image": {
                "bytesBase64Encoded": encoded,
                "mimeType": mime.unwrap_or_else(|| "image/png".to_string())
              },
              "referenceType": "ASSET"
            }));
        }
    }
    Ok(output)
}

fn normalize_gemini_duration(value: Option<&Value>) -> i64 {
    normalize_video_duration(value).clamp(4, 8)
}

fn normalize_gemini_resolution(value: Option<&Value>) -> String {
    let raw = value
        .and_then(Value::as_str)
        .unwrap_or("720p")
        .trim()
        .to_ascii_lowercase();
    if raw.contains("1080") {
        "1080p".to_string()
    } else {
        "720p".to_string()
    }
}

async fn build_gemini_video_request(
    state: &BackendState,
    config: &Value,
) -> Result<Value, ApiError> {
    let prompt = json_string(config.get("prompt"), "");
    let mut instance = serde_json::Map::new();
    instance.insert("prompt".to_string(), json!(prompt));
    if let Some(image) = normalize_gemini_image_input(
        state,
        config.get("imageUrl").or_else(|| config.get("firstFrame")),
    )
    .await?
    {
        instance.insert("image".to_string(), image);
    }

    let mut parameters = serde_json::Map::new();
    parameters.insert("sampleCount".to_string(), json!(1));
    parameters.insert(
        "durationSeconds".to_string(),
        json!(normalize_gemini_duration(config.get("duration"))),
    );
    parameters.insert(
        "aspectRatio".to_string(),
        json!(json_string(config.get("aspectRatio"), "16:9")),
    );
    parameters.insert(
        "resolution".to_string(),
        json!(normalize_gemini_resolution(config.get("resolution"))),
    );
    if let Some(last_frame) = normalize_gemini_image_input(state, config.get("lastFrame")).await? {
        instance.insert("lastFrame".to_string(), last_frame);
        parameters.insert("durationSeconds".to_string(), json!(8));
    }
    let reference_images = normalize_gemini_reference_images(state, config).await?;
    if !reference_images.is_empty() {
        instance.insert(
            "referenceImages".to_string(),
            Value::Array(reference_images),
        );
        // SDK falls back when Fast rejects referenceImages; keep request literal and let upstream decide.
    }

    Ok(json!({
      "instances": [Value::Object(instance)],
      "parameters": Value::Object(parameters)
    }))
}

fn parse_gemini_operation_name(payload: &Value) -> Option<String> {
    payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_gemini_operation_done(payload: &Value) -> bool {
    payload
        .get("done")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn parse_gemini_operation_error(payload: &Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|error| error.get("message").or_else(|| error.get("code")))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| Some(value.to_string()))
        })
}

fn parse_gemini_video_source(payload: &Value) -> Option<(String, Option<String>, bool)> {
    let response = payload
        .get("response")
        .and_then(|response| response.get("generateVideoResponse"))
        .or_else(|| payload.get("response"))?;
    let samples = response
        .get("generatedSamples")
        .or_else(|| response.get("generatedVideos"))
        .and_then(Value::as_array)?;
    let video = samples
        .first()
        .and_then(|sample| sample.get("video").or(Some(sample)))?;
    if let Some(uri) = video
        .get("uri")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some((uri.to_string(), None, true));
    }
    if let Some(encoded) = video
        .get("encodedVideo")
        .or_else(|| video.get("videoBytes"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let mime = video
            .get("encoding")
            .or_else(|| video.get("mimeType"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Some("video/mp4".to_string()));
        return Some((encoded.to_string(), mime, false));
    }
    None
}

async fn submit_gemini_video_task(
    state: &BackendState,
    model_id: &str,
    config: &Value,
) -> Result<(String, Value), String> {
    let _log_started_at = Utc::now().timestamp_millis();
    let conn = db_connection(state).map_err(|error| error.message)?;
    let api_key = provider_sync_api_keys("gemini", &load_provider_creds(&conn))
        .into_iter()
        .next()
        .ok_or_else(|| {
            llm_dev_log!(
                "error",
                "gemini",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => "未配置 Gemini API Key，请在设置中配置"
            );
            "未配置 Gemini API Key，请在设置中配置".to_string()
        })?;
    let base_url = gemini_api_base_url();
    let request_body = build_gemini_video_request(state, config)
        .await
        .map_err(|error| {
            llm_dev_log!(
                "error",
                "gemini",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => error.message.as_str()
            );
            error.message
        })?;
    let endpoint = gemini_predict_long_running_endpoint(&base_url, model_id);

    llm_dev_log!(
        "request",
        "gemini",
        model_id,
        "generateVideo",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(&json_string(config.get("prompt"), ""), 220),
        "duration" => normalize_video_duration(config.get("duration"))
    );

    let response = llm_http_client()
        .post(&endpoint)
        .query(&[("key", api_key.as_str())])
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            llm_dev_log!(
                "error",
                "gemini",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message.as_str()
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "gemini",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "status" => status.as_u16(),
            "error" => message.as_str()
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Gemini 视频任务响应失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateVideo",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        llm_dev_log!(
            "error",
            "gemini",
            model_id,
            "generateVideo",
            Some(Utc::now().timestamp_millis() - _log_started_at),
            "error" => message.as_str()
        );
        message
    })?;
    let operation_name = match parse_gemini_operation_name(&payload) {
        Some(name) => name,
        None => {
            let message = "Gemini 未返回 operation name";
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(message),
            );
            llm_dev_log!(
                "error",
                "gemini",
                model_id,
                "generateVideo",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => message
            );
            return Err(message.to_string());
        }
    };
    llm_dev_log!(
        "task",
        "gemini",
        model_id,
        "generateVideo",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "status" => status.as_u16(),
        "operationName" => operation_name.as_str()
    );
    llm_dev_write_db_log(
        "gemini",
        model_id,
        "generateVideo",
        "task",
        _log_started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&json!({ "operationName": operation_name.as_str() })),
        Some(body_text.as_str()),
        None,
    );
    Ok((operation_name, request_body))
}

async fn poll_gemini_video_task<F>(
    state: &BackendState,
    model_id: &str,
    operation_name: &str,
    mut on_progress: F,
) -> Result<Value, String>
where
    F: FnMut(i64),
{
    let conn = db_connection(state).map_err(|error| error.message)?;
    let api_key = provider_sync_api_keys("gemini", &load_provider_creds(&conn))
        .into_iter()
        .next()
        .ok_or_else(|| "未配置 Gemini API Key，请在设置中配置".to_string())?;
    let base_url = gemini_api_base_url();
    let started_at = Utc::now().timestamp_millis();
    let progress_window_ms = 3 * 60 * 1000i64;
    let endpoint = gemini_operation_endpoint(&base_url, operation_name);
    let request_body = json!({ "operationName": operation_name });
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let elapsed = Utc::now().timestamp_millis() - started_at;
        let progress = 30 + ((elapsed as f64 / progress_window_ms as f64) * 60.0).round() as i64;
        on_progress(progress.clamp(30, 90));
        let response = llm_http_client()
            .get(&endpoint)
            .query(&[("key", api_key.as_str())])
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "gemini",
                    model_id,
                    "generateVideo",
                    "error",
                    started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                message
            })?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            return Err(message);
        }
        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Gemini 视频状态失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(error) = parse_gemini_operation_error(&payload) {
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                Some(error.as_str()),
            );
            return Err(error);
        }
        if parse_gemini_operation_done(&payload) {
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "success",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&payload),
                Some(body_text.as_str()),
                None,
            );
            return Ok(payload);
        }
    }
}

async fn query_gemini_video_task(
    state: &BackendState,
    model_id: Option<&str>,
    operation_name: &str,
) -> Result<Value, String> {
    let model_id = model_id.unwrap_or("").trim();
    let started_at = Utc::now().timestamp_millis();
    let conn = db_connection(state).map_err(|error| error.message)?;
    let api_key = provider_sync_api_keys("gemini", &load_provider_creds(&conn))
        .into_iter()
        .next()
        .ok_or_else(|| "未配置 Gemini API Key，请在设置中配置".to_string())?;
    let base_url = gemini_api_base_url();
    let endpoint = gemini_operation_endpoint(&base_url, operation_name);
    let request_body = json!({ "operationName": operation_name });
    let response = llm_http_client()
        .get(&endpoint)
        .query(&[("key", api_key.as_str())])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            let message = error.to_string();
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateVideo",
                "error",
                started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                None,
                Some(message.as_str()),
            );
            message
        })?;
    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        let message = error.to_string();
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            None,
            Some(message.as_str()),
        );
        message
    })?;
    if !status.is_success() {
        let message = build_sync_error_message(status, &body_text);
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        return Err(message);
    }
    let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
        let message = format!(
            "解析 Gemini 视频状态失败: {} ({})",
            error,
            truncate_for_error(&body_text, 160)
        );
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateVideo",
            "error",
            started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        message
    })?;
    llm_dev_write_db_log(
        "gemini",
        model_id,
        "generateVideo",
        "status",
        started_at,
        Some(endpoint.as_str()),
        Some(&request_body),
        Some(&payload),
        Some(body_text.as_str()),
        None,
    );
    Ok(payload)
}

async fn persist_gemini_video_source(
    state: &BackendState,
    source: &str,
    mime: Option<&str>,
    is_uri: bool,
    prefix: &str,
) -> Result<String, ApiError> {
    if is_uri {
        match persist_video_source(state, source, prefix).await {
            Ok(url) => return Ok(url),
            Err(first_error) => {
                let api_key = provider_sync_api_keys("gemini", &current_provider_creds())
                    .into_iter()
                    .next();
                if let Some(api_key) = api_key {
                    let separator = if source.contains('?') { '&' } else { '?' };
                    let with_key = format!("{}{}key={}", source, separator, api_key);
                    return persist_video_source(state, &with_key, prefix)
                        .await
                        .or(Err(first_error));
                }
                return Err(first_error);
            }
        }
    }
    let bytes = BASE64_STANDARD
        .decode(source.replace(|c: char| c.is_whitespace(), ""))
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("解码 Gemini 视频失败: {}", error),
            )
        })?;
    persist_video_bytes_async(state, prefix, mime, "mp4", bytes).await
}

async fn run_gemini_video_task_background(
    state: BackendState,
    task_id: String,
    scene_id: String,
    model_id: String,
    config: Value,
) {
    let result = async {
        update_video_task_progress(&state, &task_id, "processing", 10, None, None, None)?;
        let (operation_name, request_body) = submit_gemini_video_task(&state, &model_id, &config)
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        let metadata = json!({
          "provider": "gemini",
          "modelId": model_id,
          "fallback": false,
          "upstreamTask": {
            "provider": "gemini",
            "operationName": operation_name,
            "request": request_body
          }
        });
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            30,
            None,
            None,
            Some(&metadata),
        )?;
        let operation = poll_gemini_video_task(&state, &model_id, &operation_name, |progress| {
            let _ = update_video_task_progress(
                &state,
                &task_id,
                "processing",
                progress,
                None,
                None,
                None,
            );
        })
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
        let (source, mime, is_uri) = parse_gemini_video_source(&operation).ok_or_else(|| {
            ApiError::new(StatusCode::BAD_GATEWAY, "Gemini 视频完成但未返回可用视频")
        })?;
        update_video_task_progress(
            &state,
            &task_id,
            "processing",
            95,
            None,
            None,
            Some(&metadata),
        )?;
        let local_video_url = persist_gemini_video_source(
            &state,
            &source,
            mime.as_deref(),
            is_uri,
            &format!("video_{}", scene_id),
        )
        .await?;
        let last_frame = sync_scene_video_result(&state, &scene_id, &local_video_url)?;
        let completed_metadata = json!({
          "provider": "gemini",
          "modelId": model_id,
          "fallback": false,
          "lastFrame": last_frame,
          "remoteVideoUrl": if is_uri { Value::String(source) } else { Value::Null },
          "upstreamTask": {
            "provider": "gemini",
            "operationName": operation_name
          }
        });
        persist_generated_video_record(
            &state,
            &task_id,
            &scene_id,
            &local_video_url,
            &completed_metadata,
        )?;
        update_video_task_progress(
            &state,
            &task_id,
            "completed",
            100,
            None,
            Some(&local_video_url),
            Some(&completed_metadata),
        )?;
        Ok::<(), ApiError>(())
    }
    .await;

    if let Err(error) = result {
        let _ = update_video_task_progress(
            &state,
            &task_id,
            "failed",
            100,
            Some(&error.message),
            None,
            None,
        );
    }
}

pub(super) async fn api_test(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    let prompt = query
        .get("prompt")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if prompt.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请通过 query 参数传入 prompt，例如 /api/test?prompt=hello",
        ));
    }

    let conn = db_connection(&state)?;
    let creds = load_provider_creds(&conn);
    let model_id = resolve_runtime_workflow_model_id(&conn, "script_parsing")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    if infer_model_provider(&model_id).as_deref() != Some("gemini") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "当前分集目录规划与剧本解析模型不是 Gemini，请先在设置中选择 Gemini 文本模型",
        ));
    }
    let response = request_gemini_text_completion(&model_id, &prompt, &creds)
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("Gemini API 连接失败: {}", error),
            )
        })?;

    Ok(Json(json!({
      "success": true,
      "message": "Gemini API 连接成功",
      "response": response,
      "model": model_id,
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "timestamp": now_iso()
    })))
}

fn infer_model_provider(model_id: &str) -> Option<String> {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("qwen") || normalized.contains("wan") {
        return Some("qwen".to_string());
    }
    if normalized.contains("doubao") || normalized.contains("seed") {
        return Some("volcengine".to_string());
    }
    if normalized.contains("deepseek") {
        return Some("deepseek".to_string());
    }
    if normalized.contains("gemini") {
        return Some("gemini".to_string());
    }
    if normalized.contains("kling") {
        return Some("kling".to_string());
    }
    if normalized.contains("gpt") || normalized.contains("openai") || normalized.contains("claude")
    {
        return Some("custom_openai".to_string());
    }
    None
}

fn infer_model_provider_required(model_id: &str) -> Result<String, ApiError> {
    infer_model_provider(model_id).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("无法识别模型提供商: {}", model_id.trim()),
        )
    })
}

fn infer_model_provider_required_string(model_id: &str) -> Result<String, String> {
    infer_model_provider(model_id).ok_or_else(|| format!("无法识别模型提供商: {}", model_id.trim()))
}

/// 判断模型是否属于已配置的「自定义 OpenAI」供应商（按其配置的模型列表精确匹配）。
fn is_custom_openai_model(model_id: &str, creds: &Value) -> bool {
    let target = model_id.trim();
    if target.is_empty() {
        return false;
    }
    let Some(custom) = creds.get("custom_openai") else {
        return false;
    };
    ["textModels", "availableTextModels"]
        .iter()
        .filter_map(|key| custom.get(*key))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_str)
        .any(|candidate| candidate.trim() == target)
}

/// 解析模型对应的供应商：优先按「自定义 OpenAI」已配置模型精确匹配，再回退到按模型名
/// 关键字推断。修复自定义 OpenAI 模型在工作流里被误判为内置供应商（调用错误端点 → 502）。
fn resolve_model_provider(model_id: &str, creds: &Value) -> Option<String> {
    if is_custom_openai_model(model_id, creds) {
        return Some("custom_openai".to_string());
    }
    infer_model_provider(model_id)
}

fn resolve_model_provider_required_string(model_id: &str, creds: &Value) -> Result<String, String> {
    resolve_model_provider(model_id, creds)
        .ok_or_else(|| format!("无法识别模型提供商: {}", model_id.trim()))
}

fn model_type_to_operation(model_type: &str) -> &'static str {
    match model_type {
        "text" => "generateText",
        "image" => "generateImage",
        "video" => "generateVideo",
        "tts" => "textToSpeech",
        _ => "generateText",
    }
}

fn validate_models_test_payload(body: &Value) -> Result<(), ApiError> {
    if !body.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "请求体必须是对象"));
    }
    if let Some(model_type) = body.get("modelType").filter(|value| !value.is_null()) {
        let raw = model_type
            .as_str()
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "modelType 必须是字符串"))?;
        if !matches!(raw, "text" | "image" | "video" | "tts") {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "modelType 必须是 text、image、video 或 tts",
            ));
        }
    }
    for key in [
        "modelId",
        "provider",
        "prompt",
        "imageAspectRatio",
        "imageQuality",
    ] {
        if let Some(value) = body.get(key).filter(|value| !value.is_null()) {
            if !value.is_string() {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("{key} 必须是字符串"),
                ));
            }
        }
    }
    if let Some(value) = body.get("referenceImages").filter(|value| !value.is_null()) {
        let items = value
            .as_array()
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "referenceImages 必须是数组"))?;
        for (index, item) in items.iter().enumerate() {
            if !item.is_string() {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("referenceImages.{index} 必须是字符串"),
                ));
            }
        }
    }
    Ok(())
}

fn models_test_requested_provider(body: &Value) -> Result<Option<String>, ApiError> {
    let Some(provider) = body
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    if !is_supported_provider(provider) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "供应商不存在"));
    }

    Ok(Some(provider.to_string()))
}

fn models_test_reference_images(body: &Value) -> Vec<String> {
    body.get("referenceImages")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn models_test_sanitized_payload(body: &Value) -> Value {
    let mut payload = serde_json::Map::new();
    for key in [
        "modelType",
        "modelId",
        "provider",
        "prompt",
        "imageAspectRatio",
        "imageQuality",
        "referenceImages",
    ] {
        if let Some(value) = body.get(key) {
            payload.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(payload)
}

fn models_test_prompt_error(model_type: &str) -> &'static str {
    if model_type == "tts" {
        "请在请求体中提供 prompt 作为 TTS 测试文本"
    } else {
        "请在请求体中提供 prompt"
    }
}

fn models_test_model_type_label(model_type: &str) -> &'static str {
    match model_type {
        "text" => "文本",
        "image" => "图片",
        "video" => "视频",
        "tts" => "语音",
        _ => "模型",
    }
}

fn models_test_selected_model_key(model_type: &str) -> &str {
    match model_type {
        "tts" => "tts",
        _ => model_type,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_model_provider_handles_claude_as_custom_openai() {
        assert_eq!(
            infer_model_provider("claude-sonnet-4-5").as_deref(),
            Some("custom_openai")
        );
    }

    #[test]
    fn scene_video_references_flatten_into_flat_provider_keys() {
        // Regression guard: the asset workbench sends references nested under
        // `config.references`, but provider request builders only read the flat
        // `imageUrl` / `firstFrame` / `referenceImages` keys. Without flattening,
        // scene videos are generated with no image references at all.
        let provider = "custom_openai";
        let model_id = "doubao-seedance-2-0-260128";
        let (kind, caps) = build_available_model_entry(provider, model_id);
        assert_eq!(kind, AvailableModelKind::Video);
        let supports_image_to_video = caps
            .get("supportImageToVideo")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let supports_reference_images = caps
            .get("supportReferenceImages")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let mut config = json!({
          "references": {
            "environmentImage": "env-image",
            "characterImage": "char-image-1",
            "characterImages": ["char-image-1", "char-image-2"],
            "characterAssets": [{ "image": "char-image-2" }]
          }
        });
        let scene = json!({ "description": "一个安静的空房间", "narration": "" });
        apply_scene_video_reference_inputs(&mut config, &scene, provider, model_id);

        let primary_image = config.get("imageUrl").and_then(Value::as_str);
        let reference_images = config
            .get("referenceImages")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        // The core invariant the regression broke: references must reach a flat key.
        assert!(
            primary_image.is_some_and(|value| !value.is_empty()) || !reference_images.is_empty(),
            "expected references to populate imageUrl or referenceImages"
        );
        if supports_image_to_video {
            assert_eq!(primary_image, Some("env-image"));
        }
        if supports_reference_images {
            assert!(reference_images.contains(&"env-image".to_string()));
            assert!(reference_images.contains(&"char-image-1".to_string()));
        }
    }

    #[test]
    fn scene_video_references_inject_narration_voice_without_dialogue() {
        let mut config = json!({
          "references": {
            "environmentImage": "env-image",
            "narrationVoiceAsset": { "audioUrl": "narration-voice-url" }
          }
        });
        let scene = json!({ "description": "镜头缓缓推进", "narration": "夜色渐深" });
        apply_scene_video_reference_inputs(&mut config, &scene, "qwen", "wan2.7-i2v");
        assert_eq!(
            config.get("audioUrl").and_then(Value::as_str),
            Some("narration-voice-url")
        );
    }

    #[test]
    fn scene_video_reference_materials_use_seedance_image_numbers_in_request_order() {
        let mut config = json!({
          "references": {
            "environmentImage": "env-url",
            "environmentAsset": {
              "name": "老街路口",
              "type": "environment",
              "image": "env-url"
            },
            "characterImages": ["char-url"],
            "characterAssets": [
              { "name": "陈泽", "type": "character", "image": "char-url" },
              { "name": "白色大卡车", "type": "prop", "image": "truck-url" }
            ],
            "narrationVoiceAsset": {
              "name": "旁白音色",
              "type": "other",
              "audioUrl": "voice-url"
            }
          }
        });
        let scene = json!({ "description": "镜头缓缓推进", "narration": "夜色渐深" });
        let provider = "volcengine";
        let model_id = "doubao-seedance-2-0-260128";
        apply_scene_video_reference_inputs(&mut config, &scene, provider, model_id);

        assert_eq!(
            scene_video_visual_reference_labels(&config),
            vec![
                "环境参考（老街路口）".to_string(),
                "角色参考（陈泽）".to_string(),
                "道具参考（白色大卡车）".to_string(),
            ]
        );
        let materials = build_scene_video_reference_materials(&config);
        assert!(materials.contains("- 图片1：环境参考（老街路口）"));
        assert!(materials.contains("- 图片2：角色参考（陈泽）"));
        assert!(materials.contains("- 图片3：道具参考（白色大卡车）"));
        assert!(materials.contains("- 音频1：旁白音色参考（旁白音色）"));

        let request = build_volcengine_video_request(model_id, &config);
        let image_urls = request
            .get("content")
            .and_then(Value::as_array)
            .expect("volcengine content array")
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("image_url"))
            .filter_map(|item| {
                item.get("image_url")
                    .and_then(|value| value.get("url"))
                    .and_then(Value::as_str)
            })
            .collect::<Vec<_>>();
        assert_eq!(image_urls, vec!["env-url", "char-url", "truck-url"]);
    }

    #[test]
    fn scene_video_prompt_binds_reference_numbers_to_scene_subjects() {
        let mut config = json!({
          "references": {
            "environmentImage": "env-url",
            "environmentAsset": {
              "name": "现代都市·老街路口 / 傍晚",
              "type": "environment",
              "image": "env-url"
            },
            "characterAssets": [
              { "name": "陈泽", "type": "character", "image": "char-url" },
              { "name": "烧烤三轮车", "type": "prop", "image": "cart-url" }
            ]
          }
        });
        let scene = json!({ "description": "镜头缓缓推进", "narration": "夜色渐深" });
        let provider = "volcengine";
        let model_id = "doubao-seedance-2-0-260128";
        apply_scene_video_reference_inputs(&mut config, &scene, provider, model_id);

        let description = "0-2秒：全景，固定镜头。现代都市·老街路口被夕阳斜射。\n2-5秒：中景，跟随镜头。陈泽骑着烧烤三轮车驶入，陈泽抬头。";
        let bound = bind_scene_video_reference_numbers_to_text(description, &config);

        assert!(bound.contains("现代都市·老街路口（图片1）"));
        assert!(bound.contains("陈泽（图片2）骑着烧烤三轮车（图片3）"));
        assert!(bound.contains("陈泽（图片2）抬头"));
        assert!(!bound.contains("陈泽（图片2）（图片2）"));
    }

    #[test]
    fn seedance_workflow_resolution_applies_and_fast_1080p_falls_back() {
        let workflow_model_options = json!({
          "video_generation": {
            "seedance": { "quality": "1080p" }
          }
        });

        let mut fast_config = json!({});
        apply_workflow_video_generation_options(
            &mut fast_config,
            &workflow_model_options,
            "volcengine",
            "doubao-seedance-2-0-fast-260128",
        );
        assert_eq!(
            fast_config.get("resolution").and_then(Value::as_str),
            Some("720p")
        );

        let mut standard_config = json!({});
        apply_workflow_video_generation_options(
            &mut standard_config,
            &workflow_model_options,
            "volcengine",
            "doubao-seedance-2-0-260128",
        );
        assert_eq!(
            standard_config.get("resolution").and_then(Value::as_str),
            Some("1080p")
        );

        let request = build_volcengine_video_request(
            "doubao-seedance-2-0-fast-260128",
            &json!({ "prompt": "生成视频", "resolution": "1080p" }),
        );
        assert_eq!(
            request.get("resolution").and_then(Value::as_str),
            Some("720p")
        );
    }

    #[test]
    fn build_episode_plan_normalizes_model_asset_variants() {
        let text = "苏晚拖着行李走进林家别墅，婆婆冷眼看着她。夜晚，苏晚在医院走廊拿出玉佩。第二天，陆霆出现撑腰。";
        let output = json!({
          "episodes": [
            {
              "title": "第1集",
              "episodeAssets": {
                "角色": [{ "姓名": "苏晚", "描述": "被迫嫁入豪门的女主", "性别": "female" }],
                "道具": ["玉佩"],
                "环境": ["林家别墅/白天/压抑豪门"]
              }
            },
            {
              "title": "第2集",
              "startAnchor": "第二天，陆霆出现撑腰",
              "assets": {
                "characters": ["陆霆"],
                "props": [{ "道具名": "合同", "描述": "反击用的关键合同" }],
                "environments": [{ "地点": "公司会议室", "时间": "白天", "氛围": "紧张对峙" }]
              }
            }
          ]
        });

        let episodes = build_episode_plan_from_model_output(text, output);

        assert_eq!(episodes.len(), 2);
        assert_eq!(
            episodes[0]["episodeAssets"]["characters"][0]["name"],
            json!("苏晚")
        );
        assert_eq!(
            episodes[0]["episodeAssets"]["props"][0]["name"],
            json!("玉佩")
        );
        assert_eq!(
            episodes[0]["episodeAssets"]["environments"][0]["location"],
            json!("林家别墅")
        );
        assert_eq!(
            episodes[0]["episodeAssets"]["environments"][0]["timeOfDay"],
            json!("白天")
        );
        assert_eq!(
            episodes[1]["episodeAssets"]["characters"][0]["name"],
            json!("陆霆")
        );
        assert_eq!(
            episodes[1]["episodeAssets"]["environments"][0]["location"],
            json!("公司会议室")
        );
    }

    #[test]
    fn models_test_requested_provider_accepts_supported_provider() {
        let payload = json!({ "provider": " custom_openai " });

        assert_eq!(
            models_test_requested_provider(&payload).unwrap(),
            Some("custom_openai".to_string())
        );
    }

    #[test]
    fn models_test_requested_provider_rejects_unknown_provider() {
        let payload = json!({ "provider": "anthropic" });
        let error = models_test_requested_provider(&payload).unwrap_err();

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.message, "供应商不存在");
    }

    #[test]
    fn parse_openai_compatible_text_response_handles_json_message() {
        let body = r#"{"choices":[{"message":{"content":"Hello from JSON"}}]}"#;

        assert_eq!(
            parse_openai_compatible_text_response(body).unwrap(),
            Some("Hello from JSON".to_string())
        );
    }

    #[test]
    fn parse_openai_compatible_text_response_handles_sse_chunks() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n",
            "data: [DONE]\n\n"
        );

        assert_eq!(
            parse_openai_compatible_text_response(body).unwrap(),
            Some("Hello world".to_string())
        );
    }

    #[test]
    fn parse_openai_compatible_text_response_handles_sse_chunks_without_blank_lines() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n",
            "data: [DONE]\n"
        );

        assert_eq!(
            parse_openai_compatible_text_response(body).unwrap(),
            Some("Hello world".to_string())
        );
    }
}

fn normalize_image_aspect_ratio(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "1:1".to_string();
    };
    let normalized = value.replace(char::is_whitespace, "").to_ascii_lowercase();
    if normalized == "auto" {
        return "auto".to_string();
    }
    let Some((width, height)) = normalized.split_once(':') else {
        return "1:1".to_string();
    };
    let Ok(width) = width.parse::<f64>() else {
        return "1:1".to_string();
    };
    let Ok(height) = height.parse::<f64>() else {
        return "1:1".to_string();
    };
    if width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0 {
        normalized
    } else {
        "1:1".to_string()
    }
}

fn image_size_for_table<'a>(
    aspect_ratio: &str,
    table: &'a [(&str, &str)],
    fallback: &'a str,
) -> String {
    table
        .iter()
        .find_map(|(ratio, size)| (*ratio == aspect_ratio).then_some(*size))
        .unwrap_or(fallback)
        .to_string()
}

#[derive(Clone, Debug)]
struct PanoramaSourceProfile {
    mode: String,
    mode_label: String,
    aspect_ratio: String,
    size: String,
    fallback_applied: bool,
}

const PANORAMA_ASPECT_RATIO_TOLERANCE: f64 = 0.03;

fn normalize_panorama_aspect_ratio(value: Option<&str>) -> Option<String> {
    let normalized = value?.replace(char::is_whitespace, "");
    let (width_raw, height_raw) = normalized.split_once(':')?;
    let width = width_raw.parse::<u32>().ok()?;
    let height = height_raw.parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    Some(format!("{}:{}", width, height))
}

fn normalize_panorama_image_size(value: Option<&str>) -> Option<String> {
    let normalized = value?
        .replace(char::is_whitespace, "")
        .replace('x', "*")
        .replace('X', "*");
    let (width_raw, height_raw) = normalized.split_once('*')?;
    let width = width_raw.parse::<u32>().ok()?;
    let height = height_raw.parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    Some(format!("{}*{}", width, height))
}

fn panorama_size_for_aspect_ratio(aspect_ratio: &str) -> String {
    match aspect_ratio {
        "1:1" => "1024*1024",
        "2:1" => "2048*1024",
        "2:3" => "832*1248",
        "3:2" => "1248*832",
        "3:4" => "864*1152",
        "4:3" => "1152*864",
        "6:1" => "3072*512",
        "9:16" => "720*1280",
        "16:9" => "1280*720",
        "21:9" => "1536*640",
        _ => "2048*1024",
    }
    .to_string()
}

fn panorama_target_from_options(options: &Value) -> (String, String, String, String) {
    let image_options = options.get("image_options").unwrap_or(options);
    let mode = image_options
        .get("panoramaSourceMode")
        .and_then(Value::as_str)
        .unwrap_or("equirectangular_360");

    match mode {
        "equirectangular_180" => (
            mode.to_string(),
            "180 半球等距全景图".to_string(),
            "1:1".to_string(),
            "1536*1536".to_string(),
        ),
        "cubemap_3x2" => (
            mode.to_string(),
            "Cubemap 3x2 展开图".to_string(),
            "3:2".to_string(),
            "1536*1024".to_string(),
        ),
        "cubemap_6x1" => (
            mode.to_string(),
            "Cubemap 6x1 横向展开图".to_string(),
            "6:1".to_string(),
            "3072*512".to_string(),
        ),
        "custom" => {
            let aspect_ratio = normalize_panorama_aspect_ratio(
                image_options
                    .get("panoramaCustomAspectRatio")
                    .and_then(Value::as_str),
            )
            .unwrap_or_else(|| "2:1".to_string());
            let size = normalize_panorama_image_size(
                image_options
                    .get("panoramaCustomSize")
                    .and_then(Value::as_str),
            )
            .unwrap_or_else(|| panorama_size_for_aspect_ratio(&aspect_ratio));
            (
                mode.to_string(),
                "自定义环境源图".to_string(),
                aspect_ratio,
                size,
            )
        }
        _ => (
            "equirectangular_360".to_string(),
            "360 等距柱状全景图".to_string(),
            "2:1".to_string(),
            "2048*1024".to_string(),
        ),
    }
}

fn parse_size_constraint_ratio(value: Option<&Value>) -> Option<f64> {
    let text = value?.as_str()?.trim();
    parse_panorama_aspect_ratio_value(text)
}

fn model_size_constraints_support_panorama_source(
    size_constraints: &Value,
    aspect_ratio: &str,
    size: &str,
) -> Option<bool> {
    let (width, height) = parse_image_dimensions(size)?;
    let aspect_ratio_value = parse_panorama_aspect_ratio_value(aspect_ratio)?;
    let max_edge = size_constraints
        .get("maxEdge")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let edge_multiple = size_constraints
        .get("edgeMultiple")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .filter(|value| *value > 0);
    let min_pixels = size_constraints.get("minPixels").and_then(Value::as_u64);
    let max_pixels = size_constraints.get("maxPixels").and_then(Value::as_u64);
    let max_aspect_ratio = parse_size_constraint_ratio(size_constraints.get("maxAspectRatio"));
    let pixels = u64::from(width) * u64::from(height);
    let actual_ratio = f64::from(width.max(height)) / f64::from(width.min(height));

    if let Some(max_edge) = max_edge {
        if width > max_edge || height > max_edge {
            return Some(false);
        }
    }
    if let Some(edge_multiple) = edge_multiple {
        if width % edge_multiple != 0 || height % edge_multiple != 0 {
            return Some(false);
        }
    }
    if let Some(min_pixels) = min_pixels {
        if pixels < min_pixels {
            return Some(false);
        }
    }
    if let Some(max_pixels) = max_pixels {
        if pixels > max_pixels {
            return Some(false);
        }
    }
    if let Some(max_aspect_ratio) = max_aspect_ratio {
        if actual_ratio - max_aspect_ratio > PANORAMA_ASPECT_RATIO_TOLERANCE {
            return Some(false);
        }
    }

    let size_ratio = f64::from(width) / f64::from(height);
    Some((size_ratio - aspect_ratio_value).abs() <= PANORAMA_ASPECT_RATIO_TOLERANCE)
}

fn model_supports_panorama_source(
    model_config: Option<&Value>,
    aspect_ratio: &str,
    size: &str,
) -> bool {
    let Some(config) = model_config else {
        return true;
    };
    if let Some(result) = config.get("sizeConstraints").and_then(|constraints| {
        model_size_constraints_support_panorama_source(constraints, aspect_ratio, size)
    }) {
        return result;
    }

    let ratios = config
        .get("supportedAspectRatios")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|item| normalize_panorama_aspect_ratio(Some(item)))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    ratios.is_empty() || ratios.contains(aspect_ratio)
}

fn resolve_panorama_source_profile(
    options: &Value,
    model_config: Option<&Value>,
) -> PanoramaSourceProfile {
    let (mode, mode_label, aspect_ratio, size) = panorama_target_from_options(options);
    let fallback_applied = !model_supports_panorama_source(model_config, &aspect_ratio, &size);
    PanoramaSourceProfile {
        mode,
        mode_label,
        aspect_ratio,
        size,
        fallback_applied,
    }
}

fn panorama_source_prompt_instruction(mode: &str) -> &'static str {
    match mode {
        "equirectangular_180" => {
            "必须是 180 半球等距全景源图，不是普通单方向透视照片；水平视野覆盖半球空间，边缘保留可裁切环境信息。"
        }
        "cubemap_3x2" => {
            "必须是 Cubemap 3x2 展开源图：六个等尺寸正方形面组成 3 列 x 2 行，面与面之间空间关系连续，不要做成普通拼图或分镜。"
        }
        "cubemap_6x1" => {
            "必须是 Cubemap 6x1 横排源图：六个等尺寸正方形面横向排列，前后左右上下六面空间连续，不要做成普通拼图或分镜。"
        }
        "custom" => {
            "必须严格符合环境源图画幅和尺寸，不要生成普通摄影构图；需要保留足够四周环境信息供后续裁切。"
        }
        _ => {
            "必须是标准 360 等距柱状全景贴图（2:1 equirectangular / spherical panorama / HDRI environment map source），左右边缘必须无缝衔接，不是普通宽银幕照片。"
        }
    }
}

fn build_panorama_source_prompt_context(
    source: &PanoramaSourceProfile,
    target_aspect_ratio: &str,
) -> String {
    format!(
        "目标输出画幅：{}\n环境源图格式：{}\n环境源图画幅：{}\n环境源图尺寸：{}\n构图要求：{}",
        target_aspect_ratio,
        source.mode_label,
        source.aspect_ratio,
        source.size,
        panorama_source_prompt_instruction(&source.mode)
    )
}

fn read_be_u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    let data = bytes.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([data[0], data[1]]))
}

fn read_be_u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let data = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([data[0], data[1], data[2], data[3]]))
}

fn read_le_u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    let data = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([data[0], data[1]]))
}

fn read_le_u24_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let data = bytes.get(offset..offset + 3)?;
    Some(u32::from(data[0]) | (u32::from(data[1]) << 8) | (u32::from(data[2]) << 16))
}

fn read_le_u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let data = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([data[0], data[1], data[2], data[3]]))
}

fn read_le_i32_at(bytes: &[u8], offset: usize) -> Option<i32> {
    let data = bytes.get(offset..offset + 4)?;
    Some(i32::from_le_bytes([data[0], data[1], data[2], data[3]]))
}

fn parse_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || bytes.get(0..8)? != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = read_be_u32_at(bytes, 16)?;
    let height = read_be_u32_at(bytes, 20)?;
    (width > 0 && height > 0).then_some((width, height))
}

fn is_jpeg_sof_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn parse_jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut offset = 2usize;
    while offset + 3 < bytes.len() {
        while offset < bytes.len() && bytes[offset] != 0xff {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }

        let marker = bytes[offset];
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }

        let segment_len = usize::from(read_be_u16_at(bytes, offset)?);
        if segment_len < 2 || offset + segment_len > bytes.len() {
            break;
        }

        if is_jpeg_sof_marker(marker) && segment_len >= 7 {
            let height = u32::from(read_be_u16_at(bytes, offset + 3)?);
            let width = u32::from(read_be_u16_at(bytes, offset + 5)?);
            if width > 0 && height > 0 {
                return Some((width, height));
            }
        }

        offset += segment_len;
    }

    None
}

fn parse_gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || (bytes.get(0..6)? != b"GIF87a" && bytes.get(0..6)? != b"GIF89a") {
        return None;
    }
    let width = u32::from(read_le_u16_at(bytes, 6)?);
    let height = u32::from(read_le_u16_at(bytes, 8)?);
    (width > 0 && height > 0).then_some((width, height))
}

fn parse_bmp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 26 || bytes.get(0..2)? != b"BM" {
        return None;
    }
    let width = read_le_i32_at(bytes, 18)?;
    let height = read_le_i32_at(bytes, 22)?;
    let width = width.unsigned_abs();
    let height = height.unsigned_abs();
    (width > 0 && height > 0).then_some((width, height))
}

fn parse_webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || bytes.get(0..4)? != b"RIFF" || bytes.get(8..12)? != b"WEBP" {
        return None;
    }

    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let chunk_type = bytes.get(offset..offset + 4)?;
        let chunk_size = read_le_u32_at(bytes, offset + 4)? as usize;
        let data_offset = offset + 8;
        if data_offset + chunk_size > bytes.len() {
            break;
        }

        if chunk_type == b"VP8X" && chunk_size >= 10 {
            let width = read_le_u24_at(bytes, data_offset + 4)?.saturating_add(1);
            let height = read_le_u24_at(bytes, data_offset + 7)?.saturating_add(1);
            if width > 0 && height > 0 {
                return Some((width, height));
            }
        } else if chunk_type == b"VP8L" && chunk_size >= 5 && bytes[data_offset] == 0x2f {
            let bits = read_le_u32_at(bytes, data_offset + 1)?;
            let width = (bits & 0x3fff).saturating_add(1);
            let height = ((bits >> 14) & 0x3fff).saturating_add(1);
            if width > 0 && height > 0 {
                return Some((width, height));
            }
        } else if chunk_type == b"VP8 " && chunk_size >= 10 {
            let frame = bytes.get(data_offset..data_offset + chunk_size)?;
            if frame.get(3..6) == Some(&b"\x9d\x01\x2a"[..]) {
                let width = u32::from(read_le_u16_at(frame, 6)? & 0x3fff);
                let height = u32::from(read_le_u16_at(frame, 8)? & 0x3fff);
                if width > 0 && height > 0 {
                    return Some((width, height));
                }
            }
        }

        offset = data_offset + chunk_size + (chunk_size % 2);
    }

    None
}

fn parse_image_dimensions_from_bytes(bytes: &[u8]) -> Option<(u32, u32)> {
    parse_png_dimensions(bytes)
        .or_else(|| parse_jpeg_dimensions(bytes))
        .or_else(|| parse_gif_dimensions(bytes))
        .or_else(|| parse_webp_dimensions(bytes))
        .or_else(|| parse_bmp_dimensions(bytes))
}

fn parse_panorama_aspect_ratio_value(value: &str) -> Option<f64> {
    let normalized = normalize_panorama_aspect_ratio(Some(value))?;
    let (width_raw, height_raw) = normalized.split_once(':')?;
    let width = width_raw.parse::<f64>().ok()?;
    let height = height_raw.parse::<f64>().ok()?;
    (width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0)
        .then_some(width / height)
}

async fn assert_generated_environment_image_size(
    state: &BackendState,
    image_url: &str,
    panorama_source: &PanoramaSourceProfile,
) -> Result<(), ApiError> {
    let (bytes, _) = resolve_source_bytes(state, image_url, 35 * 1024 * 1024).await?;
    let (width, height) = parse_image_dimensions_from_bytes(&bytes)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "环境源图尺寸无效，无法检查比例"))?;
    let expected_ratio = parse_panorama_aspect_ratio_value(&panorama_source.aspect_ratio)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "环境源图目标比例无效"))?;
    let actual_ratio = f64::from(width) / f64::from(height);

    if (actual_ratio - expected_ratio).abs() > PANORAMA_ASPECT_RATIO_TOLERANCE {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "环境源图比例不符合 {}（{}），实际尺寸为 {}x{}。请切换支持该比例的图片模型或调整环境源图格式后重试。",
                panorama_source.aspect_ratio, panorama_source.mode_label, width, height
            ),
        ));
    }

    Ok(())
}

fn resolve_image_test_size(model_id: &str, provider: &str, aspect_ratio: &str) -> String {
    let aspect_ratio = if aspect_ratio == "auto" {
        "1:1"
    } else {
        aspect_ratio
    };
    let normalized_model = normalize_model_id_for_remote(model_id).to_ascii_lowercase();

    const GENERIC: &[(&str, &str)] = &[
        ("1:1", "1024*1024"),
        ("2:1", "2048*1024"),
        ("16:9", "1280*720"),
        ("9:16", "720*1280"),
        ("4:3", "1152*864"),
        ("3:4", "864*1152"),
        ("3:2", "1248*832"),
        ("2:3", "832*1248"),
        ("21:9", "1344*576"),
    ];
    const QWEN_IMAGE_2: &[(&str, &str)] = &[
        ("16:9", "2688*1536"),
        ("4:3", "2368*1728"),
        ("1:1", "2048*2048"),
        ("3:4", "1728*2368"),
        ("9:16", "1536*2688"),
    ];
    const QWEN_IMAGE_PLUS: &[(&str, &str)] = &[
        ("16:9", "1664*928"),
        ("4:3", "1472*1104"),
        ("1:1", "1328*1328"),
        ("3:4", "1104*1472"),
        ("9:16", "928*1664"),
    ];
    const QWEN_WAN: &[(&str, &str)] = &[
        ("1:1", "1280*1280"),
        ("2:3", "800*1200"),
        ("3:2", "1200*800"),
        ("3:4", "960*1280"),
        ("4:3", "1280*960"),
        ("9:16", "720*1280"),
        ("16:9", "1280*720"),
        ("21:9", "1344*576"),
    ];
    const QWEN_Z: &[(&str, &str)] = &[
        ("1:1", "1280*1280"),
        ("2:3", "1024*1536"),
        ("3:2", "1536*1024"),
        ("3:4", "1104*1472"),
        ("4:3", "1472*1104"),
        ("9:16", "864*1536"),
        ("16:9", "1536*864"),
        ("21:9", "1680*720"),
    ];
    const VOLCENGINE: &[(&str, &str)] = &[
        ("1:1", "2048*2048"),
        ("4:3", "2304*1728"),
        ("3:4", "1728*2304"),
        ("16:9", "2848*1600"),
        ("9:16", "1600*2848"),
        ("3:2", "2496*1664"),
        ("2:3", "1664*2496"),
        ("21:9", "3136*1344"),
    ];

    if provider == "qwen" {
        if normalized_model == "qwen-image-2.0-pro" || normalized_model == "qwen-image-2.0" {
            return image_size_for_table(aspect_ratio, QWEN_IMAGE_2, "2048*2048");
        }
        if normalized_model == "qwen-image-max"
            || normalized_model == "qwen-image"
            || normalized_model == "qwen-image-plus"
        {
            return image_size_for_table(aspect_ratio, QWEN_IMAGE_PLUS, "1328*1328");
        }
        if normalized_model == "wan2.6-image"
            || normalized_model == "wan2.6-t2i"
            || normalized_model == "wan2.7-image-pro"
            || normalized_model == "wan2.7-image"
        {
            return image_size_for_table(aspect_ratio, QWEN_WAN, "1280*1280");
        }
        if normalized_model == "z-image-turbo" {
            return image_size_for_table(aspect_ratio, QWEN_Z, "1280*1280");
        }
    }
    if provider == "volcengine" {
        return image_size_for_table(aspect_ratio, VOLCENGINE, "2048*2048");
    }
    image_size_for_table(aspect_ratio, GENERIC, "1024*1024")
}

fn normalize_model_id_for_remote(raw: &str) -> String {
    raw.trim().trim_start_matches("models/").trim().to_string()
}

fn provider_chat_completions_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized
        .to_ascii_lowercase()
        .ends_with("/chat/completions")
    {
        normalized.to_string()
    } else {
        format!("{}/chat/completions", normalized)
    }
}

fn provider_gemini_generate_endpoint(base_url: &str, model_id: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    let models_base = if normalized.to_ascii_lowercase().ends_with("/models") {
        normalized.to_string()
    } else {
        format!("{}/models", normalized)
    };
    format!(
        "{}/{}:generateContent",
        models_base,
        normalize_model_id_for_remote(model_id)
    )
}

fn parse_text_content_value(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    let Some(parts) = value.as_array() else {
        return None;
    };

    let mut chunks: Vec<String> = Vec::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                chunks.push(normalized.to_string());
            }
            continue;
        }
        if let Some(text) = part.get("content").and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                chunks.push(normalized.to_string());
            }
        }
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

fn parse_text_delta_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str().filter(|text| !text.trim().is_empty()) {
        return Some(text.to_string());
    }
    let Some(parts) = value.as_array() else {
        return None;
    };

    let mut chunks: Vec<String> = Vec::new();
    for part in parts {
        if let Some(text) = part
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        {
            chunks.push(text.to_string());
            continue;
        }
        if let Some(text) = part
            .get("content")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        {
            chunks.push(text.to_string());
        }
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join(""))
    }
}

fn parse_openai_compatible_text_result(payload: &Value) -> Option<String> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())?;

    if let Some(content) = choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(parse_text_content_value)
    {
        return Some(content);
    }

    if let Some(content) = choice
        .get("message")
        .and_then(|message| message.get("reasoning_content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(content.to_string());
    }

    choice
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn parse_openai_compatible_text_delta(payload: &Value) -> Option<String> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())?;

    if let Some(content) = choice
        .get("delta")
        .and_then(|delta| delta.get("content"))
        .and_then(parse_text_delta_value)
    {
        return Some(content);
    }

    choice
        .get("delta")
        .and_then(|delta| delta.get("reasoning_content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn push_openai_compatible_sse_text(raw_event: &str, chunks: &mut Vec<String>) {
    let data = raw_event.trim();
    if data.is_empty() || data == "[DONE]" {
        return;
    }

    let Ok(payload) = serde_json::from_str::<Value>(data) else {
        return;
    };
    if let Some(text) = parse_openai_compatible_text_delta(&payload)
        .or_else(|| parse_openai_compatible_text_result(&payload))
    {
        chunks.push(text);
    }
}

fn parse_openai_compatible_text_sse_result(body_text: &str) -> Option<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut event_data = String::new();

    for line in body_text.lines() {
        let normalized = line.trim_end_matches('\r').trim_start();
        if normalized.is_empty() {
            push_openai_compatible_sse_text(&event_data, &mut chunks);
            event_data.clear();
            continue;
        }

        let Some(data) = normalized.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim_start();
        if !event_data.is_empty() && (data.starts_with('{') || data == "[DONE]") {
            push_openai_compatible_sse_text(&event_data, &mut chunks);
            event_data.clear();
        }
        if !event_data.is_empty() {
            event_data.push('\n');
        }
        event_data.push_str(data);
    }

    push_openai_compatible_sse_text(&event_data, &mut chunks);

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join(""))
    }
}

fn parse_openai_compatible_text_response(body_text: &str) -> Result<Option<String>, String> {
    if body_text
        .lines()
        .any(|line| line.trim_start().starts_with("data:"))
    {
        return Ok(parse_openai_compatible_text_sse_result(body_text));
    }

    let payload = serde_json::from_str::<Value>(body_text).map_err(|error| {
        format!(
            "解析 chat/completions 响应失败: {} ({})",
            error,
            truncate_for_error(body_text, 160)
        )
    })?;
    Ok(parse_openai_compatible_text_result(&payload))
}

fn parse_gemini_text_result(payload: &Value) -> Option<String> {
    let candidate = payload
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())?;
    let parts = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)?;

    let mut chunks: Vec<String> = Vec::new();
    for part in parts {
        if let Some(text) = part
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            chunks.push(text.to_string());
        }
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

async fn request_openai_compatible_text_completion(
    provider: &str,
    model_id: &str,
    prompt: &str,
    creds: &Value,
) -> Result<String, String> {
    let api_keys = provider_sync_api_keys(provider, creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            provider,
            model_id,
            "generateText",
            None::<i64>,
            "error" => "未配置 API Key"
        );
        return Err("未配置 API Key".to_string());
    }
    let base_url =
        provider_sync_base_url(provider, creds).ok_or_else(|| "未配置 Base URL".to_string())?;
    let endpoint = provider_chat_completions_endpoint(&base_url);
    let model = normalize_model_id_for_remote(model_id);
    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        provider,
        model_id,
        "generateText",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let request_body = json!({
          "model": model.as_str(),
          "messages": [
            { "role": "user", "content": prompt }
          ],
          "temperature": 0.7
        });
        let response = llm_http_client()
            .post(&endpoint)
            .bearer_auth(api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    provider,
                    model_id,
                    "generateText",
                    "error",
                    _log_started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    provider,
                    model_id,
                    "generateText",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "error" => message.as_str()
                );
                message
            })?;

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateText",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }

        let parsed = parse_openai_compatible_text_response(&body_text).map_err(|error| {
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateText",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(error.as_str()),
            );
            llm_dev_log!(
                "error",
                provider,
                model_id,
                "generateText",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "error" => error.as_str()
            );
            error
        })?;
        if let Some(text) = parsed {
            let parsed_response = json!({ "text": text });
            llm_dev_write_db_log(
                provider,
                model_id,
                "generateText",
                "success",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                provider,
                model_id,
                "generateText",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "response" => llm_dev_log_preview(&text, 220)
            );
            return Ok(text);
        }
        let message = "模型返回为空文本".to_string();
        llm_dev_write_db_log(
            provider,
            model_id,
            "generateText",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            None,
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "文本模型调用失败".to_string());
    llm_dev_log!(
        "error",
        provider,
        model_id,
        "generateText",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

async fn request_gemini_text_completion(
    model_id: &str,
    prompt: &str,
    creds: &Value,
) -> Result<String, String> {
    let api_keys = provider_sync_api_keys("gemini", creds);
    if api_keys.is_empty() {
        llm_dev_log!(
            "error",
            "gemini",
            model_id,
            "generateText",
            None::<i64>,
            "error" => "未配置 API Key"
        );
        return Err("未配置 API Key".to_string());
    }
    let base_url =
        provider_sync_base_url("gemini", creds).ok_or_else(|| "未配置 Base URL".to_string())?;
    let endpoint = provider_gemini_generate_endpoint(&base_url, model_id);
    let mut last_error = None::<String>;
    let _log_started_at = Utc::now().timestamp_millis();

    llm_dev_log!(
        "request",
        "gemini",
        model_id,
        "generateText",
        None::<i64>,
        "endpoint" => endpoint.as_str(),
        "prompt" => llm_dev_log_preview(prompt, 220),
        "apiKeys" => api_keys.len()
    );

    for api_key in api_keys {
        let request_body = json!({
          "contents": [
            {
              "role": "user",
              "parts": [{ "text": prompt }]
            }
          ]
        });
        let response = llm_http_client()
            .post(&endpoint)
            .query(&[("key", api_key.as_str())])
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                let message = error.to_string();
                llm_dev_write_db_log(
                    "gemini",
                    model_id,
                    "generateText",
                    "error",
                    _log_started_at,
                    Some(endpoint.as_str()),
                    Some(&request_body),
                    None,
                    None,
                    Some(message.as_str()),
                );
                llm_dev_log!(
                    "error",
                    "gemini",
                    model_id,
                    "generateText",
                    Some(Utc::now().timestamp_millis() - _log_started_at),
                    "error" => message.as_str()
                );
                message
            })?;

        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = build_sync_error_message(status, &body_text);
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateText",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            last_error = Some(message);
            continue;
        }

        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            let message = format!(
                "解析 Gemini 响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            );
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateText",
                "error",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                None,
                Some(body_text.as_str()),
                Some(message.as_str()),
            );
            message
        })?;
        if let Some(text) = parse_gemini_text_result(&payload) {
            let parsed_response = json!({ "text": text });
            llm_dev_write_db_log(
                "gemini",
                model_id,
                "generateText",
                "success",
                _log_started_at,
                Some(endpoint.as_str()),
                Some(&request_body),
                Some(&parsed_response),
                Some(body_text.as_str()),
                None,
            );
            llm_dev_log!(
                "success",
                "gemini",
                model_id,
                "generateText",
                Some(Utc::now().timestamp_millis() - _log_started_at),
                "status" => status.as_u16(),
                "response" => llm_dev_log_preview(&text, 220)
            );
            return Ok(text);
        }
        let message = "模型返回为空文本".to_string();
        llm_dev_write_db_log(
            "gemini",
            model_id,
            "generateText",
            "error",
            _log_started_at,
            Some(endpoint.as_str()),
            Some(&request_body),
            Some(&payload),
            Some(body_text.as_str()),
            Some(message.as_str()),
        );
        last_error = Some(message);
    }

    let message = last_error.unwrap_or_else(|| "Gemini 调用失败".to_string());
    llm_dev_log!(
        "error",
        "gemini",
        model_id,
        "generateText",
        Some(Utc::now().timestamp_millis() - _log_started_at),
        "error" => message.as_str()
    );
    Err(message)
}

async fn run_text_model_test_remote(
    provider: &str,
    model_id: &str,
    prompt: &str,
    creds: &Value,
) -> Result<String, String> {
    match provider {
        "qwen" | "volcengine" | "deepseek" | "custom_openai" => {
            request_openai_compatible_text_completion(provider, model_id, prompt, creds).await
        }
        "gemini" => request_gemini_text_completion(model_id, prompt, creds).await,
        _ => Err(format!("供应商 {} 暂不支持文本模型在线测试", provider)),
    }
}

fn text_model_test_error_has_transport_log(provider: &str, error: &str) -> bool {
    matches!(
        provider,
        "qwen" | "volcengine" | "deepseek" | "custom_openai" | "gemini"
    ) && !matches!(error, "未配置 API Key" | "未配置 Base URL")
}

fn collect_log_media_refs(result: &Value) -> Value {
    let mut refs: Vec<Value> = Vec::new();

    if let Some(image_url) = result.get("imageUrl").and_then(Value::as_str) {
        refs.push(json!({
          "id": format!("media_{}", refs.len() + 1),
          "direction": "response",
          "path": "$.result.imageUrl",
          "mediaType": "image",
          "originalLength": image_url.len(),
          "url": image_url,
          "status": "ready"
        }));
    }
    if let Some(video_url) = result.get("videoUrl").and_then(Value::as_str) {
        refs.push(json!({
          "id": format!("media_{}", refs.len() + 1),
          "direction": "response",
          "path": "$.result.videoUrl",
          "mediaType": "video",
          "originalLength": video_url.len(),
          "url": video_url,
          "status": "ready"
        }));
    }
    if let Some(audio_url) = result.get("audioUrl").and_then(Value::as_str) {
        if !audio_url.trim().is_empty() {
            refs.push(json!({
              "id": format!("media_{}", refs.len() + 1),
              "direction": "response",
              "path": "$.result.audioUrl",
              "mediaType": "audio",
              "originalLength": audio_url.len(),
              "url": audio_url,
              "status": "ready"
            }));
        }
    }

    Value::Array(refs)
}

fn write_model_debug_log(
    state: &BackendState,
    provider: &str,
    model: &str,
    operation: &str,
    status: &str,
    duration_ms: i64,
    request: &Value,
    response: Option<&Value>,
    error: Option<&Value>,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let now = now_iso();
    let request_id = current_request_id();
    let context = current_model_log_context();
    let response_value = response.cloned().unwrap_or(Value::Null);
    let media_refs = collect_log_media_refs(&response_value);
    let log_payload = json!({
      "requestId": request_id.clone(),
      "provider": provider,
      "modelId": model,
      "operation": operation,
      "projectId": context.project_id.clone(),
      "sceneId": context.scene_id.clone(),
      "status": status,
      "durationMs": duration_ms.max(1),
      "request": request,
      "response": response_value,
      "error": error.cloned().unwrap_or(Value::Null),
      "errorMessage": error
        .and_then(|value| value.get("message").and_then(Value::as_str))
        .unwrap_or_default(),
      "createdAt": now
    });
    conn.execute(
        "INSERT INTO model_debug_logs (
          id, timestamp, provider, model, operation, status, duration_ms, request_id,
          project_id, scene_id, task_id, request_json, request_raw_json, response_json,
          response_raw_json, media_refs_json, error_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            format!("log_{}", Uuid::new_v4().simple()),
            now,
            provider,
            model,
            operation,
            status,
            duration_ms.max(1),
            request_id,
            context.project_id,
            context.scene_id,
            context.task_id,
            request.to_string(),
            request.to_string(),
            if response.is_some() {
                Some(response_value.to_string())
            } else {
                None::<String>
            },
            if response.is_some() {
                Some(response_value.to_string())
            } else {
                None::<String>
            },
            if media_refs.as_array().is_some_and(|items| !items.is_empty()) {
                Some(media_refs.to_string())
            } else {
                None::<String>
            },
            error.map(Value::to_string),
            now_iso()
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if should_run_log_retention() {
        prune_log_table(&conn, "model_debug_logs", MODEL_DEBUG_LOG_RETENTION_LIMIT);
    }
    cloud_spawn_model_call_log_upload(log_payload);
    Ok(())
}

pub(super) async fn api_models_test(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    validate_models_test_payload(&body)?;
    let model_type = json_string(body.get("modelType"), "text");
    let conn = db_connection(&state)?;
    let selected_models =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    let creds = load_provider_creds(&conn);
    let model_id = body
        .get("modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            selected_model_value(
                &selected_models,
                models_test_selected_model_key(&model_type),
            )
        })
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!(
                    "请先选择{}测试模型",
                    models_test_model_type_label(&model_type)
                ),
            )
        })?;
    let prompt = json_string(body.get("prompt"), "");
    let provider = models_test_requested_provider(&body)?
        .or_else(|| resolve_model_provider(&model_id, &creds))
        .unwrap_or_default();
    if provider.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("无法识别模型提供商: {}", model_id),
        ));
    }
    let operation = model_type_to_operation(&model_type);
    let request_payload = models_test_sanitized_payload(&body);
    let actual_provider = provider.clone();
    let actual_model_id = model_id.clone();

    if prompt.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            models_test_prompt_error(&model_type),
        ));
    }

    let result = match model_type.as_str() {
        "text" => {
            let text = match run_text_model_test_remote(&provider, &model_id, &prompt, &creds).await
            {
                Ok(text) => text,
                Err(error) => {
                    let error_message = error;
                    let error_payload = json!({ "message": error_message.as_str() });
                    if !text_model_test_error_has_transport_log(&provider, &error_message) {
                        let _ = write_model_debug_log(
                            &state,
                            &provider,
                            &model_id,
                            operation,
                            "error",
                            (Utc::now().timestamp_millis() - start).max(1),
                            &request_payload,
                            None,
                            Some(&error_payload),
                        );
                    }
                    return Err(ApiError::new(
                        StatusCode::BAD_GATEWAY,
                        format!("文本模型测试失败: {}", error_message),
                    ));
                }
            };
            json!(text)
        }
        "image" => {
            let aspect_ratio =
                normalize_image_aspect_ratio(body.get("imageAspectRatio").and_then(Value::as_str));
            let size = resolve_image_test_size(&model_id, &provider, &aspect_ratio);
            let reference_images = models_test_reference_images(&body);
            let (source, mime_type) = match provider.as_str() {
                "qwen" => {
                    request_qwen_image_generation(
                        &model_id,
                        &prompt,
                        &size,
                        &reference_images,
                        &creds,
                    )
                    .await
                }
                "volcengine" | "custom_openai" => {
                    request_openai_compatible_image_generation(
                        &provider,
                        &model_id,
                        &prompt,
                        &size,
                        &reference_images,
                        &creds,
                    )
                    .await
                }
                "gemini" => {
                    request_gemini_image_generation(&model_id, &prompt, &reference_images, &creds)
                        .await
                }
                "kling" => {
                    request_kling_image_generation(&model_id, &prompt, &size, &reference_images)
                        .await
                }
                _ => Err(format!("供应商 {} 暂不支持图片模型测试", provider)),
            }
            .map_err(|error| {
                let error_payload = json!({ "message": error });
                let _ = write_model_debug_log(
                    &state,
                    &provider,
                    &model_id,
                    operation,
                    "error",
                    (Utc::now().timestamp_millis() - start).max(1),
                    &request_payload,
                    None,
                    Some(&error_payload),
                );
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "图片模型测试失败: {}",
                        error_payload["message"].as_str().unwrap_or("未知错误")
                    ),
                )
            })?;
            let has_image_data = !(is_http_url(&source) || source.starts_with("data:"));
            let image_url = if is_http_url(&source) || source.starts_with("data:") {
                persist_image_source(&state, &source, "model_test_image").await?
            } else {
                let bytes = BASE64_STANDARD
                    .decode(source.replace(|c: char| c.is_whitespace(), ""))
                    .map_err(|error| {
                        ApiError::new(
                            StatusCode::BAD_GATEWAY,
                            format!("解码图片 base64 失败: {}", error),
                        )
                    })?;
                persist_image_bytes_async(
                    &state,
                    "model_test_image",
                    mime_type.as_deref(),
                    "png",
                    bytes,
                )
                .await?
            };
            json!({
              "imageUrl": image_url,
              "hasImageData": has_image_data,
              "mimeType": mime_type.unwrap_or_else(|| "image/png".to_string()),
              "aspectRatio": aspect_ratio,
              "size": size
            })
        }
        "video" => {
            let task_id = format!("test_{}", Uuid::new_v4().simple());
            let scene_id = format!("model_test_{}", Uuid::new_v4().simple());
            let config = json!({
              "prompt": prompt,
              "duration": 5,
              "aspectRatio": "16:9",
              "resolution": "720P",
              "size": "1280*720",
              "modelId": model_id,
              "provider": provider
            });
            if !matches!(
                provider.as_str(),
                "qwen" | "volcengine" | "kling" | "gemini"
            ) {
                let error_payload =
                    json!({ "message": format!("供应商 {} 暂不支持视频模型测试", provider) });
                let _ = write_model_debug_log(
                    &state,
                    &provider,
                    &model_id,
                    operation,
                    "error",
                    (Utc::now().timestamp_millis() - start).max(1),
                    &request_payload,
                    None,
                    Some(&error_payload),
                );
                return Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    error_payload["message"]
                        .as_str()
                        .unwrap_or("视频模型测试失败"),
                ));
            }
            let context = model_log_context_for_video_task(&state, None, &scene_id, &task_id)?;
            CURRENT_MODEL_LOG_CONTEXT
                .scope(context.clone(), async {
                    insert_pending_video_task(
                        &state,
                        &task_id,
                        &scene_id,
                        &config,
                        &json!({
                          "provider": provider,
                          "modelId": model_id,
                          "fallback": false,
                          "test": true
                        }),
                    )
                })
                .await?;
            if provider == "qwen" {
                spawn_video_task_background(
                    context.clone(),
                    run_qwen_video_task_background(
                        state.clone(),
                        task_id.clone(),
                        scene_id.clone(),
                        model_id.clone(),
                        config.clone(),
                    ),
                );
            } else if provider == "volcengine" {
                spawn_video_task_background(
                    context.clone(),
                    run_volcengine_video_task_background(
                        state.clone(),
                        task_id.clone(),
                        scene_id.clone(),
                        model_id.clone(),
                        config.clone(),
                    ),
                );
            } else if provider == "kling" {
                spawn_video_task_background(
                    context.clone(),
                    run_kling_video_task_background(
                        state.clone(),
                        task_id.clone(),
                        scene_id.clone(),
                        model_id.clone(),
                        config.clone(),
                    ),
                );
            } else {
                spawn_video_task_background(
                    context,
                    run_gemini_video_task_background(
                        state.clone(),
                        task_id.clone(),
                        scene_id.clone(),
                        model_id.clone(),
                        config.clone(),
                    ),
                );
            }
            json!({
              "videoUrl": Value::Null,
              "taskId": task_id,
              "status": "pending"
            })
        }
        "tts" => {
            if provider != "qwen" {
                let error_payload =
                    json!({ "message": format!("供应商 {} 暂不支持 TTS 模型测试", provider) });
                let _ = write_model_debug_log(
                    &state,
                    &provider,
                    &model_id,
                    operation,
                    "error",
                    (Utc::now().timestamp_millis() - start).max(1),
                    &request_payload,
                    None,
                    Some(&error_payload),
                );
                return Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    error_payload["message"]
                        .as_str()
                        .unwrap_or("TTS 模型测试失败"),
                ));
            }
            let (source, mime_type, is_url, upstream_request) =
                match request_qwen_text_to_speech(&model_id, &request_payload).await {
                    Ok(result) => result,
                    Err(error) => {
                        let error_payload = json!({ "message": error });
                        let _ = write_model_debug_log(
                            &state,
                            &provider,
                            &model_id,
                            operation,
                            "error",
                            (Utc::now().timestamp_millis() - start).max(1),
                            &request_payload,
                            None,
                            Some(&error_payload),
                        );
                        return Err(ApiError::new(
                            StatusCode::BAD_GATEWAY,
                            format!(
                                "TTS 模型测试失败: {}",
                                error_payload["message"].as_str().unwrap_or("未知错误")
                            ),
                        ));
                    }
                };
            let audio_url = if is_url {
                persist_audio_source(&state, &source, "model_test_tts").await?
            } else {
                let bytes = BASE64_STANDARD
                    .decode(source.replace(|c: char| c.is_whitespace(), ""))
                    .map_err(|error| {
                        ApiError::new(
                            StatusCode::BAD_GATEWAY,
                            format!("解码音频 base64 失败: {}", error),
                        )
                    })?;
                persist_audio_bytes_async(&state, "model_test_tts", mime_type.as_deref(), bytes)
                    .await?
            };
            let response_payload = json!({
              "hasAudioData": !is_url,
              "audioUrl": audio_url,
              "audioMimeType": mime_type.unwrap_or_else(|| "audio/mpeg".to_string()),
              "upstreamRequest": upstream_request
            });
            response_payload
        }
        _ => {
            let error_payload = json!({ "message": format!("不支持的模型类型: {}", model_type) });
            let _ = write_model_debug_log(
                &state,
                &provider,
                &model_id,
                operation,
                "error",
                (Utc::now().timestamp_millis() - start).max(1),
                &request_payload,
                None,
                Some(&error_payload),
            );
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("不支持的模型类型: {}", model_type),
            ));
        }
    };

    let latency_ms = (Utc::now().timestamp_millis() - start).max(1);
    let display_name = resolve_provider_meta(&actual_provider)
        .map(|(name, _, _, _)| name.to_string())
        .unwrap_or_else(|| actual_provider.clone());
    let response_result = json!({
      "modelType": model_type,
      "modelId": actual_model_id,
      "provider": actual_provider,
      "displayName": display_name,
      "result": result,
      "latencyMs": latency_ms
    });

    if model_type != "text" {
        let _ = write_model_debug_log(
            &state,
            response_result
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            response_result
                .get("modelId")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            operation,
            "success",
            latency_ms,
            &request_payload,
            response_result.get("result"),
            None,
        );
    }

    Ok(Json(json!({
      "success": true,
      "data": {
        "modelType": response_result["modelType"],
        "modelId": response_result["modelId"],
        "provider": response_result["provider"],
        "displayName": response_result["displayName"],
        "result": response_result["result"],
        "latencyMs": response_result["latencyMs"]
      }
    })))
}

fn validate_script_parse_mode(value: Option<&Value>, path: &str) -> Result<(), ApiError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let raw = value
        .as_str()
        .ok_or_else(|| workflow_validation_error(path, "Expected string"))?;
    if !matches!(raw, "short_drama" | "premium_drama") {
        return Err(workflow_validation_error(path, "Invalid enum value"));
    }
    Ok(())
}

fn validate_min_text_chars(
    value: &Value,
    key: &str,
    path: &str,
    min: usize,
) -> Result<(), ApiError> {
    let raw = required_json_string(value, key, path)?;
    if raw.chars().count() < min {
        return Err(workflow_validation_error(
            format!("{path}.{key}"),
            format!("String must contain at least {min} character(s)"),
        ));
    }
    Ok(())
}

fn validate_script_episode_asset_items(
    value: &Value,
    key: &str,
    path: &str,
    name_key: &str,
) -> Result<(), ApiError> {
    let Some(items) = value.get(key).filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let items = items
        .as_array()
        .ok_or_else(|| workflow_validation_error(format!("{path}.{key}"), "Expected array"))?;
    for (index, item) in items.iter().enumerate() {
        let item_path = format!("{path}.{key}.{index}");
        if !item.is_object() {
            return Err(workflow_validation_error(&item_path, "Expected object"));
        }
        required_json_string(item, name_key, &item_path)?;
        workflow_optional_string(item, "description", &item_path)?;
        workflow_optional_string(item, "role", &item_path)?;
        workflow_optional_string(item, "gender", &item_path)?;
        workflow_optional_string(item, "timeOfDay", &item_path)?;
        workflow_optional_string(item, "mood", &item_path)?;
    }
    Ok(())
}

fn validate_script_episode_plan_item(item: &Value, path: &str) -> Result<(), ApiError> {
    if !item.is_object() {
        return Err(workflow_validation_error(path, "Expected object"));
    }
    workflow_optional_string(item, "id", path)?;
    workflow_optional_string(item, "title", path)?;
    workflow_optional_number(item, "index", path)?;
    if let Some(index) = item.get("index").and_then(Value::as_f64) {
        if index.fract() != 0.0 || index < 1.0 {
            return Err(workflow_validation_error(
                format!("{path}.index"),
                "Expected integer greater than or equal to 1",
            ));
        }
    }
    let start_offset = item
        .get("startOffset")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| {
            workflow_validation_error(format!("{path}.startOffset"), "Expected number")
        })?;
    if start_offset.fract() != 0.0 || start_offset < 0.0 {
        return Err(workflow_validation_error(
            format!("{path}.startOffset"),
            "Expected integer greater than or equal to 0",
        ));
    }
    let end_offset = item
        .get("endOffset")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| workflow_validation_error(format!("{path}.endOffset"), "Expected number"))?;
    if end_offset.fract() != 0.0 || end_offset < 1.0 {
        return Err(workflow_validation_error(
            format!("{path}.endOffset"),
            "Expected integer greater than or equal to 1",
        ));
    }
    workflow_optional_string(item, "episodeHook", path)?;
    workflow_optional_string(item, "humiliationOrThreat", path)?;
    workflow_optional_string(item, "reversalPoint", path)?;
    workflow_optional_string(item, "emotionalCurve", path)?;
    workflow_optional_string(item, "cliffhanger", path)?;
    if let Some(payoff_type) = item.get("payoffType").filter(|value| !value.is_null()) {
        let raw = payoff_type.as_str().ok_or_else(|| {
            workflow_validation_error(format!("{path}.payoffType"), "Expected string")
        })?;
        if !matches!(
            raw,
            "打脸"
                | "反杀"
                | "揭露"
                | "甜宠撑腰"
                | "身世反转"
                | "危机升级"
                | "搞钱逆袭"
                | "权力升级"
        ) {
            return Err(workflow_validation_error(
                format!("{path}.payoffType"),
                "Invalid enum value",
            ));
        }
    }
    if let Some(assets) = item.get("episodeAssets").filter(|value| !value.is_null()) {
        if !assets.is_object() {
            return Err(workflow_validation_error(
                format!("{path}.episodeAssets"),
                "Expected object",
            ));
        }
        validate_script_episode_asset_items(
            assets,
            "characters",
            &format!("{path}.episodeAssets"),
            "name",
        )?;
        validate_script_episode_asset_items(
            assets,
            "props",
            &format!("{path}.episodeAssets"),
            "name",
        )?;
        validate_script_episode_asset_items(
            assets,
            "environments",
            &format!("{path}.episodeAssets"),
            "location",
        )?;
    }
    Ok(())
}

fn validate_script_parse_request(body: &Value) -> Result<(), ApiError> {
    if !body.is_object() {
        return Err(workflow_validation_error("body", "Expected object"));
    }
    validate_min_text_chars(body, "text", "body", 10)?;
    let text_char_count = required_json_string(body, "text", "body")?
        .trim()
        .chars()
        .count();
    if text_char_count > SCRIPT_PARSE_MAX_TEXT_CHARS {
        return Err(workflow_validation_error(
            "body.text",
            format!(
                "单次剧本解析最多支持 {SCRIPT_PARSE_MAX_TEXT_CHARS} 字，请按分集解析或调整分集边界"
            ),
        ));
    }
    if let Some(max_scenes) = body.get("maxScenes").filter(|value| !value.is_null()) {
        let raw = max_scenes
            .as_f64()
            .filter(|value| value.is_finite())
            .ok_or_else(|| workflow_validation_error("body.maxScenes", "Expected number"))?;
        if raw.fract() != 0.0 || raw < 1.0 {
            return Err(workflow_validation_error(
                "body.maxScenes",
                "Expected integer greater than or equal to 1",
            ));
        }
    }
    workflow_optional_string(body, "style", "body")?;
    let target_episode_id = workflow_required_string(body, "targetEpisodeId", "body")?;
    validate_script_parse_mode(body.get("scriptParseMode"), "body.scriptParseMode")?;

    let episode_plan = body
        .get("episodePlan")
        .and_then(Value::as_array)
        .ok_or_else(|| workflow_validation_error("body.episodePlan", "Expected array"))?;
    if episode_plan.is_empty() {
        return Err(workflow_validation_error(
            "body.episodePlan",
            "Array must contain at least 1 item",
        ));
    }
    if episode_plan.len() != 1 {
        return Err(workflow_validation_error(
            "body.episodePlan",
            "剧本解析只支持按单集执行，请只传入当前分集规划",
        ));
    }
    for (index, item) in episode_plan.iter().enumerate() {
        validate_script_episode_plan_item(item, &format!("body.episodePlan.{index}"))?;
    }
    let episode_id = episode_plan
        .first()
        .and_then(|item| item.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if episode_id != target_episode_id.trim() {
        return Err(workflow_validation_error(
            "body.targetEpisodeId",
            "targetEpisodeId 必须与 episodePlan[0].id 一致",
        ));
    }
    Ok(())
}

fn validate_episode_plan_request(body: &Value) -> Result<(), ApiError> {
    if !body.is_object() {
        return Err(workflow_validation_error("body", "Expected object"));
    }
    validate_min_text_chars(body, "text", "body", 10)?;
    validate_script_parse_mode(body.get("scriptParseMode"), "body.scriptParseMode")?;
    Ok(())
}

pub(super) async fn api_script_episode_plan(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_episode_plan_request(&body)?;
    let context = model_log_context_from_workflow_body(&body, None, None);
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");

    let script_parse_mode = json_string(body.get("scriptParseMode"), "short_drama");
    CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
            match build_model_episode_plan(&state, text, &script_parse_mode).await {
                Ok((episodes, provider, model_id, segmented)) => {
                    if episodes.is_empty() {
                        return Err(ApiError::new(
                            StatusCode::BAD_GATEWAY,
                            "分集目录模型结果为空",
                        ));
                    }
                    Ok(Json(json!({
                      "success": true,
                      "data": { "episodes": episodes },
                      "usage": {
                        "modelProvider": provider,
                        "modelId": model_id,
                        "fallback": false,
                        "segmented": segmented
                      }
                    })))
                }
                Err(error) => Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    format!("大模型分集失败: {}", error),
                )),
            }
        })
        .await
}

pub(super) async fn api_script_parse(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_script_parse_request(&body)?;
    let context = model_log_context_from_workflow_body(&body, None, None);
    let prompt = {
        let conn = db_connection(&state)?;
        build_script_parse_prompt(&conn, &body)?
    };
    let (model_text, provider, model_id) = CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
            run_workflow_text_model(&state, "script_parsing", &prompt).await
        })
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("剧本解析模型调用失败: {}", error),
            )
        })?;
    let value = extract_json_from_text(&model_text).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("剧本解析模型 JSON 解析失败: {}", error),
        )
    })?;
    let mut payload =
        apply_script_parse_postprocessing(normalize_model_script_result(value, &body), &body);
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "usage".to_string(),
            json!({
              "modelProvider": provider,
              "modelId": model_id,
              "fallback": false
            }),
        );
    }
    Ok(Json(payload))
}

pub(super) async fn api_script_parse_stream(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    validate_script_parse_request(&body)?;
    let request_id = current_request_id();

    enum ParseStreamState {
        Accepted {
            state: BackendState,
            body: Value,
            request_id: Option<String>,
        },
        Parsing {
            state: BackendState,
            body: Value,
            request_id: Option<String>,
        },
        Model {
            state: BackendState,
            body: Value,
            request_id: Option<String>,
        },
        Done,
    }

    fn ndjson_line(value: Value) -> Result<Bytes, Infallible> {
        Ok(Bytes::from(format!("{}\n", value)))
    }

    let body_stream = stream::unfold(
        ParseStreamState::Accepted {
            state,
            body,
            request_id,
        },
        |stream_state| async move {
            match stream_state {
                ParseStreamState::Accepted {
                    state,
                    body,
                    request_id,
                } => Some((
                    ndjson_line(json!({
                      "type": "progress",
                      "payload": {
                        "step": "accepted",
                        "message": "已接收解析请求，准备开始",
                        "progress": 1
                      },
                      "timestamp": now_iso()
                    })),
                    ParseStreamState::Parsing {
                        state,
                        body,
                        request_id,
                    },
                )),
                ParseStreamState::Parsing {
                    state,
                    body,
                    request_id,
                } => Some((
                    ndjson_line(json!({
                      "type": "progress",
                      "payload": {
                        "step": "parsing",
                        "message": "正在调用剧本解析模型",
                        "progress": 8
                      },
                      "timestamp": now_iso()
                    })),
                    ParseStreamState::Model {
                        state,
                        body,
                        request_id,
                    },
                )),
                ParseStreamState::Model {
                    state,
                    body,
                    request_id,
                } => {
                    let parse_result = match request_id {
                        Some(request_id) => {
                            CURRENT_REQUEST_ID
                                .scope(request_id, async {
                                    api_script_parse(State(state), Json(body)).await
                                })
                                .await
                        }
                        None => api_script_parse(State(state), Json(body)).await,
                    };
                    let event = match parse_result {
                        Ok(parsed) => json!({
                          "type": "result",
                          "payload": parsed.0,
                          "timestamp": now_iso()
                        }),
                        Err(error) => json!({
                          "type": "error",
                          "payload": {
                            "message": error.message
                          },
                          "timestamp": now_iso()
                        }),
                    };
                    Some((ndjson_line(event), ParseStreamState::Done))
                }
                ParseStreamState::Done => None,
            }
        },
    );

    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-ndjson; charset=utf-8"),
        )
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-transform"),
        )
        .body(Body::from_stream(body_stream))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn xml_escape_text(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn build_minimal_docx_bytes(title: &str, lines: &[String]) -> Result<Vec<u8>, ApiError> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
    writer
        .start_file("[Content_Types].xml", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(content_types.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
    writer
        .start_file("_rels/.rels", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(rels.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut document_xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>"#,
    );
    let title_line = xml_escape_text(title);
    document_xml.push_str(&format!("<w:p><w:r><w:t>{}</w:t></w:r></w:p>", title_line));
    for line in lines {
        let escaped = xml_escape_text(line);
        document_xml.push_str(&format!(
            "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escaped
        ));
    }
    document_xml.push_str(
        r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#,
    );

    writer
        .start_file("word/document.xml", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(document_xml.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let cursor = writer
        .finish()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(cursor.into_inner())
}

fn normalize_docx_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default()
}

fn format_docx_duration(value: Option<&Value>) -> Option<String> {
    let seconds = value.and_then(Value::as_f64)?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let rounded = (seconds * 10.0).round() / 10.0;
    if (rounded.fract()).abs() < f64::EPSILON {
        Some(format!("{}", rounded as i64))
    } else {
        Some(format!("{:.1}", rounded))
    }
}

fn sanitize_script_docx_description(raw: Option<&Value>) -> String {
    let text = normalize_docx_text(raw);
    if text.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    let mut skipping_asset_mentions = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "[引用资产]" {
            skipping_asset_mentions = true;
            continue;
        }
        if skipping_asset_mentions && trimmed.starts_with('@') {
            continue;
        }
        skipping_asset_mentions = false;

        let mut cleaned = trimmed
            .replace("不添加字幕，不添加BGM。", "")
            .replace("不添加字幕，不添加BGM.", "")
            .replace("不添加字幕，不添加BGM", "")
            .trim()
            .to_string();
        cleaned = strip_docx_image_tags(&cleaned);
        if !cleaned.is_empty() {
            lines.push(cleaned);
        }
    }
    lines.join("\n").trim().to_string()
}

fn strip_docx_image_tags(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if rest.starts_with("[图片") || rest.to_ascii_lowercase().starts_with("[image #") {
            if let Some(end) = rest.find(']') {
                rest = &rest[end + 1..];
                continue;
            }
        }
        if rest.starts_with("@图片") || rest.to_ascii_lowercase().starts_with("@image #") {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            rest = &rest[end..];
            continue;
        }
        let Some(ch) = rest.chars().next() else {
            break;
        };
        output.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_docx_content_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn normalize_docx_characters(scene: &Value) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut characters = Vec::new();
    if let Some(items) = scene.get("characters").and_then(Value::as_array) {
        for item in items {
            let name = normalize_docx_text(item.get("name"));
            if !name.is_empty() && seen.insert(name.clone()) {
                characters.push(name);
            }
        }
    }
    characters
}

fn normalize_docx_dialogues(
    description: &str,
    include_from_description: bool,
) -> Vec<(String, String)> {
    let mut seen = HashSet::<String>::new();
    let mut dialogues = Vec::new();

    if include_from_description {
        for (speaker, text) in extract_description_dialogues(description) {
            let key = format!("{}::{}", speaker, text);
            if seen.insert(key) {
                dialogues.push((speaker, text));
            }
        }
    }
    dialogues
}

fn export_validation_error(path: impl AsRef<str>, message: impl AsRef<str>) -> ApiError {
    ApiError::new(
        StatusCode::BAD_REQUEST,
        format!("{}: {}", path.as_ref(), message.as_ref()),
    )
}

fn optional_export_string(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::String(_)) => Ok(()),
        Some(_) => Err(export_validation_error(
            format!("{path}.{key}"),
            "Expected string",
        )),
    }
}

fn optional_export_number(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::Number(_)) => Ok(()),
        Some(_) => Err(export_validation_error(
            format!("{path}.{key}"),
            "Expected number",
        )),
    }
}

fn optional_export_bool(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::Bool(_)) => Ok(()),
        Some(_) => Err(export_validation_error(
            format!("{path}.{key}"),
            "Expected boolean",
        )),
    }
}

fn validate_script_docx_payload(body: &Value) -> Result<&Vec<Value>, ApiError> {
    optional_export_string(body, "projectName", "body")?;
    optional_export_bool(body, "includeDialoguesFromDescription", "body")?;
    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| export_validation_error("scenes", "Expected array"))?;
    if scenes.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有可导出的场景"));
    }
    for (index, scene) in scenes.iter().enumerate() {
        let path = format!("scenes.{index}");
        optional_export_string(scene, "title", &path)?;
        optional_export_string(scene, "description", &path)?;
        optional_export_string(scene, "narration", &path)?;
        optional_export_number(scene, "duration", &path)?;
        if let Some(setting) = scene.get("setting").filter(|value| !value.is_null()) {
            if !setting.is_object() {
                return Err(export_validation_error(
                    format!("{path}.setting"),
                    "Expected object",
                ));
            }
            optional_export_string(setting, "location", &format!("{path}.setting"))?;
            optional_export_string(setting, "timeOfDay", &format!("{path}.setting"))?;
        }
        if let Some(characters) = scene.get("characters").filter(|value| !value.is_null()) {
            let items = characters.as_array().ok_or_else(|| {
                export_validation_error(format!("{path}.characters"), "Expected array")
            })?;
            for (character_index, character) in items.iter().enumerate() {
                optional_export_string(
                    character,
                    "name",
                    &format!("{path}.characters.{character_index}"),
                )?;
            }
        }
    }
    Ok(scenes)
}

fn script_docx_file_name(project_name: &str) -> String {
    let normalized = project_name
        .trim()
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_whitespace() => '_',
            ch => ch,
        })
        .collect::<String>();
    let safe = normalized.chars().take(48).collect::<String>();
    let base = if safe.trim().is_empty() {
        "剧本"
    } else {
        safe.trim()
    };
    format!("{}-格式化剧本-{}.docx", base, Utc::now().format("%Y-%m-%d"))
}

pub(super) async fn api_script_export_docx(Json(body): Json<Value>) -> Result<Response, ApiError> {
    let scenes = validate_script_docx_payload(&body)?.clone();
    let project_name = json_string(body.get("projectName"), "剧本检视稿");
    let include_dialogues_from_description = body
        .get("includeDialoguesFromDescription")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let mut lines: Vec<String> = Vec::new();
    lines.push(format!(
        "导出时间：{}",
        Utc::now().format("%Y-%m-%d %H:%M:%S")
    ));
    lines.push(String::new());
    for (index, scene) in scenes.iter().enumerate() {
        let title = json_string(scene.get("title"), &format!("场景 {}", index + 1));
        let description = sanitize_script_docx_description(scene.get("description"));
        lines.push(format!("场景 {}：{}", index + 1, title));
        let mut meta_parts = Vec::new();
        if let Some(setting) = scene.get("setting") {
            let location = normalize_docx_text(setting.get("location"));
            let time_of_day = setting
                .get("timeOfDay")
                .and_then(Value::as_str)
                .map(scene_time_of_day_text)
                .unwrap_or("");
            if !location.is_empty() {
                meta_parts.push(format!("地点：{}", location));
            }
            if !time_of_day.is_empty() {
                meta_parts.push(format!("时间：{}", time_of_day));
            }
        }
        if let Some(duration) = format_docx_duration(scene.get("duration")) {
            meta_parts.push(format!("时长：{} 秒", duration));
        }
        if !meta_parts.is_empty() {
            lines.push(meta_parts.join("  |  "));
        }
        let characters = normalize_docx_characters(scene);
        if !characters.is_empty() {
            lines.push(format!("角色：{}", characters.join("、")));
        }
        if !description.is_empty() {
            lines.push("场景描述".to_string());
            for line in split_docx_content_lines(&description) {
                lines.push(line);
            }
        }
        if let Some(narration) = scene.get("narration").and_then(Value::as_str) {
            if !narration.trim().is_empty() {
                lines.push("旁白".to_string());
                for line in split_docx_content_lines(narration) {
                    lines.push(line);
                }
            }
        }
        let dialogues = normalize_docx_dialogues(&description, include_dialogues_from_description);
        if !dialogues.is_empty() {
            lines.push("对白".to_string());
            for (character, text) in dialogues {
                lines.push(format!("- {}：{}", character, text));
            }
        }
        lines.push(String::new());
    }

    let bytes = build_minimal_docx_bytes(&format!("{} - 格式化剧本", project_name), &lines)?;
    let file_name = script_docx_file_name(&project_name);
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!(
                    "attachment; filename*=UTF-8''{}",
                    tos_percent_encode(&file_name)
                ))
                .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        bytes,
    )
        .into_response())
}

pub(super) async fn api_asset_upload_image(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let image_data = body
        .get("imageData")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "图片内容不能为空"))?;
    let prefix = json_string(body.get("prefix"), "asset_upload");
    let image_url = persist_image_source(&state, image_data, &prefix).await?;
    Ok(Json(json!({
      "success": true,
      "imageUrl": image_url
    })))
}

pub(super) async fn api_character_voice_upload(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let audio_data = body
        .get("audioData")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "音频内容不能为空"))?;
    if audio_data.chars().count() > 40 * 1024 * 1024 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "音频内容过大"));
    }
    if !(audio_data.starts_with("data:audio/")
        || audio_data.starts_with("http://")
        || audio_data.starts_with("https://"))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持音频 dataURL 或音频 URL",
        ));
    }
    if let Some(prefix) = body.get("prefix").and_then(Value::as_str) {
        if prefix.trim().chars().count() > 80 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "prefix 不能超过 80 个字符",
            ));
        }
    }
    let prefix = json_string(body.get("prefix"), "character_voice_upload");
    let audio_url = persist_audio_source(&state, audio_data, &prefix).await?;
    Ok(Json(json!({
      "success": true,
      "audioUrl": audio_url
    })))
}

fn validate_character_voice_asset(value: Option<&Value>, path: &str) -> Result<(), ApiError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_null() {
        return Ok(());
    }
    let object = value
        .as_object()
        .ok_or_else(|| workflow_validation_error(path, "Expected object"))?;
    match object.get("audioUrl") {
        Some(Value::String(_)) => {}
        _ => {
            return Err(workflow_validation_error(
                format!("{path}.audioUrl"),
                "Expected string",
            ));
        }
    }
    match object.get("updatedAt") {
        Some(Value::String(_)) => {}
        _ => {
            return Err(workflow_validation_error(
                format!("{path}.updatedAt"),
                "Expected datetime string",
            ));
        }
    }
    if let Some(value) = object.get("locked").filter(|value| !value.is_null()) {
        if !value.is_boolean() {
            return Err(workflow_validation_error(
                format!("{path}.locked"),
                "Expected boolean",
            ));
        }
    }
    for key in ["transcript", "sourceSceneId", "sourceTaskId"] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            if !value.is_string() {
                return Err(workflow_validation_error(
                    format!("{path}.{key}"),
                    "Expected string",
                ));
            }
        }
    }
    for key in ["startTimeMs", "endTimeMs", "durationMs", "matchScore"] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            if !value.is_number() {
                return Err(workflow_validation_error(
                    format!("{path}.{key}"),
                    "Expected number",
                ));
            }
        }
    }
    Ok(())
}

fn validate_character_generate_payload(body: &Value) -> Result<(), ApiError> {
    let character = workflow_required_object(body, "character", "body")?;
    workflow_required_string(character, "id", "body.character")?;
    workflow_required_string(character, "name", "body.character")?;
    workflow_required_string(character, "appearance", "body.character")?;
    workflow_required_string(body, "style", "body")?;
    workflow_optional_bool(body, "generateExpressions", "body")?;

    workflow_optional_string(character, "role", "body.character")?;
    workflow_optional_number(character, "age", "body.character")?;
    if let Some(gender) = character.get("gender").filter(|value| !value.is_null()) {
        let raw = gender
            .as_str()
            .ok_or_else(|| workflow_validation_error("body.character.gender", "Expected string"))?;
        if !matches!(raw, "male" | "female" | "other") {
            return Err(workflow_validation_error(
                "body.character.gender",
                "Invalid enum value",
            ));
        }
    }
    workflow_optional_string(character, "personality", "body.character")?;
    workflow_optional_string(character, "background", "body.character")?;
    workflow_optional_string(character, "motivation", "body.character")?;
    if let Some(speaking_style) = character
        .get("speakingStyle")
        .filter(|value| !value.is_null())
    {
        let raw = speaking_style.as_str().ok_or_else(|| {
            workflow_validation_error("body.character.speakingStyle", "Expected string")
        })?;
        if !matches!(
            raw,
            "formal"
                | "casual"
                | "polite"
                | "rude"
                | "childish"
                | "mature"
                | "humorous"
                | "serious"
                | "mysterious"
                | "energetic"
        ) {
            return Err(workflow_validation_error(
                "body.character.speakingStyle",
                "Invalid enum value",
            ));
        }
    }
    workflow_optional_string(character, "catchphrase", "body.character")?;
    workflow_optional_string(character, "voiceTone", "body.character")?;
    if let Some(traits) = character.get("traits").filter(|value| !value.is_null()) {
        let items = traits
            .as_array()
            .ok_or_else(|| workflow_validation_error("body.character.traits", "Expected array"))?;
        for (index, item) in items.iter().enumerate() {
            if !item.is_string() {
                return Err(workflow_validation_error(
                    format!("body.character.traits.{index}"),
                    "Expected string",
                ));
            }
        }
    }
    validate_character_voice_asset(character.get("voiceAsset"), "body.character.voiceAsset")?;

    if let Some(regeneration) = workflow_optional_object(body, "regeneration", "body")? {
        workflow_optional_string(regeneration, "customPrompt", "body.regeneration")?;
        workflow_optional_string(regeneration, "referenceImage", "body.regeneration")?;
    }
    Ok(())
}

fn latest_character_base_image(
    state: &BackendState,
    character_id: &str,
) -> Result<Option<String>, ApiError> {
    let conn = db_connection(state)?;
    conn.query_row(
        "SELECT base_image FROM characters WHERE id = ?1 LIMIT 1",
        params![character_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|value| {
        value
            .flatten()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
    })
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) async fn api_character_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    validate_character_generate_payload(&body)?;
    let character = body
        .get("character")
        .cloned()
        .expect("validated character object");
    let character_id = json_string(character.get("id"), "");
    let character_name = json_string(character.get("name"), "");
    let appearance = json_string(character.get("appearance"), "");
    let gender = json_string(character.get("gender"), "未明确");
    let style = json_string(body.get("style"), "");
    let regeneration_prompt = body
        .get("regeneration")
        .and_then(|value| value.get("customPrompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut reference_sources = Vec::new();
    if regeneration_prompt.is_some() {
        if let Some(latest_base_image) = latest_character_base_image(&state, &character_id)? {
            reference_sources.push(latest_base_image);
        }
        push_optional_reference_source(
            &mut reference_sources,
            body.get("regeneration")
                .and_then(|value| value.get("referenceImage")),
        );
        if reference_sources.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "角色二次生成需要参考图，请先生成角色图后再试",
            ));
        }
    }
    let reference_images = normalize_image_reference_sources(&state, reference_sources, 4).await?;
    let prompt = {
        let conn = db_connection(&state)?;
        if let Some(custom_prompt) = regeneration_prompt {
            render_configured_prompt(
                &conn,
                PROMPT_TEMPLATE_CHARACTER_REGENERATION,
                &[
                    ("characterName", character_name.as_str()),
                    ("appearance", appearance.as_str()),
                    ("gender", gender.as_str()),
                    ("style", style.as_str()),
                    ("activeStyleConstraint", custom_prompt),
                    ("customPrompt", custom_prompt),
                ],
            )?
        } else {
            render_configured_prompt(
                &conn,
                PROMPT_TEMPLATE_CHARACTER_SHEET,
                &[
                    ("characterName", character_name.as_str()),
                    ("appearance", appearance.as_str()),
                    ("gender", gender.as_str()),
                    ("style", style.as_str()),
                ],
            )?
        }
    };
    let context = model_log_context_from_workflow_body(&body, None, Some(character_id.to_string()));
    let (image_url, provider, model_id) = CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
            run_workflow_image_model(
                &state,
                "character_portrait",
                &prompt,
                "1792x1024",
                &format!("char_{}", character_id),
                &reference_images,
            )
            .await
        })
        .await
        .map_err(|error| {
            eprintln!("[CharacterGen] 图片模型调用失败: {}", error);
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error)
        })?;

    let now = now_iso();
    Ok(Json(json!({
      "success": true,
      "asset": {
        "characterId": character_id,
        "name": character_name,
        "baseImage": image_url,
        "expressions": {},
        "sheetType": "full",
        "createdAt": now,
        "updatedAt": now
      },
      "sheetType": "character-sheet",
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "usage": {
        "modelProvider": provider,
        "modelId": model_id,
        "fallback": false
      }
    })))
}

fn workflow_validation_error(path: impl AsRef<str>, message: impl AsRef<str>) -> ApiError {
    ApiError::new(
        StatusCode::BAD_REQUEST,
        format!("{}: {}", path.as_ref(), message.as_ref()),
    )
}

fn workflow_required_object<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
) -> Result<&'a Value, ApiError> {
    let child = value
        .get(key)
        .ok_or_else(|| workflow_validation_error(format!("{path}.{key}"), "Expected object"))?;
    if child.is_object() {
        Ok(child)
    } else {
        Err(workflow_validation_error(
            format!("{path}.{key}"),
            "Expected object",
        ))
    }
}

fn workflow_optional_object<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
) -> Result<Option<&'a Value>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(child) if child.is_object() => Ok(Some(child)),
        Some(_) => Err(workflow_validation_error(
            format!("{path}.{key}"),
            "Expected object",
        )),
    }
}

fn workflow_required_string<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
) -> Result<&'a str, ApiError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
        .ok_or_else(|| {
            workflow_validation_error(format!("{path}.{key}"), "Expected non-empty string")
        })
}

fn workflow_optional_string(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::String(_)) => Ok(()),
        Some(_) => Err(workflow_validation_error(
            format!("{path}.{key}"),
            "Expected string",
        )),
    }
}

fn workflow_optional_number(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::Number(_)) => Ok(()),
        Some(_) => Err(workflow_validation_error(
            format!("{path}.{key}"),
            "Expected number",
        )),
    }
}

fn workflow_optional_bool(value: &Value, key: &str, path: &str) -> Result<(), ApiError> {
    match value.get(key) {
        None | Some(Value::Null) | Some(Value::Bool(_)) => Ok(()),
        Some(_) => Err(workflow_validation_error(
            format!("{path}.{key}"),
            "Expected boolean",
        )),
    }
}

fn validate_workflow_aspect_ratio(body: &Value) -> Result<(), ApiError> {
    if let Some(value) = body.get("aspectRatio").filter(|value| !value.is_null()) {
        let raw = value
            .as_str()
            .ok_or_else(|| workflow_validation_error("aspectRatio", "Expected string"))?;
        if !matches!(raw, "16:9" | "9:16" | "1:1") {
            return Err(workflow_validation_error(
                "aspectRatio",
                "Invalid enum value",
            ));
        }
    }
    Ok(())
}

fn validate_workflow_setting(scene: &Value, path: &str) -> Result<(), ApiError> {
    if let Some(setting) = workflow_optional_object(scene, "setting", path)? {
        workflow_optional_string(setting, "location", &format!("{path}.setting"))?;
        workflow_optional_string(setting, "timeOfDay", &format!("{path}.setting"))?;
        workflow_optional_string(setting, "era", &format!("{path}.setting"))?;
        workflow_optional_string(setting, "mood", &format!("{path}.setting"))?;
        workflow_optional_string(setting, "weather", &format!("{path}.setting"))?;
    }
    Ok(())
}

fn validate_workflow_scene(
    scene: &Value,
    path: &str,
    require_positive_duration: bool,
) -> Result<(), ApiError> {
    workflow_required_string(scene, "id", path)?;
    workflow_required_string(scene, "description", path)?;
    workflow_optional_string(scene, "title", path)?;
    workflow_optional_string(scene, "cameraNote", path)?;
    workflow_optional_string(scene, "narration", path)?;
    workflow_optional_number(scene, "duration", path)?;
    if require_positive_duration {
        if let Some(duration) = scene.get("duration").and_then(Value::as_f64) {
            if !duration.is_finite() || duration <= 0.0 {
                return Err(workflow_validation_error(
                    format!("{path}.duration"),
                    "Number must be positive",
                ));
            }
        }
    }
    validate_workflow_setting(scene, path)?;
    if let Some(characters) = scene.get("characters").filter(|value| !value.is_null()) {
        let items = characters.as_array().ok_or_else(|| {
            workflow_validation_error(format!("{path}.characters"), "Expected array")
        })?;
        for (index, character) in items.iter().enumerate() {
            let item_path = format!("{path}.characters.{index}");
            workflow_required_string(character, "name", &item_path)?;
            workflow_optional_string(character, "appearance", &item_path)?;
            workflow_optional_string(character, "emotion", &item_path)?;
        }
    }
    Ok(())
}

fn validate_prop_generate_payload(body: &Value) -> Result<(), ApiError> {
    let prop = workflow_required_object(body, "prop", "body")?;
    workflow_required_string(prop, "id", "body.prop")?;
    workflow_required_string(prop, "name", "body.prop")?;
    workflow_optional_string(prop, "description", "body.prop")?;
    if let Some(category) = prop.get("category").filter(|value| !value.is_null()) {
        let raw = category
            .as_str()
            .ok_or_else(|| workflow_validation_error("body.prop.category", "Expected string"))?;
        if !matches!(raw, "prop" | "other") {
            return Err(workflow_validation_error(
                "body.prop.category",
                "Invalid enum value",
            ));
        }
    }
    workflow_optional_string(body, "projectId", "body")?;
    workflow_optional_string(body, "style", "body")?;
    Ok(())
}

fn validate_reference_generate_payload(body: &Value) -> Result<(), ApiError> {
    let scene = workflow_required_object(body, "scene", "body")?;
    validate_workflow_scene(scene, "body.scene", false)?;
    validate_workflow_aspect_ratio(body)?;
    workflow_optional_string(body, "style", "body")?;
    if let Some(environment_context) = workflow_optional_object(body, "environmentContext", "body")?
    {
        workflow_optional_string(
            environment_context,
            "environmentRoot",
            "body.environmentContext",
        )?;
        workflow_optional_string(
            environment_context,
            "anchorSceneId",
            "body.environmentContext",
        )?;
        workflow_optional_string(
            environment_context,
            "anchorSceneTitle",
            "body.environmentContext",
        )?;
        workflow_optional_string(
            environment_context,
            "anchorLocation",
            "body.environmentContext",
        )?;
        workflow_optional_string(
            environment_context,
            "anchorDescription",
            "body.environmentContext",
        )?;
        if let Some(items) = environment_context
            .get("siblingLocations")
            .filter(|value| !value.is_null())
        {
            let items = items.as_array().ok_or_else(|| {
                workflow_validation_error(
                    "body.environmentContext.siblingLocations",
                    "Expected array",
                )
            })?;
            for (index, item) in items.iter().enumerate() {
                if !item.is_string() {
                    return Err(workflow_validation_error(
                        format!("body.environmentContext.siblingLocations.{index}"),
                        "Expected string",
                    ));
                }
            }
        }
    }
    if let Some(regeneration) = workflow_optional_object(body, "regeneration", "body")? {
        workflow_optional_string(regeneration, "customPrompt", "body.regeneration")?;
        workflow_optional_string(regeneration, "referenceImage", "body.regeneration")?;
    }
    workflow_optional_string(body, "consistencyReferenceImage", "body")?;
    for key in ["consistencyReferenceImages", "characterReferenceImages"] {
        if let Some(items) = body.get(key).filter(|value| !value.is_null()) {
            let items = items
                .as_array()
                .ok_or_else(|| workflow_validation_error(key, "Expected array"))?;
            for (index, item) in items.iter().enumerate() {
                if !item.is_string() {
                    return Err(workflow_validation_error(
                        format!("{key}.{index}"),
                        "Expected string",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_scene_refinement_payload(body: &Value) -> Result<(), ApiError> {
    let scene = workflow_required_object(body, "scene", "body")?;
    validate_workflow_scene(scene, "body.scene", true)?;
    let user_message = workflow_required_string(body, "userMessage", "body")?;
    let count = user_message.chars().count();
    if count > 2000 {
        return Err(workflow_validation_error(
            "body.userMessage",
            "String must contain at most 2000 characters",
        ));
    }
    workflow_optional_string(body, "style", "body")?;
    if let Some(history) = body.get("history").filter(|value| !value.is_null()) {
        let items = history
            .as_array()
            .ok_or_else(|| workflow_validation_error("body.history", "Expected array"))?;
        if items.len() > 12 {
            return Err(workflow_validation_error(
                "body.history",
                "Array must contain at most 12 items",
            ));
        }
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("body.history.{index}");
            let role = workflow_required_string(item, "role", &item_path)?;
            if !matches!(role, "user" | "assistant") {
                return Err(workflow_validation_error(
                    format!("{item_path}.role"),
                    "Invalid enum value",
                ));
            }
            let content = workflow_required_string(item, "content", &item_path)?;
            let count = content.chars().count();
            if count > 1200 {
                return Err(workflow_validation_error(
                    format!("{item_path}.content"),
                    "String must contain at most 1200 characters",
                ));
            }
        }
    }
    if let Some(assets) = body.get("mentionedAssets").filter(|value| !value.is_null()) {
        let items = assets
            .as_array()
            .ok_or_else(|| workflow_validation_error("body.mentionedAssets", "Expected array"))?;
        if items.len() > 24 {
            return Err(workflow_validation_error(
                "body.mentionedAssets",
                "Array must contain at most 24 items",
            ));
        }
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("body.mentionedAssets.{index}");
            workflow_required_string(item, "id", &item_path)?;
            workflow_required_string(item, "name", &item_path)?;
            let asset_type = workflow_required_string(item, "type", &item_path)?;
            if !matches!(asset_type, "character" | "environment" | "prop" | "other") {
                return Err(workflow_validation_error(
                    format!("{item_path}.type"),
                    "Invalid enum value",
                ));
            }
            workflow_optional_string(item, "description", &item_path)?;
            workflow_optional_bool(item, "hasReferenceImage", &item_path)?;
        }
    }
    Ok(())
}

fn has_non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|item| !item.is_empty())
}

fn validate_video_generate_payload(body: &Value) -> Result<(), ApiError> {
    let scene = workflow_required_object(body, "scene", "body")?;
    validate_workflow_scene(scene, "body.scene", false)?;
    workflow_optional_number(scene, "sceneIndex", "body.scene")?;
    if let Some(index) = scene.get("sceneIndex").and_then(Value::as_f64) {
        if !index.is_finite() || index.fract() != 0.0 || index < 1.0 {
            return Err(workflow_validation_error(
                "body.scene.sceneIndex",
                "Expected integer greater than or equal to 1",
            ));
        }
    }
    validate_workflow_aspect_ratio(body)?;
    workflow_optional_string(body, "style", "body")?;
    workflow_optional_string(body, "projectId", "body")?;
    let references = workflow_required_object(body, "references", "body")?;
    workflow_optional_string(references, "environmentImage", "body.references")?;
    workflow_optional_string(references, "continuityFirstFrame", "body.references")?;
    workflow_optional_string(references, "characterImage", "body.references")?;
    let mut has_reference = has_non_empty_string(references.get("environmentImage"))
        || has_non_empty_string(references.get("continuityFirstFrame"))
        || has_non_empty_string(references.get("characterImage"));
    if let Some(environment_asset) =
        workflow_optional_object(references, "environmentAsset", "body.references")?
    {
        workflow_optional_string(environment_asset, "id", "body.references.environmentAsset")?;
        workflow_optional_string(
            environment_asset,
            "name",
            "body.references.environmentAsset",
        )?;
        if let Some(asset_type) = environment_asset
            .get("type")
            .filter(|value| !value.is_null())
        {
            if asset_type.as_str() != Some("environment") {
                return Err(workflow_validation_error(
                    "body.references.environmentAsset.type",
                    "Invalid literal value",
                ));
            }
        }
        workflow_optional_string(
            environment_asset,
            "image",
            "body.references.environmentAsset",
        )?;
        has_reference |= has_non_empty_string(environment_asset.get("image"));
    }
    if let Some(items) = references
        .get("characterImages")
        .filter(|value| !value.is_null())
    {
        let items = items.as_array().ok_or_else(|| {
            workflow_validation_error("body.references.characterImages", "Expected array")
        })?;
        for (index, item) in items.iter().enumerate() {
            let raw = item.as_str().ok_or_else(|| {
                workflow_validation_error(
                    format!("body.references.characterImages.{index}"),
                    "Expected string",
                )
            })?;
            has_reference |= !raw.trim().is_empty();
        }
    }
    if let Some(items) = references
        .get("characterAssets")
        .filter(|value| !value.is_null())
    {
        let items = items.as_array().ok_or_else(|| {
            workflow_validation_error("body.references.characterAssets", "Expected array")
        })?;
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("body.references.characterAssets.{index}");
            workflow_optional_string(item, "id", &item_path)?;
            workflow_optional_string(item, "name", &item_path)?;
            if let Some(asset_type) = item.get("type").filter(|value| !value.is_null()) {
                let raw = asset_type.as_str().ok_or_else(|| {
                    workflow_validation_error(format!("{item_path}.type"), "Expected string")
                })?;
                if !matches!(raw, "character" | "prop" | "other") {
                    return Err(workflow_validation_error(
                        format!("{item_path}.type"),
                        "Invalid enum value",
                    ));
                }
            }
            workflow_required_string(item, "image", &item_path)?;
            has_reference = true;
        }
    }
    if let Some(voice_asset) =
        workflow_optional_object(references, "narrationVoiceAsset", "body.references")?
    {
        workflow_optional_string(voice_asset, "id", "body.references.narrationVoiceAsset")?;
        workflow_optional_string(voice_asset, "name", "body.references.narrationVoiceAsset")?;
        if let Some(asset_type) = voice_asset.get("type").filter(|value| !value.is_null()) {
            if asset_type.as_str() != Some("other") {
                return Err(workflow_validation_error(
                    "body.references.narrationVoiceAsset.type",
                    "Invalid literal value",
                ));
            }
        }
        workflow_required_string(
            voice_asset,
            "audioUrl",
            "body.references.narrationVoiceAsset",
        )?;
    }
    if !has_reference {
        return Err(workflow_validation_error(
            "body.references",
            "至少提供一张参考图",
        ));
    }
    Ok(())
}

fn required_json_string<'a>(value: &'a Value, key: &str, path: &str) -> Result<&'a str, ApiError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| workflow_validation_error(format!("{path}.{key}"), "Expected string"))
}

fn validate_optional_string_array(
    value: &Value,
    key: &str,
    path: &str,
    max_items: usize,
) -> Result<(), ApiError> {
    let Some(child) = value.get(key).filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let items = child
        .as_array()
        .ok_or_else(|| workflow_validation_error(format!("{path}.{key}"), "Expected array"))?;
    if items.len() > max_items {
        return Err(workflow_validation_error(
            format!("{path}.{key}"),
            format!("Array must contain at most {max_items} items"),
        ));
    }
    for (index, item) in items.iter().enumerate() {
        if !item.is_string() {
            return Err(workflow_validation_error(
                format!("{path}.{key}.{index}"),
                "Expected string",
            ));
        }
    }
    Ok(())
}

fn validate_video_generation_config(config: &mut Value) -> Result<(), ApiError> {
    if !config.is_object() {
        return Err(workflow_validation_error("body.config", "Expected object"));
    }

    required_json_string(config, "prompt", "body.config")?;
    workflow_optional_string(config, "firstFrame", "body.config")?;
    workflow_optional_string(config, "lastFrame", "body.config")?;
    workflow_optional_string(config, "imageUrl", "body.config")?;
    workflow_optional_string(config, "audioUrl", "body.config")?;
    workflow_optional_string(config, "negativePrompt", "body.config")?;
    workflow_optional_string(config, "size", "body.config")?;
    workflow_optional_string(config, "modelId", "body.config")?;
    workflow_optional_bool(config, "withAudio", "body.config")?;
    workflow_optional_bool(config, "promptExtend", "body.config")?;
    workflow_optional_bool(config, "watermark", "body.config")?;
    workflow_optional_number(config, "seed", "body.config")?;
    validate_optional_string_array(config, "referenceImages", "body.config", 9)?;

    match config.get("duration").filter(|value| !value.is_null()) {
        Some(value) => {
            let duration = value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| {
                    workflow_validation_error("body.config.duration", "Expected number")
                })?;
            if !(2.0..=15.0).contains(&duration) {
                return Err(workflow_validation_error(
                    "body.config.duration",
                    "Number must be between 2 and 15",
                ));
            }
        }
        None => {
            if let Some(object) = config.as_object_mut() {
                object.insert("duration".to_string(), json!(8));
            }
        }
    }

    validate_enum_or_default(
        config,
        "resolution",
        Some("720p"),
        &["480p", "720p", "1080p"],
    )?;
    validate_enum_or_default(
        config,
        "aspectRatio",
        Some("16:9"),
        &["16:9", "9:16", "1:1"],
    )?;
    validate_enum_or_default(config, "model", Some("standard"), &["standard", "fast"])?;
    validate_enum_or_default(
        config,
        "provider",
        None,
        &["gemini", "qwen", "kling", "volcengine"],
    )?;

    Ok(())
}

fn validate_enum_or_default(
    value: &mut Value,
    key: &str,
    default_value: Option<&str>,
    allowed: &[&str],
) -> Result<(), ApiError> {
    match value.get(key).filter(|value| !value.is_null()) {
        Some(child) => {
            let raw = child.as_str().ok_or_else(|| {
                workflow_validation_error(format!("body.config.{key}"), "Expected string")
            })?;
            if !allowed.contains(&raw) {
                return Err(workflow_validation_error(
                    format!("body.config.{key}"),
                    "Invalid enum value",
                ));
            }
        }
        None => {
            if let Some(default_value) = default_value {
                if let Some(object) = value.as_object_mut() {
                    object.insert(key.to_string(), json!(default_value));
                }
            }
        }
    }
    Ok(())
}

fn parse_video_generate_request(body: &Value) -> Result<(String, Value), ApiError> {
    if !body.is_object() {
        return Err(workflow_validation_error("body", "Expected object"));
    }
    let scene_id = required_json_string(body, "sceneId", "body")?.to_string();
    workflow_optional_string(body, "projectId", "body")?;
    let mut config = workflow_required_object(body, "config", "body")?.clone();
    validate_video_generation_config(&mut config)?;
    Ok((scene_id, config))
}

pub(super) async fn api_asset_prop_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    validate_prop_generate_payload(&body)?;
    let prop = body.get("prop").expect("validated prop object");
    let prop_id = json_string(prop.get("id"), "");
    let prop_name = json_string(prop.get("name"), "");
    let prop_description = json_string(prop.get("description"), "无");
    let category = json_string(prop.get("category"), "prop");
    let style = json_string(body.get("style"), "保持项目默认画风");
    let asset_label = if category == "other" {
        "其他资产"
    } else {
        "道具资产"
    };
    let prompt = {
        let conn = db_connection(&state)?;
        render_configured_prompt(
            &conn,
            PROMPT_TEMPLATE_PROP_ASSET_GENERATION,
            &[
                ("assetLabel", asset_label),
                ("assetName", prop_name.as_str()),
                ("assetDescription", prop_description.as_str()),
                ("style", style.as_str()),
            ],
        )?
    };
    let context = model_log_context_from_workflow_body(&body, None, Some(prop_id.to_string()));
    let (image_url, provider, model_id) = CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
            run_workflow_image_model(
                &state,
                "character_portrait",
                &prompt,
                "1024x1024",
                &format!("prop_{}", prop_id),
                &[],
            )
            .await
        })
        .await
        .map_err(|error| {
            eprintln!("[AssetWorkflow/Prop] 图片模型调用失败: {}", error);
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error)
        })?;
    Ok(Json(json!({
      "success": true,
      "imageUrl": image_url,
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "usage": {
        "modelId": model_id,
        "modelProvider": provider,
        "fallback": false
      }
    })))
}

pub(super) async fn api_asset_reference_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    validate_reference_generate_payload(&body)?;
    let scene = body.get("scene").cloned().expect("validated scene object");
    let scene_id = body
        .get("scene")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("scene");
    let scene_title = json_string(scene.get("title"), "未命名场景");
    let scene_description = json_string(scene.get("description"), "");
    let location = scene
        .get("setting")
        .and_then(|value| value.get("location"))
        .and_then(Value::as_str)
        .unwrap_or("未指定地点");
    let time_of_day = scene
        .get("setting")
        .and_then(|value| value.get("timeOfDay"))
        .and_then(Value::as_str)
        .unwrap_or("day");
    let style = json_string(body.get("style"), "保持项目默认画风");
    let aspect_ratio = json_string(body.get("aspectRatio"), "16:9");
    let custom_prompt = body
        .get("regeneration")
        .and_then(|value| value.get("customPrompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut reference_sources = Vec::new();
    if body
        .get("consistencyReferenceImages")
        .and_then(Value::as_array)
        .is_some()
        || body.get("consistencyReferenceImage").is_some()
    {
        push_optional_reference_source(
            &mut reference_sources,
            body.get("consistencyReferenceImage"),
        );
        push_reference_source_array(
            &mut reference_sources,
            body.get("consistencyReferenceImages"),
        );
        push_optional_reference_source(
            &mut reference_sources,
            body.get("regeneration")
                .and_then(|value| value.get("referenceImage")),
        );
    } else {
        push_optional_reference_source(
            &mut reference_sources,
            body.get("regeneration")
                .and_then(|value| value.get("referenceImage")),
        );
        push_optional_reference_source(
            &mut reference_sources,
            body.get("consistencyReferenceImage"),
        );
        push_reference_source_array(
            &mut reference_sources,
            body.get("consistencyReferenceImages"),
        );
    }
    if custom_prompt.is_some() && reference_sources.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "环境二次生成需要参考图，请先生成或上传环境图后再试",
        ));
    }
    let reference_images = normalize_image_reference_sources(&state, reference_sources, 4).await?;
    let (model_id, workflow_model_options) = {
        let conn = db_connection(&state)?;
        let workflow_model_options = get_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?
            .unwrap_or_else(default_workflow_model_options);
        let model_id = resolve_runtime_workflow_model_id(&conn, "frame_generation")
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
        (model_id, workflow_model_options)
    };
    let provider = infer_model_provider_required(&model_id)?;
    let model_config = image_model_config(&provider, &model_id);
    let panorama_source =
        resolve_panorama_source_profile(&workflow_model_options, model_config.as_ref());
    let source_spec = build_panorama_source_prompt_context(&panorama_source, &aspect_ratio);
    if panorama_source.fallback_applied {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "当前流程模型「{}」不支持环境源图比例 {}（{}）。请在流程模型中改用支持该比例的图片模型，或调整环境源图格式后重试。",
                model_id, panorama_source.aspect_ratio, panorama_source.mode_label
            ),
        ));
    }
    let setting = build_scene_setting_text(&scene);
    let environment_consistency = build_environment_consistency_text(&body);
    let camera_note = scene
        .get("cameraNote")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("无");
    let custom_prompt_text = custom_prompt.unwrap_or("无");
    let prompt = {
        let conn = db_connection(&state)?;
        render_configured_prompt(
            &conn,
            PROMPT_TEMPLATE_ENVIRONMENT_REFERENCE_GENERATION,
            &[
                ("sceneTitle", scene_title.as_str()),
                ("sceneDescription", scene_description.as_str()),
                ("setting", setting.as_str()),
                ("location", location),
                ("timeOfDay", time_of_day),
                ("style", style.as_str()),
                ("sourceSpec", source_spec.as_str()),
                ("aspectRatio", source_spec.as_str()),
                ("environmentConsistency", environment_consistency.as_str()),
                ("cameraNote", camera_note),
                ("customPrompt", custom_prompt_text),
            ],
        )?
    };
    let context = model_log_context_from_workflow_body(&body, Some(scene_id.to_string()), None);
    let (image_url, provider, model_id) = CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async {
            run_workflow_image_model(
                &state,
                "frame_generation",
                &prompt,
                &panorama_source.size,
                &format!("env_{}", scene_id),
                &reference_images,
            )
            .await
        })
        .await
        .map_err(|error| {
            eprintln!("[AssetWorkflow/Reference] 图片模型调用失败: {}", error);
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error)
        })?;
    assert_generated_environment_image_size(&state, &image_url, &panorama_source).await?;
    Ok(Json(json!({
      "success": true,
      "referenceImage": image_url,
      "mimeType": "image/png",
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "usage": {
        "modelId": model_id,
        "modelProvider": provider,
        "modelDecision": "workflow-image-model",
        "aspectRatio": aspect_ratio,
        "sourceMode": panorama_source.mode,
        "sourceAspectRatio": panorama_source.aspect_ratio,
        "sourceSize": panorama_source.size,
        "sourceAspectRatioFallback": panorama_source.fallback_applied,
        "fallback": false,
        "referenceImageUsed": !reference_images.is_empty()
      }
    })))
}

pub(super) async fn api_asset_scene_description_refinement(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_scene_refinement_payload(&body)?;
    let scene = body.get("scene").cloned().expect("validated scene object");
    let user_message = json_string(body.get("userMessage"), "");
    let original_description = json_string(scene.get("description"), "");
    if user_message.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "用户改写要求不能为空",
        ));
    }
    let duration_hint = scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(8.0);
    let prompt = {
        let conn = db_connection(&state)?;
        build_scene_description_refinement_prompt(&conn, &body)?
    };
    let (model_text, provider, model_id) =
        run_workflow_text_model(&state, "scene_description_refinement", &prompt)
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    format!("场景描述润色模型调用失败: {}", error),
                )
            })?;
    let value = extract_json_from_text(&model_text).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("场景描述润色模型 JSON 解析失败: {}", error),
        )
    })?;
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "场景描述润色模型 JSON 缺少 description",
            )
        })?;
    let refined =
        normalize_refined_scene_description(description, &original_description, duration_hint);
    if refined.chars().count() < 12 {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "场景描述润色模型结果过短",
        ));
    }

    Ok(Json(json!({
      "success": true,
      "data": {
        "description": refined
      },
      "usage": {
        "modelProvider": provider,
        "modelId": model_id,
        "fallback": false
      }
    })))
}

pub(super) async fn api_asset_video_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    validate_video_generate_payload(&body)?;
    let scene = body.get("scene").cloned().expect("validated scene object");
    let scene_id = json_string(scene.get("id"), "");
    let project_id = body.get("projectId").and_then(trimmed_json_string);
    let aspect_ratio = json_string(body.get("aspectRatio"), "16:9");
    let task_id = format!("video_{}", Uuid::new_v4().simple());
    let (model_id, workflow_model_options) = {
        let conn = db_connection(&state)?;
        let model_id = resolve_runtime_workflow_model_id(&conn, "video_generation")
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
        let workflow_model_options = get_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?
            .unwrap_or_else(default_workflow_model_options);
        (model_id, workflow_model_options)
    };
    let provider = infer_model_provider_required(&model_id)?;
    let mut config = json!({
      "duration": scene.get("duration").cloned().unwrap_or_else(|| json!(8)),
      "aspectRatio": aspect_ratio,
      "modelId": model_id,
      "provider": provider,
      "references": body.get("references").cloned().expect("validated references object")
    });
    if let Some(prompt) = body.get("prompt").and_then(trimmed_json_string) {
        config["prompt"] = json!(prompt);
    }
    if let Some(style) = body.get("style").and_then(trimmed_json_string) {
        config["style"] = json!(style);
    }
    if let Some(negative_prompt) = body.get("negativePrompt").and_then(trimmed_json_string) {
        config["negativePrompt"] = json!(negative_prompt);
    }
    apply_scene_video_reference_inputs(&mut config, &scene, &provider, &model_id);
    apply_workflow_video_generation_options(
        &mut config,
        &workflow_model_options,
        &provider,
        &model_id,
    );
    let model_id_for_voice = config
        .get("modelId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    inject_scene_voice_reference(
        &state,
        &scene_id,
        &scene,
        &mut config,
        &provider,
        &model_id_for_voice,
    )?;
    let prompt = {
        let conn = db_connection(&state)?;
        build_video_prompt_from_scene(&conn, &scene, &config)?
    };
    config["prompt"] = json!(prompt);
    let provider_name = config
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let is_remote_video = matches!(
        provider_name.as_str(),
        "qwen" | "volcengine" | "kling" | "gemini"
    );
    if !is_remote_video {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "不支持的视频模型提供商: {}（modelId: {}）",
                provider_name.as_str(),
                config.get("modelId").and_then(Value::as_str).unwrap_or("")
            ),
        ));
    }

    let context = model_log_context_for_video_task(&state, project_id, &scene_id, &task_id)?;
    CURRENT_MODEL_LOG_CONTEXT
        .scope(context.clone(), async {
            insert_pending_video_task(
                &state,
                &task_id,
                &scene_id,
                &config,
                &json!({
                  "provider": provider_name,
                  "modelId": config["modelId"],
                  "fallback": false
                }),
            )
        })
        .await?;
    let model_id = config
        .get("modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "视频模型未配置"))?
        .to_string();
    if provider_name == "qwen" {
        spawn_video_task_background(
            context.clone(),
            run_qwen_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else if provider_name == "volcengine" {
        spawn_video_task_background(
            context.clone(),
            run_volcengine_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else if provider_name == "kling" {
        spawn_video_task_background(
            context.clone(),
            run_kling_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else {
        spawn_video_task_background(
            context,
            run_gemini_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    }

    Ok(Json(json!({
      "success": true,
      "taskId": task_id,
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "debug": {
        "actualModelId": config["modelId"],
        "provider": config["provider"],
        "fallback": false,
        "fallbackReason": Value::Null
      }
    })))
}

pub(super) async fn api_video_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    let (scene_id, mut config) = parse_video_generate_request(&body)?;
    let project_id = body.get("projectId").and_then(trimmed_json_string);
    let task_id = format!("video_{}", Uuid::new_v4().simple());
    let configured_model = match config
        .get("modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    {
        Some(model_id) => model_id,
        None => resolve_workflow_model_id(&state, "video_generation")?,
    };
    let provider = config
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| infer_model_provider(&configured_model).unwrap_or_default());
    if provider.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("无法识别模型提供商: {}", configured_model),
        ));
    }
    if let Some(object) = config.as_object_mut() {
        object.insert("modelId".to_string(), json!(configured_model));
        object.insert("provider".to_string(), json!(provider));
    }
    let provider_name = config
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let is_remote_video = matches!(
        provider_name.as_str(),
        "qwen" | "volcengine" | "kling" | "gemini"
    );
    if !is_remote_video {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "不支持的视频模型提供商: {}（modelId: {}）",
                provider_name.as_str(),
                config.get("modelId").and_then(Value::as_str).unwrap_or("")
            ),
        ));
    }
    let model_id_for_voice = config
        .get("modelId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let scene_for_voice = body.get("scene").cloned().unwrap_or_else(|| json!({}));
    inject_scene_voice_reference(
        &state,
        &scene_id,
        &scene_for_voice,
        &mut config,
        &provider_name,
        &model_id_for_voice,
    )?;

    let context = model_log_context_for_video_task(&state, project_id, &scene_id, &task_id)?;
    CURRENT_MODEL_LOG_CONTEXT
        .scope(context.clone(), async {
            insert_pending_video_task(
                &state,
                &task_id,
                &scene_id,
                &config,
                &json!({
                  "provider": provider_name,
                  "modelId": config["modelId"],
                  "fallback": false
                }),
            )
        })
        .await?;
    let model_id = config
        .get("modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "视频模型未配置"))?
        .to_string();
    if provider_name == "qwen" {
        spawn_video_task_background(
            context.clone(),
            run_qwen_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else if provider_name == "volcengine" {
        spawn_video_task_background(
            context.clone(),
            run_volcengine_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else if provider_name == "kling" {
        spawn_video_task_background(
            context.clone(),
            run_kling_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    } else {
        spawn_video_task_background(
            context,
            run_gemini_video_task_background(
                state.clone(),
                task_id.clone(),
                scene_id.clone(),
                model_id,
                config.clone(),
            ),
        );
    }

    Ok(Json(json!({
      "success": true,
      "taskId": task_id,
      "message": "视频生成任务已启动",
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1),
      "debug": {
        "actualModelId": config["modelId"],
        "provider": config["provider"],
        "fallback": false,
        "fallbackReason": Value::Null
      }
    })))
}

pub(super) async fn api_video_status(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    type VideoTaskStatusRow = (
        String,
        Option<String>,
        String,
        i64,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
    );
    let load_task = |conn: &rusqlite::Connection| -> Result<Option<VideoTaskStatusRow>, ApiError> {
        conn.query_row(
                "SELECT id, scene_id, status, progress, error, video_data, created_at, updated_at, metadata
                 FROM video_tasks WHERE id = ?1 LIMIT 1",
                params![id.as_str()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?
                    ))
                },
            )
            .optional()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
    };

    let mut row = load_task(&conn)?;

    if let Some((task_id, scene_id, status, _, _, _, _, _, metadata)) = row.as_ref() {
        let parsed_metadata = metadata
            .as_ref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .unwrap_or_else(|| json!({}));
        refresh_tracked_video_task(
            &state,
            task_id,
            scene_id.as_deref().unwrap_or(""),
            status,
            &parsed_metadata,
        )
        .await;
        if status == "processing" {
            row = load_task(&conn)?;
        }
    }

    let (task_id, scene_id, status, progress, error, video_data, created_at, updated_at, metadata) =
        row.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, format!("未找到任务: {}", id)))?;
    let parsed_metadata = metadata
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({}));

    Ok(Json(json!({
      "success": true,
      "task": {
        "id": task_id,
        "sceneId": scene_id,
        "status": status,
        "progress": progress,
        "error": error,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "result": if video_data.as_ref().is_some_and(|value| !value.trim().is_empty()) {
          json!({
            "id": format!("generated_{}", id),
            "sceneId": scene_id,
            "videoData": video_data,
            "lastFrame": parsed_metadata.get("lastFrame").cloned().unwrap_or(Value::Null),
            "metadata": parsed_metadata,
            "createdAt": created_at
          })
        } else {
          Value::Null
        }
      }
    })))
}

fn resolve_video_source_path(state: &BackendState, raw: &str) -> Option<PathBuf> {
    if let Some(path) =
        resolve_api_file_path(raw, "/api/video/file/", &state.public_dir.join("videos"))
    {
        return Some(path);
    }
    if let Some(path) = resolve_api_file_path(raw, "/videos/", &state.public_dir.join("videos")) {
        return Some(path);
    }
    if raw.starts_with('/') {
        let safe = sanitize_rel_path(raw)?;
        return Some(state.public_dir.join(safe));
    }
    None
}

fn ffmpeg_binary() -> String {
    std::env::var("FFMPEG_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

fn run_ffmpeg(args: &[String]) -> Result<(), ApiError> {
    let output = Command::new(ffmpeg_binary())
        .args(args)
        .output()
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("启动 FFmpeg 失败: {}", error),
            )
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("FFmpeg 执行失败: {}", truncate_for_error(&stderr, 500)),
    ))
}

fn escape_ffmpeg_concat_path(path: &FsPath) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('\'', "'\\''")
}

fn ass_time(seconds: f64) -> String {
    let safe = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.0
    };
    let total_centiseconds = (safe * 100.0).floor() as u64;
    let centiseconds = total_centiseconds % 100;
    let total_seconds = total_centiseconds / 100;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    format!(
        "{}:{:02}:{:02}.{:02}",
        hours, minutes, seconds, centiseconds
    )
}

fn sanitize_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "")
        .replace('}', "")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn build_subtitle_ass(subtitles: &[Value]) -> String {
    let mut content = String::from(
        "[Script Info]\nTitle: Generated Subtitles\nScriptType: v4.00+\nCollisions: Normal\nPlayDepth: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );
    for subtitle in subtitles {
        let text = subtitle
            .get("text")
            .and_then(Value::as_str)
            .map(sanitize_ass_text)
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        let start = subtitle
            .get("startTime")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let end = subtitle
            .get("endTime")
            .and_then(Value::as_f64)
            .unwrap_or(start + 3.0)
            .max(start + 0.1);
        content.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            ass_time(start),
            ass_time(end),
            text
        ));
    }
    content
}

fn build_scene_subtitles(scenes: &[Value]) -> Vec<Value> {
    let mut subtitles = Vec::new();
    let mut subtitle_time = 0.0;
    for scene in scenes {
        let duration = scene
            .get("duration")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0);
        let description = scene
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("");
        let dialogue_lines = extract_description_dialogues(description);
        if !dialogue_lines.is_empty() {
            let line_duration = if duration > 0.0 {
                (duration / dialogue_lines.len() as f64).max(1.0)
            } else {
                3.0
            };
            for (index, (character, text)) in dialogue_lines.into_iter().enumerate() {
                let start = subtitle_time + index as f64 * line_duration;
                let end = (start + line_duration).min(subtitle_time + duration.max(line_duration));
                subtitles.push(json!({
                  "text": format!("{}: {}", if character.is_empty() { "角色" } else { character.as_str() }, text),
                  "startTime": start,
                  "endTime": end
                }));
            }
        }
        subtitle_time += duration;
    }
    subtitles
}

async fn materialize_media_source(
    state: &BackendState,
    raw: &str,
    temp_dir: &FsPath,
    filename: &str,
    max_bytes: usize,
) -> Result<PathBuf, ApiError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "媒体地址为空"));
    }
    if let Some(path) = resolve_video_source_path(state, trimmed) {
        if path.exists() {
            return Ok(path);
        }
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("本地媒体不存在: {}", trimmed),
        ));
    }
    if is_http_url(trimmed) || trimmed.starts_with("data:") {
        let (bytes, mime) = resolve_source_bytes(state, trimmed, max_bytes).await?;
        let ext = infer_extension_from_mime(mime.as_deref().unwrap_or(""), "mp4");
        let output_path = temp_dir.join(format!("{}.{}", sanitize_file_component(filename), ext));
        write_file_bytes(&output_path, &bytes)?;
        return Ok(output_path);
    }
    let path = PathBuf::from(trimmed);
    if path.exists() {
        Ok(path)
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("媒体文件不存在: {}", trimmed),
        ))
    }
}

fn copy_or_concat_videos(
    clips: &[PathBuf],
    output_path: &FsPath,
    temp_dir: &FsPath,
) -> Result<(), ApiError> {
    if clips.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有有效的视频片段"));
    }
    if clips.len() == 1 {
        fs::copy(&clips[0], output_path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        return Ok(());
    }
    let list_path = temp_dir.join("concat_list.txt");
    let list_content = clips
        .iter()
        .map(|path| format!("file '{}'", escape_ffmpeg_concat_path(path)))
        .collect::<Vec<_>>()
        .join("\n");
    write_file_bytes(&list_path, list_content.as_bytes())?;
    run_ffmpeg(&[
        "-y".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        list_path.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        output_path.to_string_lossy().to_string(),
    ])
}

fn add_fade_transition(
    input_path: &FsPath,
    output_path: &FsPath,
    duration: f64,
) -> Result<(), ApiError> {
    let safe_duration = if duration.is_finite() {
        duration.max(0.0)
    } else {
        0.5
    };
    run_ffmpeg(&[
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vf".to_string(),
        format!(
            "fade=t=in:st=0:d={0},fade=t=out:st=end:d={0}",
            safe_duration
        ),
        "-af".to_string(),
        format!(
            "afade=t=in:st=0:d={0},afade=t=out:st=end:d={0}",
            safe_duration
        ),
        output_path.to_string_lossy().to_string(),
    ])
}

fn add_subtitles_to_video(
    input_path: &FsPath,
    output_path: &FsPath,
    subtitles: &[Value],
    temp_dir: &FsPath,
) -> Result<(), ApiError> {
    let ass_path = temp_dir.join("subtitles.ass");
    write_file_bytes(&ass_path, build_subtitle_ass(subtitles).as_bytes())?;
    run_ffmpeg(&[
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-vf".to_string(),
        format!("ass={}", ass_path.to_string_lossy().replace(':', "\\:")),
        output_path.to_string_lossy().to_string(),
    ])
}

fn mix_bgm(
    input_path: &FsPath,
    bgm_path: &FsPath,
    output_path: &FsPath,
    volume: f64,
) -> Result<(), ApiError> {
    let safe_volume = if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        0.3
    };
    run_ffmpeg(&[
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
        "-i".to_string(),
        bgm_path.to_string_lossy().to_string(),
        "-filter_complex".to_string(),
        format!(
            "[0:a]volume=1[a0];[1:a]volume={}[a1];[a0][a1]amix=inputs=2:duration=first[aout]",
            safe_volume
        ),
        "-map".to_string(),
        "0:v".to_string(),
        "-map".to_string(),
        "[aout]".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        output_path.to_string_lossy().to_string(),
    ])
}

fn validate_merge_video_scene(scene: &Value, path: &str) -> Result<(), ApiError> {
    if !scene.is_object() {
        return Err(workflow_validation_error(path, "Expected object"));
    }
    required_json_string(scene, "id", path)?;
    required_json_string(scene, "videoUrl", path)?;
    let duration = scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| workflow_validation_error(format!("{path}.duration"), "Expected number"))?;
    if duration < 0.0 {
        return Err(workflow_validation_error(
            format!("{path}.duration"),
            "Number must be greater than or equal to 0",
        ));
    }
    workflow_optional_string(scene, "title", path)?;
    workflow_optional_string(scene, "description", path)?;
    Ok(())
}

fn validate_video_merge_options(options: &Value) -> Result<(), ApiError> {
    if !options.is_object() {
        return Err(workflow_validation_error("body.options", "Expected object"));
    }
    workflow_optional_bool(options, "addSubtitles", "body.options")?;
    if let Some(output_format) = options.get("outputFormat").filter(|value| !value.is_null()) {
        let raw = output_format.as_str().ok_or_else(|| {
            workflow_validation_error("body.options.outputFormat", "Expected string")
        })?;
        if !matches!(raw, "mp4" | "webm") {
            return Err(workflow_validation_error(
                "body.options.outputFormat",
                "Invalid enum value",
            ));
        }
    }
    if let Some(transition) = options.get("transition").filter(|value| !value.is_null()) {
        if !transition.is_object() {
            return Err(workflow_validation_error(
                "body.options.transition",
                "Expected object",
            ));
        }
        if let Some(transition_type) = transition.get("type").filter(|value| !value.is_null()) {
            let raw = transition_type.as_str().ok_or_else(|| {
                workflow_validation_error("body.options.transition.type", "Expected string")
            })?;
            if !matches!(raw, "fade" | "dissolve" | "wipe" | "none") {
                return Err(workflow_validation_error(
                    "body.options.transition.type",
                    "Invalid enum value",
                ));
            }
        }
        workflow_optional_number(transition, "duration", "body.options.transition")?;
    }
    if let Some(bgm) = options.get("bgm").filter(|value| !value.is_null()) {
        if !bgm.is_object() {
            return Err(workflow_validation_error(
                "body.options.bgm",
                "Expected object",
            ));
        }
        required_json_string(bgm, "url", "body.options.bgm")?;
        if let Some(volume) = bgm.get("volume").filter(|value| !value.is_null()) {
            let raw = volume
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| {
                    workflow_validation_error("body.options.bgm.volume", "Expected number")
                })?;
            if !(0.0..=1.0).contains(&raw) {
                return Err(workflow_validation_error(
                    "body.options.bgm.volume",
                    "Number must be between 0 and 1",
                ));
            }
        }
    }
    Ok(())
}

fn parse_video_merge_request(body: &Value) -> Result<(String, Vec<Value>), ApiError> {
    if !body.is_object() {
        return Err(workflow_validation_error("body", "Expected object"));
    }
    let project_id = required_json_string(body, "projectId", "body")?.to_string();
    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| workflow_validation_error("body.scenes", "Expected array"))?;
    if scenes.is_empty() {
        return Err(workflow_validation_error(
            "body.scenes",
            "Array must contain at least 1 item",
        ));
    }
    for (index, scene) in scenes.iter().enumerate() {
        validate_merge_video_scene(scene, &format!("body.scenes.{index}"))?;
    }
    if let Some(options) = body.get("options").filter(|value| !value.is_null()) {
        validate_video_merge_options(options)?;
    }
    Ok((project_id, scenes.clone()))
}

fn ensure_project_exists(state: &BackendState, project_id: &str) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let exists = conn
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 LIMIT 1",
            params![project_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .is_some();
    if !exists {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "项目不存在"));
    }
    Ok(())
}

pub(super) async fn api_video_merge(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    let (project_id, scenes) = parse_video_merge_request(&body)?;
    ensure_project_exists(&state, &project_id)?;

    let temp_dir = std::env::temp_dir().join(format!(
        "playlet_merge_{}_{}",
        Utc::now().timestamp_millis(),
        Uuid::new_v4().simple()
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let result = async {
        let mut clips: Vec<PathBuf> = Vec::new();
        for (index, scene) in scenes.iter().enumerate() {
            let video_url = scene
                .get("videoUrl")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if video_url.is_empty() {
                continue;
            }
            let path = materialize_media_source(
                &state,
                video_url,
                &temp_dir,
                &format!("scene_{}", index),
                500 * 1024 * 1024,
            )
            .await?;
            clips.push(path);
        }

        if clips.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有有效的视频片段"));
        }

        let concat_output = temp_dir.join("concat.mp4");
        copy_or_concat_videos(&clips, &concat_output, &temp_dir)?;
        let mut current_path = concat_output;

        let options = body.get("options").cloned().unwrap_or_else(|| json!({}));
        if let Some(transition) = options.get("transition") {
            let transition_type = transition
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("fade");
            if transition_type != "none" {
                let transition_output = temp_dir.join("transition.mp4");
                let transition_duration = transition
                    .get("duration")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                add_fade_transition(&current_path, &transition_output, transition_duration)?;
                current_path = transition_output;
            }
        }

        if options
            .get("addSubtitles")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let subtitles = build_scene_subtitles(&scenes);
            if !subtitles.is_empty() {
                let subtitle_output = temp_dir.join("subtitle.mp4");
                add_subtitles_to_video(&current_path, &subtitle_output, &subtitles, &temp_dir)?;
                current_path = subtitle_output;
            }
        }

        if let Some(bgm) = options.get("bgm") {
            let bgm_url = bgm
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if !bgm_url.is_empty() {
                let bgm_path =
                    materialize_media_source(&state, bgm_url, &temp_dir, "bgm", 100 * 1024 * 1024)
                        .await?;
                let bgm_output = temp_dir.join("bgm.mp4");
                let volume = bgm.get("volume").and_then(Value::as_f64).unwrap_or(0.3);
                mix_bgm(&current_path, &bgm_path, &bgm_output, volume)?;
                current_path = bgm_output;
            }
        }

        let output_filename = format!("{}_final.mp4", sanitize_file_component(&project_id));
        let final_path = state.public_dir.join("videos").join(&output_filename);
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
        }
        fs::copy(&current_path, &final_path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let size = fs::metadata(&final_path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .len();
        Ok::<(String, u64, usize), ApiError>((
            format!("/api/video/file/{}", output_filename),
            size,
            clips.len(),
        ))
    }
    .await;

    let _ = fs::remove_dir_all(&temp_dir);
    let (final_url, size, clip_count) = result?;
    let duration = scenes
        .iter()
        .map(|item| item.get("duration").and_then(Value::as_f64).unwrap_or(0.0))
        .sum::<f64>()
        .max(2.0);

    Ok(Json(json!({
      "success": true,
      "data": {
        "videoUrl": final_url,
        "duration": duration,
        "size": size,
        "sceneCount": clip_count
      },
      "latencyMs": (Utc::now().timestamp_millis() - start).max(1)
    })))
}

fn to_microseconds(value: Option<f64>, fallback_seconds: f64) -> i64 {
    let seconds = value
        .filter(|item| item.is_finite() && *item > 0.0)
        .unwrap_or(fallback_seconds);
    ((seconds * 1_000_000.0).round() as i64).max(100_000)
}

fn create_draft_guid() -> String {
    Uuid::new_v4().to_string().to_ascii_uppercase()
}

fn create_draft_entity_id() -> String {
    Uuid::new_v4().simple().to_string()
}

fn resolve_canvas(aspect_ratio: &str) -> (i64, i64) {
    match aspect_ratio {
        "9:16" => (1080, 1920),
        "1:1" => (1080, 1080),
        _ => (1920, 1080),
    }
}

fn order_scenes_by_ids(scenes: &[Value], ids: &[Value]) -> Vec<Value> {
    let mut ordered = Vec::new();
    let mut consumed = HashSet::<String>::new();
    for id in ids {
        let Some(id) = id.as_str() else {
            continue;
        };
        if let Some(scene) = scenes
            .iter()
            .find(|scene| scene.get("id").and_then(Value::as_str) == Some(id))
        {
            ordered.push(scene.clone());
            consumed.insert(id.to_string());
        }
    }
    for scene in scenes {
        let id = scene.get("id").and_then(Value::as_str).unwrap_or("");
        if !consumed.contains(id) {
            ordered.push(scene.clone());
        }
    }
    ordered
}

fn validate_jianying_export_payload(body: &Value) -> Result<&Vec<Value>, ApiError> {
    optional_export_string(body, "projectName", "body")?;
    if let Some(aspect_ratio) = body.get("aspectRatio").filter(|value| !value.is_null()) {
        let raw = aspect_ratio
            .as_str()
            .ok_or_else(|| export_validation_error("aspectRatio", "Expected string"))?;
        if !matches!(raw, "16:9" | "9:16" | "1:1") {
            return Err(export_validation_error("aspectRatio", "Invalid enum value"));
        }
    }
    if let Some(scene_order) = body.get("sceneOrder").filter(|value| !value.is_null()) {
        let items = scene_order
            .as_array()
            .ok_or_else(|| export_validation_error("sceneOrder", "Expected array"))?;
        for (index, item) in items.iter().enumerate() {
            if !item.is_string() {
                return Err(export_validation_error(
                    format!("sceneOrder.{index}"),
                    "Expected string",
                ));
            }
        }
    }

    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .ok_or_else(|| export_validation_error("scenes", "Expected array"))?;
    if scenes.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有可导出的场景"));
    }
    for (index, scene) in scenes.iter().enumerate() {
        let path = format!("scenes.{index}");
        match scene.get("id") {
            Some(Value::String(_)) => {}
            _ => {
                return Err(export_validation_error(
                    format!("{path}.id"),
                    "Expected string",
                ));
            }
        }
        match scene.get("videoUrl") {
            Some(Value::String(_)) => {}
            _ => {
                return Err(export_validation_error(
                    format!("{path}.videoUrl"),
                    "Expected string",
                ));
            }
        }
        optional_export_string(scene, "title", &path)?;
        optional_export_string(scene, "description", &path)?;
        optional_export_number(scene, "duration", &path)?;
        optional_export_string(scene, "narration", &path)?;
    }

    if let Some(options) = body.get("options").filter(|value| !value.is_null()) {
        if !options.is_object() {
            return Err(export_validation_error("options", "Expected object"));
        }
        optional_export_bool(options, "addSubtitles", "options")?;
        if let Some(transition) = options.get("transition").filter(|value| !value.is_null()) {
            if !transition.is_object() {
                return Err(export_validation_error(
                    "options.transition",
                    "Expected object",
                ));
            }
            if let Some(transition_type) = transition.get("type").filter(|value| !value.is_null()) {
                let raw = transition_type.as_str().ok_or_else(|| {
                    export_validation_error("options.transition.type", "Expected string")
                })?;
                if !matches!(raw, "fade" | "dissolve" | "wipe" | "none") {
                    return Err(export_validation_error(
                        "options.transition.type",
                        "Invalid enum value",
                    ));
                }
            }
            optional_export_number(transition, "duration", "options.transition")?;
        }
        if let Some(bgm) = options.get("bgm").filter(|value| !value.is_null()) {
            if !bgm.is_object() {
                return Err(export_validation_error("options.bgm", "Expected object"));
            }
            match bgm.get("url") {
                Some(Value::String(_)) => {}
                _ => {
                    return Err(export_validation_error(
                        "options.bgm.url",
                        "Expected string",
                    ));
                }
            }
            optional_export_number(bgm, "volume", "options.bgm")?;
            if let Some(volume) = bgm.get("volume").and_then(Value::as_f64) {
                if !(0.0..=1.0).contains(&volume) {
                    return Err(export_validation_error(
                        "options.bgm.volume",
                        "Number must be between 0 and 1",
                    ));
                }
            }
        }
    }

    Ok(scenes)
}

fn resolve_jianying_media_path(state: &BackendState, raw: &str) -> String {
    let normalized = raw.trim();
    if normalized.is_empty() || is_http_url(normalized) || normalized.starts_with("data:") {
        return normalized.to_string();
    }
    if let Some(path) = resolve_video_source_path(state, normalized) {
        return path.to_string_lossy().to_string();
    }
    if normalized.starts_with('/') {
        if let Some(safe) = sanitize_rel_path(normalized) {
            return state.public_dir.join(safe).to_string_lossy().to_string();
        }
    }
    normalized.to_string()
}

fn media_path_status(path: &str) -> &'static str {
    if path.trim().is_empty() {
        "missing"
    } else if path.starts_with("data:") {
        "inline"
    } else if is_http_url(path) {
        "remote"
    } else if FsPath::new(path).exists() {
        "ok"
    } else {
        "missing"
    }
}

fn path_file_name(path: &str, fallback: &str) -> String {
    FsPath::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn create_speed_material(id: &str) -> Value {
    json!({
      "curve_speed": Value::Null,
      "id": id,
      "mode": 0,
      "speed": 1,
      "type": "speed"
    })
}

fn create_segment_base(
    id: &str,
    material_id: &str,
    speed_material_id: &str,
    start: i64,
    duration: i64,
    volume: f64,
) -> Value {
    json!({
      "enable_adjust": true,
      "enable_color_correct_adjust": false,
      "enable_color_curves": true,
      "enable_color_match_adjust": false,
      "enable_color_wheels": true,
      "enable_lut": true,
      "enable_smart_color_adjust": false,
      "last_nonzero_volume": volume.max(0.0),
      "reverse": false,
      "track_attribute": 0,
      "track_render_index": 0,
      "visible": true,
      "id": id,
      "material_id": material_id,
      "target_timerange": { "start": start, "duration": duration },
      "source_timerange": { "start": 0, "duration": duration },
      "speed": 1,
      "volume": volume.max(0.0),
      "extra_material_refs": [speed_material_id],
      "is_tone_modify": false,
      "common_keyframes": [],
      "keyframe_refs": []
    })
}

fn create_text_material_content(text: &str) -> String {
    json!({
      "styles": [{
        "fill": {
          "alpha": 1.0,
          "content": {
            "render_type": "solid",
            "solid": { "alpha": 1.0, "color": [1.0, 1.0, 1.0] }
          }
        },
        "range": [0, text.chars().count()],
        "size": 8,
        "bold": false,
        "italic": false,
        "underline": false,
        "strokes": []
      }],
      "text": text
    })
    .to_string()
}

fn resolve_scene_subtitle_lines(scene: &Value) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(description) = scene.get("description").and_then(Value::as_str) {
        lines.extend(extract_description_dialogues(description).into_iter().map(
            |(character, text)| {
                if character.is_empty() {
                    text
                } else {
                    format!("{}：{}", character, text)
                }
            },
        ));
    }
    if lines.is_empty() {
        if let Some(narration) = scene
            .get("narration")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            lines.push(narration.to_string());
        }
    }
    lines.into_iter().take(8).collect()
}

fn create_empty_materials() -> Value {
    let keys = [
        "ai_translates",
        "audio_balances",
        "audio_effects",
        "audio_fades",
        "audio_track_indexes",
        "audios",
        "beats",
        "canvases",
        "chromas",
        "color_curves",
        "digital_humans",
        "drafts",
        "effects",
        "flowers",
        "green_screens",
        "handwrites",
        "hsl",
        "images",
        "log_color_wheels",
        "loudnesses",
        "manual_deformations",
        "masks",
        "material_animations",
        "material_colors",
        "multi_language_refs",
        "placeholders",
        "plugin_effects",
        "primary_color_wheels",
        "realtime_denoises",
        "shapes",
        "smart_crops",
        "smart_relights",
        "sound_channel_mappings",
        "speeds",
        "stickers",
        "tail_leaders",
        "text_templates",
        "texts",
        "time_marks",
        "transitions",
        "video_effects",
        "video_trackings",
        "videos",
        "vocal_beautifys",
        "vocal_separations",
    ];
    let mut object = serde_json::Map::new();
    for key in keys {
        object.insert(key.to_string(), Value::Array(Vec::new()));
    }
    Value::Object(object)
}

fn create_draft_content_template(
    id: &str,
    name: &str,
    width: i64,
    height: i64,
    now_micros: i64,
) -> Value {
    json!({
      "canvas_config": { "height": height, "ratio": "original", "width": width },
      "color_space": 0,
      "config": {
        "adjust_max_index": 1,
        "attachment_info": [],
        "combination_max_index": 1,
        "export_range": Value::Null,
        "maintrack_adsorb": true,
        "material_save_mode": 0,
        "multi_language_current": "none",
        "multi_language_list": [],
        "multi_language_main": "none",
        "multi_language_mode": "none",
        "original_sound_last_index": 1,
        "record_audio_last_index": 1,
        "sticker_max_index": 1,
        "subtitle_keywords_config": Value::Null,
        "subtitle_sync": true,
        "video_mute": false
      },
      "cover": Value::Null,
      "create_time": now_micros,
      "duration": 0,
      "extra_info": Value::Null,
      "fps": 30,
      "free_render_index_mode_on": true,
      "group_container": [],
      "id": id,
      "keyframe_graphs": [],
      "materials": create_empty_materials(),
      "mutable_config": Value::Null,
      "name": name,
      "new_version": "88.0.0",
      "platform": { "app_id": 3704, "app_source": "lv", "app_version": "5.9.0", "os": "windows" },
      "relationships": [],
      "render_index_track_mode_on": true,
      "retouch_cover": Value::Null,
      "source": "",
      "static_cover_image_path": "",
      "tracks": [],
      "update_time": now_micros,
      "version": 360000
    })
}

fn create_draft_meta_info(
    draft_id: &str,
    draft_name: &str,
    duration: i64,
    now_micros: i64,
    material_count: usize,
) -> Value {
    json!({
      "cloud_package_completed_time": "",
      "draft_cloud_capcut_purchase_info": "",
      "draft_cloud_last_action_download": false,
      "draft_cloud_materials": [],
      "draft_cloud_purchase_info": "",
      "draft_cloud_template_id": "",
      "draft_cloud_tutorial_info": "",
      "draft_cloud_videocut_purchase_info": "",
      "draft_cover": "",
      "draft_deeplink_url": "",
      "draft_enterprise_info": { "draft_enterprise_extra": "", "draft_enterprise_id": "", "draft_enterprise_name": "", "enterprise_material": [] },
      "draft_fold_path": "",
      "draft_id": draft_id,
      "draft_is_ai_packaging_used": false,
      "draft_is_ai_shorts": false,
      "draft_is_ai_translate": false,
      "draft_is_article_video_draft": false,
      "draft_is_from_deeplink": "false",
      "draft_is_invisible": false,
      "draft_materials": [{"type":0,"value":[]},{"type":1,"value":[]},{"type":2,"value":[]},{"type":3,"value":[]},{"type":6,"value":[]},{"type":7,"value":[]},{"type":8,"value":[]}],
      "draft_materials_copied_info": [],
      "draft_name": draft_name,
      "draft_new_version": "",
      "draft_removable_storage_device": "",
      "draft_root_path": "",
      "draft_segment_extra_info": [],
      "draft_timeline_materials_size_": material_count,
      "draft_type": "",
      "tm_draft_cloud_completed": "",
      "tm_draft_cloud_modified": 0,
      "tm_draft_create": now_micros,
      "tm_draft_modified": now_micros,
      "tm_draft_removed": 0,
      "tm_duration": duration
    })
}

fn transition_preset(
    transition_type: &str,
) -> Option<(&'static str, &'static str, &'static str, bool)> {
    match transition_type {
        "fade" => Some((
            "闪黑",
            "6724239388189921806",
            "3bca53e9f3dfa2c184fbee96438ea097",
            false,
        )),
        "dissolve" => Some((
            "叠化",
            "6724845717472416269",
            "2d641adc4bb63e37e3a0067d8c8cc3c3",
            true,
        )),
        "wipe" => Some((
            "向左擦除",
            "6724849999336706573",
            "316c2a1c1783f51505c793b13381b445",
            true,
        )),
        _ => None,
    }
}

fn build_jianying_readme(project_name: &str, warnings: &[String]) -> String {
    let mut lines = vec![
        "剪映专业版工程导出说明".to_string(),
        "".to_string(),
        format!("项目名：{}", project_name),
        "".to_string(),
        "1. 解压本 ZIP。".to_string(),
        "2. 将解压后的目录整体复制到剪映草稿目录（com.lveditor.draft）。".to_string(),
        "3. 打开剪映专业版后刷新草稿列表。".to_string(),
        "".to_string(),
        "常见草稿目录：".to_string(),
        "macOS: ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft".to_string(),
        "Windows: %USERPROFILE%\\Videos\\JianyingPro\\User Data\\Projects\\com.lveditor.draft"
            .to_string(),
        "".to_string(),
    ];
    if warnings.is_empty() {
        lines.push("素材路径检查通过。".to_string());
    } else {
        lines.push("需要注意的素材路径问题：".to_string());
        for warning in warnings {
            lines.push(format!("- {}", warning));
        }
    }
    lines.join("\n")
}

fn build_jianying_draft(
    state: &BackendState,
    body: &Value,
) -> Result<(Value, Value, Value, Value, Vec<String>), ApiError> {
    let scenes = validate_jianying_export_payload(body)?.clone();
    let project_name = json_string(body.get("projectName"), "资产工作台项目");
    let aspect_ratio = json_string(body.get("aspectRatio"), "16:9");
    let ordered_scenes = order_scenes_by_ids(
        &scenes,
        body.get("sceneOrder")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
    );
    if let Some(scene) = ordered_scenes.iter().find(|scene| {
        scene
            .get("videoUrl")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "场景 {} 缺少视频地址",
                scene.get("id").and_then(Value::as_str).unwrap_or("")
            ),
        ));
    }

    let now_micros = Utc::now().timestamp_millis() * 1000;
    let draft_id = create_draft_guid();
    let (width, height) = resolve_canvas(&aspect_ratio);
    let options = body.get("options").cloned().unwrap_or_else(|| json!({}));
    let include_subtitles = options
        .get("addSubtitles")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let transition_type = options
        .get("transition")
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("none");
    let transition_duration = to_microseconds(
        options
            .get("transition")
            .and_then(|value| value.get("duration"))
            .and_then(Value::as_f64),
        0.5,
    );
    let bgm_url = options
        .get("bgm")
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let bgm_volume = options
        .get("bgm")
        .and_then(|value| value.get("volume"))
        .and_then(Value::as_f64)
        .unwrap_or(0.3)
        .clamp(0.0, 1.0);

    let mut draft_content = create_draft_content_template(
        &create_draft_guid(),
        &project_name,
        width,
        height,
        now_micros,
    );
    let video_track_id = create_draft_entity_id();
    let audio_track_id = create_draft_entity_id();
    let text_track_id = create_draft_entity_id();
    let mut video_segments = Vec::<Value>::new();
    let mut audio_segments = Vec::<Value>::new();
    let mut text_segments = Vec::<Value>::new();
    let mut video_materials = Vec::<Value>::new();
    let mut audio_materials = Vec::<Value>::new();
    let mut text_materials = Vec::<Value>::new();
    let mut speed_materials = Vec::<Value>::new();
    let mut transition_materials = Vec::<Value>::new();
    let mut manifest_scenes = Vec::<Value>::new();
    let mut warnings = Vec::<String>::new();
    let mut timeline_offset = 0i64;

    for (index, scene) in ordered_scenes.iter().enumerate() {
        let scene_duration = to_microseconds(scene.get("duration").and_then(Value::as_f64), 3.0);
        let raw_video_url = scene.get("videoUrl").and_then(Value::as_str).unwrap_or("");
        let media_path = resolve_jianying_media_path(state, raw_video_url);
        match media_path_status(&media_path) {
            "ok" => {}
            "remote" => warnings.push(format!(
                "场景 {} ({})：远程 URL，剪映可能无法直接加载 -> {}",
                index + 1,
                json_string(scene.get("title").or_else(|| scene.get("id")), "未命名"),
                raw_video_url
            )),
            "inline" => warnings.push(format!(
                "场景 {} ({})：内联 data URL 不受支持 -> {}",
                index + 1,
                json_string(scene.get("title").or_else(|| scene.get("id")), "未命名"),
                raw_video_url
            )),
            _ => warnings.push(format!(
                "场景 {} ({})：本地文件不存在 -> {}",
                index + 1,
                json_string(scene.get("title").or_else(|| scene.get("id")), "未命名"),
                raw_video_url
            )),
        }

        let video_material_id = create_draft_entity_id();
        let video_speed_id = create_draft_entity_id();
        let video_segment_id = create_draft_entity_id();
        let video_file_name = path_file_name(&media_path, &format!("scene_{}.mp4", index + 1));
        video_materials.push(json!({
          "audio_fade": Value::Null,
          "category_id": "",
          "category_name": "local",
          "check_flag": 63487,
          "crop": { "upper_left_x": 0, "upper_left_y": 0, "upper_right_x": 1, "upper_right_y": 0, "lower_left_x": 0, "lower_left_y": 1, "lower_right_x": 1, "lower_right_y": 1 },
          "crop_ratio": "free",
          "crop_scale": 1,
          "duration": scene_duration,
          "height": height,
          "id": video_material_id,
          "local_material_id": "",
          "material_id": video_material_id,
          "material_name": video_file_name,
          "media_path": "",
          "path": media_path,
          "type": "video",
          "width": width
        }));
        speed_materials.push(create_speed_material(&video_speed_id));
        let mut segment = create_segment_base(
            &video_segment_id,
            &video_material_id,
            &video_speed_id,
            timeline_offset,
            scene_duration,
            1.0,
        );
        if let Some(object) = segment.as_object_mut() {
            object.insert("clip".to_string(), json!({ "alpha": 1, "flip": { "horizontal": false, "vertical": false }, "rotation": 0, "scale": { "x": 1, "y": 1 }, "transform": { "x": 0, "y": 0 } }));
            object.insert(
                "uniform_scale".to_string(),
                json!({ "on": true, "value": 1.0 }),
            );
            object.insert(
                "hdr_settings".to_string(),
                json!({ "intensity": 1.0, "mode": 1, "nits": 1000 }),
            );
            object.insert("render_index".to_string(), json!(0));
        }
        video_segments.push(segment);

        if include_subtitles {
            let subtitle_lines = resolve_scene_subtitle_lines(scene);
            if !subtitle_lines.is_empty() {
                let base_duration = (scene_duration / subtitle_lines.len() as i64).max(300_000);
                let mut subtitle_start = 0i64;
                for (line_index, line) in subtitle_lines.iter().enumerate() {
                    let remaining = scene_duration - subtitle_start;
                    if remaining <= 0 {
                        break;
                    }
                    let line_duration = if line_index + 1 == subtitle_lines.len() {
                        remaining
                    } else {
                        base_duration.min(remaining)
                    };
                    let text_material_id = create_draft_entity_id();
                    let text_speed_id = create_draft_entity_id();
                    let text_segment_id = create_draft_entity_id();
                    text_materials.push(json!({
                      "id": text_material_id,
                      "content": create_text_material_content(line),
                      "typesetting": 0,
                      "alignment": 1,
                      "letter_spacing": 0,
                      "line_spacing": 0.02,
                      "line_feed": 1,
                      "line_max_width": 0.82,
                      "force_apply_line_max_width": false,
                      "check_flag": 7,
                      "type": "subtitle",
                      "global_alpha": 1
                    }));
                    speed_materials.push(create_speed_material(&text_speed_id));
                    let mut text_segment = create_segment_base(
                        &text_segment_id,
                        &text_material_id,
                        &text_speed_id,
                        timeline_offset + subtitle_start,
                        line_duration,
                        1.0,
                    );
                    if let Some(object) = text_segment.as_object_mut() {
                        object.insert("clip".to_string(), json!({ "alpha": 1, "flip": { "horizontal": false, "vertical": false }, "rotation": 0, "scale": { "x": 1, "y": 1 }, "transform": { "x": 0, "y": -0.8 } }));
                        object.insert(
                            "uniform_scale".to_string(),
                            json!({ "on": true, "value": 1.0 }),
                        );
                        object.insert("render_index".to_string(), json!(15000));
                    }
                    text_segments.push(text_segment);
                    subtitle_start += line_duration;
                }
            }
        }

        manifest_scenes.push(json!({
          "sceneId": json_string(scene.get("id"), &format!("scene_{}", index + 1)),
          "title": json_string(scene.get("title"), ""),
          "orderIndex": index + 1,
          "startMicroseconds": timeline_offset,
          "durationMicroseconds": scene_duration,
          "sourceVideoUrl": raw_video_url,
          "resolvedMediaPath": media_path
        }));
        timeline_offset += scene_duration;
    }

    if transition_type != "none" && video_segments.len() > 1 {
        if let Some((name, effect_id, resource_id, is_overlap)) = transition_preset(transition_type)
        {
            for index in 0..video_segments.len().saturating_sub(1) {
                let transition_id = create_draft_entity_id();
                transition_materials.push(json!({
                  "category_id": "",
                  "category_name": "",
                  "duration": transition_duration,
                  "effect_id": effect_id,
                  "id": transition_id,
                  "is_overlap": is_overlap,
                  "name": name,
                  "platform": "all",
                  "resource_id": resource_id,
                  "type": "transition"
                }));
                if let Some(object) = video_segments[index].as_object_mut() {
                    let mut refs = object
                        .get("extra_material_refs")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    refs.push(json!(transition_id));
                    object.insert("extra_material_refs".to_string(), Value::Array(refs));
                }
            }
        }
    }

    if !bgm_url.is_empty() {
        let bgm_path = resolve_jianying_media_path(state, bgm_url);
        match media_path_status(&bgm_path) {
            "ok" => {}
            "remote" => warnings.push(format!(
                "BGM：远程 URL，剪映可能无法直接加载 -> {}",
                bgm_url
            )),
            "inline" => warnings.push(format!("BGM：内联 data URL 不受支持 -> {}", bgm_url)),
            _ => warnings.push(format!("BGM：本地文件不存在 -> {}", bgm_url)),
        }
        let bgm_material_id = create_draft_entity_id();
        let bgm_speed_id = create_draft_entity_id();
        let bgm_segment_id = create_draft_entity_id();
        audio_materials.push(json!({
          "app_id": 0,
          "category_id": "",
          "category_name": "local",
          "check_flag": 3,
          "copyright_limit_type": "none",
          "duration": timeline_offset,
          "effect_id": "",
          "formula_id": "",
          "id": bgm_material_id,
          "local_material_id": bgm_material_id,
          "music_id": bgm_material_id,
          "name": path_file_name(&bgm_path, "bgm.mp3"),
          "path": bgm_path,
          "source_platform": 0,
          "type": "extract_music",
          "wave_points": []
        }));
        speed_materials.push(create_speed_material(&bgm_speed_id));
        let mut audio_segment = create_segment_base(
            &bgm_segment_id,
            &bgm_material_id,
            &bgm_speed_id,
            0,
            timeline_offset,
            bgm_volume,
        );
        if let Some(object) = audio_segment.as_object_mut() {
            object.insert("clip".to_string(), Value::Null);
            object.insert("hdr_settings".to_string(), Value::Null);
            object.insert("render_index".to_string(), json!(0));
        }
        audio_segments.push(audio_segment);
    }

    if let Some(materials) = draft_content
        .get_mut("materials")
        .and_then(Value::as_object_mut)
    {
        materials.insert("videos".to_string(), Value::Array(video_materials.clone()));
        materials.insert("audios".to_string(), Value::Array(audio_materials.clone()));
        materials.insert("texts".to_string(), Value::Array(text_materials.clone()));
        materials.insert("speeds".to_string(), Value::Array(speed_materials));
        materials.insert(
            "transitions".to_string(),
            Value::Array(transition_materials),
        );
    }
    let mut tracks = vec![
        json!({ "attribute": 0, "flag": 0, "id": video_track_id, "is_default_name": false, "name": "主视频轨", "segments": video_segments, "type": "video" }),
    ];
    if !audio_segments.is_empty() {
        tracks.push(json!({ "attribute": 0, "flag": 0, "id": audio_track_id, "is_default_name": false, "name": "背景音乐", "segments": audio_segments, "type": "audio" }));
    }
    if !text_segments.is_empty() {
        tracks.push(json!({ "attribute": 0, "flag": 0, "id": text_track_id, "is_default_name": false, "name": "字幕", "segments": text_segments, "type": "text" }));
    }
    if let Some(object) = draft_content.as_object_mut() {
        object.insert("duration".to_string(), json!(timeline_offset));
        object.insert("tracks".to_string(), Value::Array(tracks));
    }

    let draft_meta = create_draft_meta_info(
        &draft_id,
        &project_name,
        timeline_offset,
        now_micros,
        video_materials.len() + audio_materials.len() + text_materials.len(),
    );
    json!({
      "format": "asset-workbench-jianying-project",
      "generatedAt": now_iso(),
      "projectName": project_name,
      "aspectRatio": aspect_ratio,
      "sceneCount": ordered_scenes.len(),
      "totalDurationMicroseconds": timeline_offset,
      "options": {
        "addSubtitles": include_subtitles,
        "transition": options.get("transition").cloned().unwrap_or(Value::Null),
        "bgm": if bgm_url.is_empty() { Value::Null } else { json!({ "url": bgm_url, "volume": bgm_volume }) }
      },
      "warnings": warnings,
      "scenes": manifest_scenes
    });
    let manifest = json!({
      "format": "asset-workbench-jianying-project",
      "generatedAt": now_iso(),
      "projectName": project_name,
      "aspectRatio": aspect_ratio,
      "sceneCount": ordered_scenes.len(),
      "totalDurationMicroseconds": timeline_offset,
      "options": {
        "addSubtitles": include_subtitles,
        "transition": options.get("transition").cloned().unwrap_or(Value::Null),
        "bgm": if bgm_url.is_empty() { Value::Null } else { json!({ "url": bgm_url, "volume": bgm_volume }) }
      },
      "warnings": warnings,
      "scenes": manifest_scenes
    });
    Ok((
        draft_content.clone(),
        draft_content,
        draft_meta,
        manifest,
        warnings,
    ))
}

fn build_zip_bytes(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, ApiError> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, bytes) in files {
        writer
            .start_file(path, options)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        writer
            .write_all(&bytes)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let cursor = writer
        .finish()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(cursor.into_inner())
}

pub(super) async fn api_video_export_jianying(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let project_name = json_string(body.get("projectName"), "资产工作台项目");
    let (draft_content, draft_info, draft_meta, manifest, warnings) =
        build_jianying_draft(&state, &body)?;
    let archive_root = sanitize_file_component(&project_name);
    let readme = build_jianying_readme(&project_name, &warnings);
    let zip_bytes = build_zip_bytes(vec![
        (
            format!("{}/draft_content.json", archive_root),
            serde_json::to_vec_pretty(&draft_content).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        ),
        (
            format!("{}/draft_info.json", archive_root),
            serde_json::to_vec_pretty(&draft_info).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        ),
        (
            format!("{}/draft_meta_info.json", archive_root),
            serde_json::to_vec_pretty(&draft_meta).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        ),
        (
            format!("{}/asset-workbench-manifest.json", archive_root),
            serde_json::to_vec_pretty(&manifest).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        ),
        (format!("{}/README.txt", archive_root), readme.into_bytes()),
    ])?;
    let file_name = format!(
        "{}-剪映工程-{}.zip",
        sanitize_file_component(&project_name),
        Utc::now().format("%Y-%m-%d")
    );
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/zip"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename*=UTF-8''{}", file_name))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        zip_bytes,
    )
        .into_response())
}

#[derive(Clone, Debug)]
struct TosStorageConfig {
    enabled: bool,
    access_key_id: String,
    access_key_secret: String,
    security_token: Option<String>,
    region: String,
    endpoint: String,
    endpoint_protocol: String,
    bucket: String,
    key_prefix: Option<String>,
    public_base_url: Option<String>,
    is_custom_domain: bool,
    restrict_to_key_prefix: bool,
    proxy_host: Option<String>,
    proxy_port: Option<isize>,
}

fn tos_config_string(config: &Value, key: &str) -> String {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn trim_slashes(value: &str) -> String {
    value.trim().trim_matches('/').to_string()
}

fn normalize_object_path(value: &str) -> String {
    trim_slashes(value)
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn join_object_path(left: &str, right: &str) -> String {
    [left, right]
        .into_iter()
        .map(normalize_object_path)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn strip_object_scope_prefix(scope_prefix: Option<&str>, value: &str) -> String {
    let normalized = normalize_object_path(value);
    let Some(scope_prefix) = scope_prefix
        .map(normalize_object_path)
        .filter(|value| !value.is_empty())
    else {
        return normalized;
    };
    if normalized == scope_prefix {
        return String::new();
    }
    normalized
        .strip_prefix(&format!("{scope_prefix}/"))
        .unwrap_or(&normalized)
        .to_string()
}

fn normalize_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_protocol = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    Some(with_protocol.trim_end_matches('/').to_string())
}

fn normalize_endpoint(raw: &str) -> (String, String) {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return ("".to_string(), "https".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("http://") {
        return (trim_slashes(rest), "http".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("https://") {
        return (trim_slashes(rest), "https".to_string());
    }
    (trim_slashes(trimmed), "https".to_string())
}

fn load_tos_config() -> TosStorageConfig {
    let cloud_config = get_cloud_runtime_tos_config();
    let use_cloud_scope = cloud_config.is_some();
    let config = cloud_config
        .or_else(|| {
            config_connection().and_then(|conn| {
                get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)
                    .ok()
                    .flatten()
            })
        })
        .unwrap_or_else(default_tos_config);

    let access_key_id = tos_config_string(&config, "accessKeyId");
    let access_key_secret = tos_config_string(&config, "secretKey");
    let security_token = {
        let token = tos_config_string(&config, "securityToken");
        if token.is_empty() {
            None
        } else {
            Some(token)
        }
    };
    let region = tos_config_string(&config, "region");
    let bucket = tos_config_string(&config, "bucket");
    let (key_prefix, restrict_to_key_prefix) =
        build_scoped_tos_key_prefix(&tos_config_string(&config, "keyPrefix"), use_cloud_scope);
    let public_base_url = normalize_base_url(&tos_config_string(&config, "publicBaseUrl"));
    let is_custom_domain = config
        .get("isCustomDomain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (endpoint, endpoint_protocol) = normalize_endpoint(&tos_config_string(&config, "endpoint"));
    let proxy = resolve_tos_proxy_config();
    let enabled_flag = config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_required = !access_key_id.is_empty()
        && !access_key_secret.is_empty()
        && !region.is_empty()
        && !bucket.is_empty()
        && !endpoint.is_empty();

    TosStorageConfig {
        enabled: enabled_flag && has_required,
        access_key_id,
        access_key_secret,
        security_token,
        region,
        endpoint,
        endpoint_protocol,
        bucket,
        key_prefix,
        public_base_url,
        is_custom_domain,
        restrict_to_key_prefix,
        proxy_host: proxy.as_ref().map(|value| value.host.clone()),
        proxy_port: proxy.as_ref().map(|value| value.port),
    }
}

fn tos_percent_encode(input: &str) -> String {
    let mut output = String::new();
    for byte in input.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == '~' {
            output.push(ch);
        } else {
            output.push('%');
            output.push_str(&format!("{:02X}", byte));
        }
    }
    output
}

fn build_tos_public_url(config: &TosStorageConfig, object_key: &str) -> String {
    let encoded_key = object_key
        .split('/')
        .map(tos_percent_encode)
        .collect::<Vec<_>>()
        .join("/");

    if let Some(base_url) = &config.public_base_url {
        return format!("{}/{}", base_url, encoded_key);
    }

    if config.is_custom_domain {
        return format!(
            "{}://{}/{}",
            config.endpoint_protocol, config.endpoint, encoded_key
        );
    }

    format!(
        "{}://{}.{}/{}",
        config.endpoint_protocol, config.bucket, config.endpoint, encoded_key
    )
}

pub(super) async fn api_tos_files(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let config = load_tos_config();
    if !config.enabled {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TOS 未启用或配置不完整（请在后台系统设置 → 云存储中填写 Access Key / Secret Key / Region / Endpoint / Bucket 并启用）",
        ));
    }

    let virtual_query_prefix = query
        .get("prefix")
        .map(|value| normalize_object_path(value))
        .filter(|value| !value.is_empty());
    if config.restrict_to_key_prefix && config.key_prefix.is_none() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "当前用户没有可访问的云端素材目录",
        ));
    }
    let object_scope_prefix = config.key_prefix.clone();
    let base_prefix = match (&object_scope_prefix, virtual_query_prefix.as_deref()) {
        (Some(scope_prefix), Some(prefix)) => Some(join_object_path(scope_prefix, prefix)),
        (Some(scope_prefix), None) => Some(scope_prefix.clone()),
        (None, Some(prefix)) => Some(prefix.to_string()),
        (None, None) => None,
    };
    let delimiter = query
        .get("delimiter")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let max_keys = query
        .get("maxKeys")
        .map(|value| {
            let parsed = value
                .parse::<usize>()
                .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "maxKeys 必须是整数"))?;
            if !(1..=1000).contains(&parsed) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "maxKeys 必须在 1 到 1000 之间",
                ));
            }
            Ok(parsed)
        })
        .transpose()?
        .unwrap_or(100);
    let continuation_token = query
        .get("continuationToken")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let sort_last_modified_desc = query
        .get("sort")
        .map(|value| value.trim().eq_ignore_ascii_case("lastModifiedDesc"))
        .unwrap_or(false);

    let list_prefix = if delimiter.is_some() {
        base_prefix
            .as_ref()
            .map(|value| format!("{}/", value.trim_end_matches('/')))
            .unwrap_or_default()
    } else {
        base_prefix.clone().unwrap_or_default()
    };

    let query_config = config.clone();
    let query_delimiter = delimiter.clone();
    let query_continuation_token = continuation_token.clone();
    let query_list_prefix = list_prefix.clone();
    let query_scope_prefix = object_scope_prefix.clone();
    let listing = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let endpoint = format!(
            "{}://{}",
            query_config.endpoint_protocol, query_config.endpoint
        );
        let mut builder = tos::builder()
            .connection_timeout(15000)
            .request_timeout(15000)
            .max_retry_count(1)
            .ak(query_config.access_key_id.clone())
            .sk(query_config.access_key_secret.clone())
            .region(query_config.region.clone())
            .endpoint(endpoint)
            .is_custom_domain(query_config.is_custom_domain);
        if let Some(token) = &query_config.security_token {
            builder = builder.security_token(token.clone());
        }
        if let (Some(proxy_host), Some(proxy_port)) =
            (&query_config.proxy_host, query_config.proxy_port)
        {
            builder = builder.proxy_host(proxy_host.clone()).proxy_port(proxy_port);
        }
        let client = builder.build().map_err(|error| error.to_string())?;

        let scan_limit = if sort_last_modified_desc {
            50_000
        } else {
            max_keys
        };
        let mut files = Vec::new();
        let mut common_prefixes = Vec::new();
        let mut next_token = query_continuation_token;
        let mut output_bucket: String;
        let mut output_prefix: String;
        let mut output_delimiter: Option<String>;
        let mut output_max_keys: isize;
        let mut is_truncated: bool;

        loop {
            let mut input = ListObjectsType2Input::new(query_config.bucket.clone());
            input.set_list_only_once(true);
            input.set_fetch_meta(false);
            input.set_max_keys(if sort_last_modified_desc {
                1000
            } else {
                max_keys as isize
            });
            if !query_list_prefix.is_empty() {
                input.set_prefix(query_list_prefix.clone());
            }
            if let Some(value) = &query_delimiter {
                input.set_delimiter(value.clone());
            }
            if let Some(value) = &next_token {
                input.set_continuation_token(value.clone());
            }

            let output = client
                .list_objects_type2(&input)
                .map_err(|error| error.to_string())?;
            output_bucket = output.name().to_string();
            output_prefix = output.prefix().to_string();
            output_delimiter = if output.delimiter().trim().is_empty() {
                query_delimiter.clone()
            } else {
                Some(output.delimiter().to_string())
            };
            output_max_keys = output.max_keys();
            is_truncated = output.is_truncated();

            for item in output.contents() {
                let storage_class = item
                    .storage_class()
                    .as_ref()
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default();
                let display_key = strip_object_scope_prefix(query_scope_prefix.as_deref(), item.key());
                files.push(json!({
                  "key": display_key,
                  "size": item.size(),
                  "lastModified": item.last_modified().map(|value| value.to_rfc3339()).unwrap_or_default(),
                  "storageClass": storage_class,
                  "etag": item.etag().trim_matches('\"'),
                  "url": build_tos_public_url(&query_config, item.key())
                }));
            }
            for item in output.common_prefixes() {
                let prefix = strip_object_scope_prefix(query_scope_prefix.as_deref(), item.prefix());
                if !common_prefixes.contains(&prefix) {
                    common_prefixes.push(prefix);
                }
            }

            let output_next_token = output.next_continuation_token().trim().to_string();
            if !sort_last_modified_desc || !output.is_truncated() || output_next_token.is_empty() {
                next_token = if output_next_token.is_empty() {
                    None
                } else {
                    Some(output_next_token)
                };
                break;
            }
            if files.len() >= scan_limit {
                next_token = Some(output_next_token);
                break;
            }
            next_token = Some(output_next_token);
        }

        if sort_last_modified_desc {
            files.sort_by(|left, right| {
                let left_time = left
                    .get("lastModified")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let right_time = right
                    .get("lastModified")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                right_time.cmp(left_time)
            });
            if files.len() > max_keys {
                files.truncate(max_keys);
            }
        }
        let next_token_text = next_token.unwrap_or_default();

        Ok(json!({
          "bucket": output_bucket,
          "prefix": strip_object_scope_prefix(query_scope_prefix.as_deref(), &output_prefix),
          "delimiter": output_delimiter,
          "maxKeys": output_max_keys,
          "isTruncated": is_truncated,
          "nextContinuationToken": if sort_last_modified_desc || next_token_text.is_empty() { Value::Null } else { json!(next_token_text) },
          "commonPrefixes": common_prefixes,
          "files": files
        }))
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;

    Ok(Json(json!({
      "success": true,
      "data": listing
    })))
}

fn is_disallowed_image_proxy_hostname(hostname: &str) -> bool {
    let normalized = hostname.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }

    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized.ends_with(".internal")
    {
        return true;
    }

    normalized.parse::<std::net::IpAddr>().is_ok()
}

fn assert_safe_image_proxy_url(raw_url: &str) -> Result<reqwest::Url, ApiError> {
    let parsed = reqwest::Url::parse(raw_url).map_err(|error| {
        ApiError::new(StatusCode::BAD_REQUEST, format!("无效图片地址: {}", error))
    })?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持 http/https 图片地址",
        ));
    }

    let hostname = parsed
        .host_str()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效图片地址"))?;
    if is_disallowed_image_proxy_hostname(hostname) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不允许访问该图片地址",
        ));
    }

    Ok(parsed)
}

fn looks_like_image_proxy_path(url: &reqwest::Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif", ".svg",
    ]
    .iter()
    .any(|extension| path.ends_with(extension))
}

fn detect_image_proxy_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.len() >= 8
        && bytes[0] == 0x89
        && bytes[1] == b'P'
        && bytes[2] == b'N'
        && bytes[3] == b'G'
        && bytes[4] == 0x0d
        && bytes[5] == 0x0a
        && bytes[6] == 0x1a
        && bytes[7] == 0x0a
    {
        return Some("image/png");
    }
    if bytes.len() >= 6
        && bytes[0] == b'G'
        && bytes[1] == b'I'
        && bytes[2] == b'F'
        && bytes[3] == b'8'
    {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.len() >= 2 && bytes[0] == b'B' && bytes[1] == b'M' {
        return Some("image/bmp");
    }
    if bytes.len() >= 4
        && bytes[0] == b'I'
        && bytes[1] == b'I'
        && bytes[2] == 0x2a
        && bytes[3] == 0x00
    {
        return Some("image/tiff");
    }
    if bytes.len() >= 4
        && bytes[0] == b'M'
        && bytes[1] == b'M'
        && bytes[2] == 0x00
        && bytes[3] == 0x2a
    {
        return Some("image/tiff");
    }

    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(512)])
        .trim_start()
        .to_ascii_lowercase();
    if prefix.starts_with("<svg") || (prefix.starts_with("<?xml") && prefix.contains("<svg")) {
        return Some("image/svg+xml");
    }

    None
}

pub(super) async fn api_image_proxy(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let target = query
        .get("url")
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url 不能为空"))?;
    if target.chars().count() > 2048 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "url 不能超过 2048 个字符",
        ));
    }
    let upstream_url = assert_safe_image_proxy_url(&target)?;

    let response = http_client()
        .get(upstream_url.clone())
        .header(reqwest::header::ACCEPT, "image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    assert_safe_image_proxy_url(response.url().as_str())?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("图片拉取失败: {}", response.status()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 25 * 1024 * 1024)
    {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "图片体积超过代理上限",
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let is_image_content_type = content_type.starts_with("image/");
    if !is_image_content_type && !looks_like_image_proxy_path(&upstream_url) {
        return Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "代理目标不是受支持的图片",
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
        .to_vec();
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "图片体积超过代理上限",
        ));
    }

    let detected_mime = detect_image_proxy_mime_type(&bytes);
    let mime = detected_mime
        .map(str::to_string)
        .or_else(|| is_image_content_type.then_some(content_type))
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "代理目标不是受支持的图片",
            )
        })?;

    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_str(&mime)
                    .unwrap_or_else(|_| HeaderValue::from_static("image/png")),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
            (
                header::HeaderName::from_static("x-image-proxy"),
                HeaderValue::from_static("1"),
            ),
        ],
        bytes,
    )
        .into_response())
}
