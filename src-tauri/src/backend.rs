use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post, put};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path as FsPath, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::net::TcpListener;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const STYLE_PRESET_CONFIG_KEY: &str = "style_preset_config";
const STYLE_PRESET_DATA_KEY: &str = "style_preset_data";
const SELECTED_MODELS_KEY: &str = "selected_models";
const WORKFLOW_MODELS_KEY: &str = "workflow_models";
const WORKFLOW_MODEL_OPTIONS_KEY: &str = "workflow_model_options";
const CUSTOM_OPENAI_CONFIG_KEY: &str = "custom_openai_provider";
const PROVIDER_MODEL_CATALOG_KEY: &str = "provider_model_catalog";
const PROMPT_TEMPLATES_KEY: &str = "prompt_templates_default";
const PROMPT_PROFILES_KEY: &str = "prompt_profiles_default";
const PROMPT_VERSIONS_KEY: &str = "prompt_versions_default";
const PROMPT_PROFILE_STATE_KEY: &str = "prompt_profile_state_default";

const PLACEHOLDER_IMAGE_BYTES: &[u8] = include_bytes!("../assets/placeholder-image.png");
const PLACEHOLDER_VIDEO_16X9_BYTES: &[u8] = include_bytes!("../assets/placeholder-video-16x9.mp4");
const PLACEHOLDER_VIDEO_9X16_BYTES: &[u8] = include_bytes!("../assets/placeholder-video-9x16.mp4");
const PLACEHOLDER_VIDEO_1X1_BYTES: &[u8] = include_bytes!("../assets/placeholder-video-1x1.mp4");
const DEFAULT_STYLE_PRESETS_JSON: &str = include_str!("../assets/default-style-presets.json");
const DEFAULT_STYLE_CATEGORIES_JSON: &str = include_str!("../assets/default-style-categories.json");
const DEFAULT_PROMPT_TEMPLATES_JSON: &str = include_str!("../assets/default-prompt-templates.json");

#[path = "backend/prompts_api.rs"]
mod prompts_api;
#[path = "backend/runtime_api.rs"]
mod runtime_api;

use prompts_api::*;
use runtime_api::*;

#[derive(Clone)]
pub struct BackendState {
    pub db_path: PathBuf,
    pub data_dir: PathBuf,
    pub public_dir: PathBuf,
    pub web_dir: PathBuf,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(json!({
          "success": false,
          "message": self.message
        }));
        (self.status, body).into_response()
    }
}

#[derive(Deserialize)]
struct ProjectListQuery {
    page: Option<usize>,
    #[serde(rename = "pageSize")]
    page_size: Option<usize>,
}

#[derive(Deserialize)]
struct CreateProjectBody {
    title: String,
    description: Option<String>,
    #[serde(rename = "scriptParseMode")]
    script_parse_mode: Option<String>,
    #[serde(rename = "styleId")]
    style_id: Option<String>,
    #[serde(rename = "aspectRatio")]
    aspect_ratio: Option<String>,
}

#[derive(Deserialize)]
struct SaveStyleConfigBody {
    #[serde(rename = "enabledStyleIds")]
    enabled_style_ids: Vec<String>,
    #[serde(rename = "defaultStyleId")]
    default_style_id: Option<String>,
}

#[derive(Deserialize)]
struct UpdateWorkflowBody {
    step: Option<String>,
    #[serde(rename = "modelId")]
    model_id: Option<String>,
    models: Option<Value>,
    #[serde(rename = "modelOptions")]
    model_options: Option<Value>,
}

#[derive(Deserialize)]
struct PutProviderModelsBody {
    models: Vec<String>,
}

#[derive(Deserialize)]
struct CustomOpenAIPutBody {
    enabled: Option<bool>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "textModels")]
    text_models: Option<Vec<String>>,
    #[serde(rename = "availableTextModels")]
    available_text_models: Option<Vec<String>>,
    #[serde(rename = "modelsSyncedAt")]
    models_synced_at: Option<String>,
    #[serde(rename = "modelsSyncError")]
    models_sync_error: Option<String>,
}

#[derive(Deserialize)]
struct PutPromptBody {
    content: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct CreateProfileBody {
    name: String,
    description: Option<String>,
    activate: Option<bool>,
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    name: Option<String>,
    description: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn sanitize_rel_path(raw: &str) -> Option<String> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }
    if normalized.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(normalized.trim_start_matches('/').to_string())
}

fn path_content_type(path: &FsPath) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn db_connection(state: &BackendState) -> Result<Connection, ApiError> {
    let conn = Connection::open(&state.db_path).map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("打开数据库失败: {}", error),
        )
    })?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(conn)
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("failed to build reqwest client")
    })
}

fn sanitize_file_component(raw: &str) -> String {
    let mut output = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == '-' {
            output.push(ch);
        }
    }

    if output.is_empty() {
        "asset".to_string()
    } else {
        output
    }
}

fn infer_extension_from_mime(mime: &str, fallback: &str) -> String {
    let normalized = mime.trim().to_ascii_lowercase();
    let ext = match normalized.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/wav" => "wav",
        "audio/aac" => "aac",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => "",
    };
    if ext.is_empty() {
        fallback.to_string()
    } else {
        ext.to_string()
    }
}

fn normalize_base64_payload(raw: &str) -> String {
    raw.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn parse_data_url(source: &str) -> Option<(String, Vec<u8>)> {
    let trimmed = source.trim();
    let (meta, payload) = trimmed.split_once(',')?;
    if !meta.starts_with("data:") || !meta.contains(";base64") {
        return None;
    }

    let mime = meta
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if mime.is_empty() {
        return None;
    }

    let compact = normalize_base64_payload(payload);
    let bytes = BASE64_STANDARD.decode(compact).ok()?;
    Some((mime, bytes))
}

fn decode_base64_bytes(source: &str) -> Option<Vec<u8>> {
    let compact = normalize_base64_payload(source);
    BASE64_STANDARD.decode(compact).ok()
}

fn is_http_url(raw: &str) -> bool {
    raw.starts_with("http://") || raw.starts_with("https://")
}

fn decode_url_component(raw: &str) -> Option<String> {
    let mut bytes: Vec<u8> = Vec::with_capacity(raw.len());
    let input = raw.as_bytes();
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' && index + 2 < input.len() {
            let hex = std::str::from_utf8(&input[index + 1..index + 3]).ok()?;
            let value = u8::from_str_radix(hex, 16).ok()?;
            bytes.push(value);
            index += 3;
            continue;
        }
        bytes.push(input[index]);
        index += 1;
    }
    String::from_utf8(bytes).ok()
}

fn resolve_api_file_path(raw: &str, prefix: &str, dir: &FsPath) -> Option<PathBuf> {
    let segment = raw.strip_prefix(prefix)?;
    let decoded = decode_url_component(segment)?;
    let sanitized = sanitize_rel_path(&decoded)?;
    if sanitized.contains('/') {
        return None;
    }
    Some(dir.join(sanitized))
}

fn write_file_bytes(path: &FsPath, bytes: &[u8]) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    fs::write(path, bytes)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn build_unique_filename(prefix: &str, ext: &str) -> String {
    format!(
        "{}_{}_{}.{}",
        sanitize_file_component(prefix),
        Utc::now().timestamp_millis(),
        Uuid::new_v4().simple(),
        sanitize_file_component(ext)
    )
}

fn persist_image_bytes(
    state: &BackendState,
    prefix: &str,
    mime_type: Option<&str>,
    fallback_ext: &str,
    bytes: &[u8],
) -> Result<String, ApiError> {
    let ext = infer_extension_from_mime(mime_type.unwrap_or(""), fallback_ext);
    let filename = build_unique_filename(prefix, &ext);
    let path = state.public_dir.join("generated-images").join(&filename);
    write_file_bytes(&path, bytes)?;
    Ok(format!("/api/image/file/{}", filename))
}

fn persist_video_bytes(
    state: &BackendState,
    prefix: &str,
    mime_type: Option<&str>,
    fallback_ext: &str,
    bytes: &[u8],
) -> Result<String, ApiError> {
    let ext = infer_extension_from_mime(mime_type.unwrap_or(""), fallback_ext);
    let filename = build_unique_filename(prefix, &ext);
    let path = state.public_dir.join("videos").join(&filename);
    write_file_bytes(&path, bytes)?;
    Ok(format!("/api/video/file/{}", filename))
}

fn placeholder_video_bytes(aspect_ratio: &str) -> &'static [u8] {
    match aspect_ratio {
        "9:16" => PLACEHOLDER_VIDEO_9X16_BYTES,
        "1:1" => PLACEHOLDER_VIDEO_1X1_BYTES,
        _ => PLACEHOLDER_VIDEO_16X9_BYTES,
    }
}

fn json_lines_response(lines: Vec<Value>) -> Response {
    let mut content = String::new();
    for line in lines {
        content.push_str(&line.to_string());
        content.push('\n');
    }

    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/x-ndjson; charset=utf-8"),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache, no-transform"),
            ),
        ],
        content,
    )
        .into_response()
}

fn json_string(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn parse_embedded_json(raw: &str, label: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("[RustBackend] 解析内置资源失败 ({}): {}", label, error);
            None
        }
    }
}

fn fallback_style_presets() -> Value {
    json!([
      {
        "id": "ghibli",
        "name": "吉卜力",
        "nameEn": "Ghibli",
        "category": "japanese_anime",
        "description": "宫崎骏风格",
        "prompt": "Ghibli style",
        "thumbnail": null,
        "isNew": false,
        "isPro": false
      },
      {
        "id": "live_action",
        "name": "AI真人",
        "nameEn": "Live-Action",
        "category": "3d_render",
        "description": "影视级写实风格",
        "prompt": "live action",
        "thumbnail": null,
        "isNew": true,
        "isPro": false
      },
      {
        "id": "city_romance",
        "name": "都市言情",
        "nameEn": "City Romance",
        "category": "illustration",
        "description": "都市恋爱叙事氛围",
        "prompt": "city romance",
        "thumbnail": null,
        "isNew": false,
        "isPro": false
      }
    ])
}

fn default_style_presets() -> Value {
    let parsed = parse_embedded_json(DEFAULT_STYLE_PRESETS_JSON, "default-style-presets.json")
        .unwrap_or_else(fallback_style_presets);
    if parsed.is_array() {
        parsed
    } else {
        fallback_style_presets()
    }
}

pub fn default_style_catalog() -> Value {
    let presets = default_style_presets();
    let preset_ids: Vec<String> = presets
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let default_style_id = if preset_ids.iter().any(|id| id == "ghibli") {
        "ghibli".to_string()
    } else {
        preset_ids
            .first()
            .cloned()
            .unwrap_or_else(|| "ghibli".to_string())
    };

    json!({
      "allPresets": presets,
      "enabledStyleIds": preset_ids,
      "defaultStyleId": default_style_id
    })
}

fn default_style_categories() -> Value {
    let parsed = parse_embedded_json(
        DEFAULT_STYLE_CATEGORIES_JSON,
        "default-style-categories.json",
    )
    .unwrap_or_else(|| {
        json!([
          { "id": "japanese_anime", "name": "日系动漫", "nameEn": "Japanese Anime", "icon": "sparkles" },
          { "id": "3d_render", "name": "3D渲染", "nameEn": "3D Render", "icon": "box" },
          { "id": "illustration", "name": "插画", "nameEn": "Illustration", "icon": "palette" }
        ])
    });
    if parsed.is_array() {
        parsed
    } else {
        json!([
          { "id": "japanese_anime", "name": "日系动漫", "nameEn": "Japanese Anime", "icon": "sparkles" },
          { "id": "3d_render", "name": "3D渲染", "nameEn": "3D Render", "icon": "box" },
          { "id": "illustration", "name": "插画", "nameEn": "Illustration", "icon": "palette" }
        ])
    }
}

fn default_available_models() -> Value {
    json!({
      "text": [
        {
          "provider": "qwen",
          "model": "qwen3.6-plus",
          "displayName": "通义千问3.6-Plus",
          "description": "默认文本模型",
          "supportThinking": true
        }
      ],
      "image": [
        {
          "provider": "qwen",
          "model": "qwen-image-2.0-pro",
          "displayName": "通义万相2.0",
          "description": "默认图片模型",
          "supportedAspectRatios": ["1:1", "16:9", "9:16"],
          "supportedQualities": ["auto", "low", "medium", "high"],
          "supportReferenceImage": true
        }
      ],
      "video": [
        {
          "provider": "qwen",
          "model": "wan2.7-t2v",
          "displayName": "万相2.7视频",
          "description": "默认视频模型",
          "supportFirstLastFrame": true,
          "supportImageToVideo": true,
          "supportTextToVideo": true
        }
      ],
      "voice": []
    })
}

fn default_selected_models() -> Value {
    json!({
      "text": "qwen3.6-plus",
      "image": "qwen-image-2.0-pro",
      "video": "wan2.7-t2v",
      "tts": "",
      "asr": ""
    })
}

fn default_workflow_steps() -> Value {
    json!([
      {
        "id": "script_parsing",
        "name": "分集目录规划与剧本解析",
        "description": "解析为结构化场景",
        "category": "text",
        "requiredCapabilities": ["text_generation"],
        "optionalCapabilities": []
      },
      {
        "id": "scene_description_refinement",
        "name": "场景描述二次改写",
        "description": "按指令重写场景描述",
        "category": "text",
        "requiredCapabilities": ["text_generation"],
        "optionalCapabilities": []
      },
      {
        "id": "character_portrait",
        "name": "角色资产生成",
        "description": "角色参考图生成",
        "category": "image",
        "requiredCapabilities": [],
        "optionalCapabilities": ["reference_image"]
      },
      {
        "id": "frame_generation",
        "name": "环境参考图生成",
        "description": "环境全景图生成",
        "category": "image",
        "requiredCapabilities": [],
        "optionalCapabilities": ["reference_image"]
      },
      {
        "id": "video_generation",
        "name": "分镜视频生成",
        "description": "按分镜生成视频",
        "category": "video",
        "requiredCapabilities": [],
        "optionalCapabilities": ["first_last_frame", "image_to_video", "text_to_video"]
      }
    ])
}

fn default_workflow_models() -> Value {
    json!({
      "script_parsing": "qwen3.6-plus",
      "scene_description_refinement": "qwen3.6-plus",
      "character_portrait": "qwen-image-2.0-pro",
      "frame_generation": "qwen-image-2.0-pro",
      "video_generation": "wan2.7-t2v"
    })
}

fn default_workflow_model_options() -> Value {
    json!({
      "image_options": {
        "geminiImageSize": "1K",
        "openaiImageQuality": "auto",
        "panoramaSourceMode": "equirectangular_360",
        "panoramaCustomAspectRatio": "2:1",
        "panoramaCustomSize": "2048*1024"
      },
      "video_generation": {
        "klingV3Omni": { "sound": "off", "mode": "pro" },
        "seedance": { "quality": "720p" },
        "audioDefaults": { "qwen": true, "kling": true, "seedance": true }
      },
      "completion_notification": { "sound": true, "systemNotification": true }
    })
}

fn default_custom_openai_config() -> Value {
    json!({
      "enabled": false,
      "displayName": "自定义 OpenAI",
      "baseUrl": "",
      "apiKey": "",
      "textModels": [],
      "availableTextModels": [],
      "modelsSyncedAt": null,
      "modelsSyncError": null
    })
}

fn fallback_prompt_templates() -> Value {
    let now = now_iso();
    json!([
      {
        "id": "script_parsing",
        "name": "精品剧解析与资产规划",
        "category": "text",
        "description": "默认模板",
        "content": "你是一位资深分镜师，请将输入文本解析为结构化分镜数据。",
        "variables": [],
        "isCustomized": false,
        "updatedAt": now
      },
      {
        "id": "scene_video_generation",
        "name": "分镜视频生成",
        "category": "video",
        "description": "默认模板",
        "content": "根据场景描述和参考图生成视频分镜。",
        "variables": [],
        "isCustomized": false,
        "updatedAt": now
      }
    ])
}

fn default_prompt_templates() -> Value {
    let parsed = parse_embedded_json(
        DEFAULT_PROMPT_TEMPLATES_JSON,
        "default-prompt-templates.json",
    )
    .unwrap_or_else(fallback_prompt_templates);

    let list = match parsed.as_array() {
        Some(items) => items,
        None => return fallback_prompt_templates(),
    };

    let now = now_iso();
    let normalized: Vec<Value> = list
        .iter()
        .filter_map(|item| {
            let mut obj = item.as_object()?.clone();

            if !obj.contains_key("id")
                || obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
            {
                return None;
            }

            if !matches!(obj.get("content"), Some(Value::String(_))) {
                obj.insert("content".to_string(), json!(""));
            }
            if !matches!(obj.get("variables"), Some(Value::Array(_))) {
                obj.insert("variables".to_string(), json!([]));
            }

            obj.insert("isCustomized".to_string(), json!(false));
            obj.insert("updatedAt".to_string(), json!(now.clone()));
            Some(Value::Object(obj))
        })
        .collect();

    if normalized.is_empty() {
        fallback_prompt_templates()
    } else {
        json!(normalized)
    }
}

fn default_prompt_profiles() -> Value {
    let now = now_iso();
    json!({
      "profiles": [
        {
          "id": "default",
          "name": "默认方案",
          "description": "系统默认提示词方案",
          "createdAt": now,
          "updatedAt": now
        }
      ],
      "activeProfileId": "default"
    })
}

fn get_config_json(conn: &Connection, key: &str) -> Result<Option<Value>, ApiError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM system_config WHERE key = ?1 LIMIT 1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    match value {
        Some(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(parsed) => Ok(Some(parsed)),
            Err(_) => Ok(None),
        },
        None => Ok(None),
    }
}

fn set_config_json(conn: &Connection, key: &str, value: &Value) -> Result<(), ApiError> {
    let now = now_iso();
    let serialized = serde_json::to_string(value)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    conn.execute(
        "INSERT INTO system_config (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, serialized, now],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn extract_id_set(value: &Value) -> HashSet<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn is_legacy_minimal_style_presets(value: &Value) -> bool {
    let ids = extract_id_set(value);
    ids.len() == 3
        && ids.contains("ghibli")
        && ids.contains("live_action")
        && ids.contains("city_romance")
}

fn is_legacy_minimal_prompt_templates(value: &Value) -> bool {
    let ids = extract_id_set(value);
    ids.len() == 2 && ids.contains("script_parsing") && ids.contains("scene_video_generation")
}

fn extract_templates_from_prompt_profile_state(value: &Value) -> Option<Value> {
    let templates = value
        .get("snapshots")
        .and_then(Value::as_object)
        .and_then(|snapshots| snapshots.get("default"))
        .and_then(|snapshot| snapshot.get("templates"))
        .cloned()?;

    if templates
        .as_array()
        .map(|items| items.is_empty())
        .unwrap_or(true)
    {
        return None;
    }
    if is_legacy_minimal_prompt_templates(&templates) {
        return None;
    }
    Some(templates)
}

fn init_database(state: &BackendState) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    conn.execute_batch(
        "
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        script_parse_mode TEXT NOT NULL DEFAULT 'short_drama',
        style_id TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        status TEXT DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT,
        raw_text TEXT NOT NULL,
        parsed_data TEXT,
        total_duration INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
        order_index INTEGER NOT NULL,
        episode_id TEXT,
        episode_title TEXT,
        episode_index INTEGER,
        title TEXT,
        description TEXT NOT NULL,
        dramatic TEXT,
        setting TEXT,
        characters TEXT,
        dialogues TEXT,
        duration INTEGER DEFAULT 8,
        narration TEXT,
        shot_type TEXT,
        camera_movement TEXT,
        camera_note TEXT,
        environment_capture_mode TEXT,
        transition_in TEXT,
        transition_out TEXT,
        transition_duration REAL,
        first_frame TEXT,
        last_frame TEXT,
        video_url TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT,
        appearance TEXT NOT NULL,
        personality TEXT,
        traits TEXT,
        background TEXT,
        motivation TEXT,
        speaking_style TEXT,
        catchphrase TEXT,
        voice_tone TEXT,
        voice_asset TEXT,
        age INTEGER,
        gender TEXT,
        base_image TEXT,
        expressions TEXT,
        views TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_tasks (
        id TEXT PRIMARY KEY,
        scene_id TEXT,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        config TEXT,
        video_data TEXT,
        audio_data TEXT,
        metadata TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generated_videos (
        id TEXT PRIMARY KEY,
        scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES video_tasks(id),
        video_path TEXT,
        audio_path TEXT,
        duration REAL,
        resolution TEXT,
        aspect_ratio TEXT,
        fps INTEGER DEFAULT 24,
        has_audio INTEGER DEFAULT 1,
        file_size INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_debug_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        request_json TEXT,
        request_raw_json TEXT,
        response_json TEXT,
        response_raw_json TEXT,
        media_refs_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL
      );
    ",
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let default_catalog = default_style_catalog();
    let default_style_presets_value = default_catalog
        .get("allPresets")
        .cloned()
        .unwrap_or_else(default_style_presets);
    let default_style_config_value = json!({
      "enabledStyleIds": default_catalog["enabledStyleIds"],
      "defaultStyleId": default_catalog["defaultStyleId"]
    });

    let mut reset_style_config = false;
    match get_config_json(&conn, STYLE_PRESET_DATA_KEY)? {
        Some(saved) => {
            if is_legacy_minimal_style_presets(&saved) {
                set_config_json(&conn, STYLE_PRESET_DATA_KEY, &default_style_presets_value)?;
                reset_style_config = true;
            }
        }
        None => {
            set_config_json(&conn, STYLE_PRESET_DATA_KEY, &default_style_presets_value)?;
            reset_style_config = true;
        }
    }
    match get_config_json(&conn, STYLE_PRESET_CONFIG_KEY)? {
        Some(_) if !reset_style_config => {}
        _ => {
            set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &default_style_config_value)?;
        }
    }
    if get_config_json(&conn, SELECTED_MODELS_KEY)?.is_none() {
        set_config_json(&conn, SELECTED_MODELS_KEY, &default_selected_models())?;
    }
    if get_config_json(&conn, WORKFLOW_MODELS_KEY)?.is_none() {
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &default_workflow_models())?;
    }
    if get_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?.is_none() {
        set_config_json(
            &conn,
            WORKFLOW_MODEL_OPTIONS_KEY,
            &default_workflow_model_options(),
        )?;
    }
    if get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?.is_none() {
        set_config_json(
            &conn,
            CUSTOM_OPENAI_CONFIG_KEY,
            &default_custom_openai_config(),
        )?;
    }
    if get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?.is_none() {
        set_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY, &json!({}))?;
    }
    match get_config_json(&conn, PROMPT_TEMPLATES_KEY)? {
        Some(saved) => {
            if is_legacy_minimal_prompt_templates(&saved) {
                let migrated_templates = get_config_json(&conn, PROMPT_PROFILE_STATE_KEY)?
                    .as_ref()
                    .and_then(extract_templates_from_prompt_profile_state)
                    .unwrap_or_else(default_prompt_templates);
                set_config_json(&conn, PROMPT_TEMPLATES_KEY, &migrated_templates)?;
            }
        }
        None => {
            set_config_json(&conn, PROMPT_TEMPLATES_KEY, &default_prompt_templates())?;
        }
    }
    if get_config_json(&conn, PROMPT_PROFILES_KEY)?.is_none() {
        set_config_json(&conn, PROMPT_PROFILES_KEY, &default_prompt_profiles())?;
    }
    if get_config_json(&conn, PROMPT_VERSIONS_KEY)?.is_none() {
        set_config_json(&conn, PROMPT_VERSIONS_KEY, &json!({}))?;
    }

    Ok(())
}

fn ensure_dirs(state: &BackendState) -> Result<(), ApiError> {
    fs::create_dir_all(&state.data_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(&state.public_dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(state.public_dir.join("videos"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(state.public_dir.join("generated-images"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(state.public_dir.join("audios"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(state.data_dir.join("generated-images"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::create_dir_all(state.data_dir.join("exports"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

pub async fn start_server(state: BackendState, host: &str, port: u16) -> Result<(), String> {
    ensure_dirs(&state).map_err(|error| error.message.clone())?;
    init_database(&state).map_err(|error| error.message.clone())?;

    let router = Router::new()
        .route("/api/project/list", get(api_project_list))
        .route("/api/project/create", post(api_project_create))
        .route(
            "/api/project/{id}",
            get(api_project_get)
                .put(api_project_put)
                .delete(api_project_delete),
        )
        .route("/api/styles", get(api_styles))
        .route("/api/styles/index", get(api_styles))
        .route(
            "/api/styles/config",
            get(api_styles_config).put(api_styles_config_put),
        )
        .route("/api/styles/presets", post(api_styles_preset_create))
        .route("/api/styles/presets/reset", post(api_styles_preset_reset))
        .route("/api/styles/presets/import", post(api_styles_preset_import))
        .route("/api/styles/presets/export", get(api_styles_preset_export))
        .route(
            "/api/styles/presets/{id}",
            put(api_styles_preset_update).delete(api_styles_preset_delete),
        )
        .route("/api/models", get(api_models))
        .route("/api/models/list", get(api_models))
        .route("/api/models/index", get(api_models))
        .route("/api/models/select", post(api_models_select))
        .route("/api/models/switch", post(api_models_switch))
        .route(
            "/api/models/workflow",
            get(api_models_workflow_get).post(api_models_workflow_post),
        )
        .route(
            "/api/models/custom-openai",
            get(api_custom_openai_get).put(api_custom_openai_put),
        )
        .route(
            "/api/models/custom-openai/sync",
            post(api_custom_openai_sync),
        )
        .route("/api/model-providers", get(api_model_providers))
        .route("/api/model-providers/index", get(api_model_providers))
        .route(
            "/api/model-providers/{provider}/models",
            put(api_model_provider_models_put),
        )
        .route(
            "/api/model-providers/{provider}/sync",
            post(api_model_provider_sync),
        )
        .route("/api/prompts", get(api_prompts_get))
        .route("/api/prompts/index", get(api_prompts_get))
        .route(
            "/api/prompts/profiles",
            get(api_prompt_profiles_get).post(api_prompt_profiles_post),
        )
        .route(
            "/api/prompts/profiles/{id}",
            put(api_prompt_profiles_put).delete(api_prompt_profiles_delete),
        )
        .route(
            "/api/prompts/profiles/{id}/activate",
            post(api_prompt_profiles_activate),
        )
        .route(
            "/api/prompts/{id}",
            get(api_prompts_single_get).put(api_prompts_single_put),
        )
        .route("/api/prompts/{id}/versions", get(api_prompts_versions_get))
        .route("/api/prompts/{id}/reset", post(api_prompts_single_reset))
        .route(
            "/api/prompts/{id}/restore",
            post(api_prompts_single_restore),
        )
        .route("/api/prompts/reset-all", post(api_prompts_reset_all))
        .route("/api/models/test", post(api_models_test))
        .route("/api/test", get(api_test))
        .route("/api/script/episode-plan", post(api_script_episode_plan))
        .route("/api/script/parse", post(api_script_parse))
        .route("/api/script/parse-stream", post(api_script_parse_stream))
        .route("/api/script/export-docx", post(api_script_export_docx))
        .route("/api/character/generate", post(api_character_generate))
        .route(
            "/api/character/voice/upload",
            post(api_character_voice_upload),
        )
        .route(
            "/api/asset-workflow/scene/description-refinement",
            post(api_asset_scene_description_refinement),
        )
        .route(
            "/api/asset-workflow/reference/generate",
            post(api_asset_reference_generate),
        )
        .route(
            "/api/asset-workflow/prop/generate",
            post(api_asset_prop_generate),
        )
        .route(
            "/api/asset-workflow/video/generate",
            post(api_asset_video_generate),
        )
        .route(
            "/api/asset-workflow/upload-image",
            post(api_asset_upload_image),
        )
        .route("/api/image/file/{*filename}", get(api_image_file))
        .route("/api/image/proxy", get(api_image_proxy))
        .route("/api/tos/files", get(api_tos_files))
        .route("/api/video/generate", post(api_video_generate))
        .route("/api/video/merge", post(api_video_merge))
        .route(
            "/api/video/export-jianying",
            post(api_video_export_jianying),
        )
        .route("/api/video/status/{id}", get(api_video_status))
        .route("/api/video/file/{*filename}", get(api_video_file))
        .route(
            "/api/debug/model-logs",
            get(api_debug_logs_get).delete(api_debug_logs_delete),
        )
        .route("/api/{*path}", any(api_not_implemented))
        .route("/", get(frontend_index))
        .route("/{*path}", get(frontend_assets))
        .with_state(state);

    let listener = TcpListener::bind((host, port))
        .await
        .map_err(|error| format!("Rust 后端监听失败: {}", error))?;
    axum::serve(listener, router.into_make_service())
        .await
        .map_err(|error| format!("Rust 后端服务异常退出: {}", error))
}

async fn frontend_index(State(state): State<BackendState>) -> Result<Response, ApiError> {
    serve_web_path(&state, "index.html").await
}

async fn frontend_assets(
    Path(path): Path<String>,
    State(state): State<BackendState>,
) -> Result<Response, ApiError> {
    if path.starts_with("api/") {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "API Not Found"));
    }
    let rel = sanitize_rel_path(&path).unwrap_or_else(|| "index.html".to_string());
    let candidate = state.web_dir.join(&rel);
    if candidate.is_file() {
        return serve_web_path(&state, &rel).await;
    }
    serve_web_path(&state, "index.html").await
}

async fn serve_web_path(state: &BackendState, rel_path: &str) -> Result<Response, ApiError> {
    let sanitized = sanitize_rel_path(rel_path)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效路径"))?;
    let file_path = state.web_dir.join(sanitized);
    if !file_path.is_file() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "页面不存在"));
    }
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "页面不存在"))?;
    Ok((
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static(path_content_type(&file_path)),
        )],
        data,
    )
        .into_response())
}

async fn api_image_file(
    Path(filename): Path<String>,
    State(state): State<BackendState>,
) -> Result<Response, ApiError> {
    serve_media_file(
        &[
            state.data_dir.join("generated-images"),
            state.public_dir.join("generated-images"),
        ],
        &filename,
    )
    .await
}

async fn api_video_file(
    Path(filename): Path<String>,
    State(state): State<BackendState>,
) -> Result<Response, ApiError> {
    serve_media_file(
        &[
            state.public_dir.join("videos"),
            state.public_dir.join("audios"),
            state.data_dir.join("videos"),
        ],
        &filename,
    )
    .await
}

async fn serve_media_file(roots: &[PathBuf], filename: &str) -> Result<Response, ApiError> {
    let rel = sanitize_rel_path(filename)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效文件名"))?;
    if rel.contains('/') {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效文件名"));
    }

    for root in roots {
        let path = root.join(&rel);
        if path.is_file() {
            let data = tokio::fs::read(&path)
                .await
                .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "文件不存在"))?;
            return Ok((
                [
                    (
                        header::CONTENT_TYPE,
                        HeaderValue::from_static(path_content_type(&path)),
                    ),
                    (
                        header::CACHE_CONTROL,
                        HeaderValue::from_static("public, max-age=31536000, immutable"),
                    ),
                ],
                data,
            )
                .into_response());
        }
    }

    Err(ApiError::new(StatusCode::NOT_FOUND, "文件不存在"))
}

async fn api_project_list(
    State(state): State<BackendState>,
    Query(query): Query<ProjectListQuery>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * page_size;

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at
             FROM projects ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let projects = stmt
        .query_map(params![page_size as i64, offset as i64], |row| {
            Ok(json!({
              "id": row.get::<_, String>(0)?,
              "title": row.get::<_, String>(1)?,
              "description": row.get::<_, Option<String>>(2)?,
              "scriptParseMode": row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "short_drama".to_string()),
              "styleId": row.get::<_, String>(4)?,
              "aspectRatio": row.get::<_, String>(5)?,
              "status": row.get::<_, Option<String>>(6)?,
              "totalScenes": 0,
              "completedScenes": 0,
              "totalDuration": 0,
              "createdAt": row.get::<_, String>(7)?,
              "updatedAt": row.get::<_, String>(8)?
            }))
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let total_pages = ((total as f64) / (page_size as f64)).ceil().max(1.0) as usize;

    Ok(Json(json!({
      "success": true,
      "projects": projects,
      "pagination": {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages
      }
    })))
}

async fn api_project_create(
    State(state): State<BackendState>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<Value>, ApiError> {
    if body.title.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "title 不能为空"));
    }

    let conn = db_connection(&state)?;
    let now = now_iso();
    let id = format!("proj_{}", Uuid::new_v4().simple());
    let style_id = body
        .style_id
        .unwrap_or_else(|| "ghibli".to_string())
        .trim()
        .to_string();
    let aspect_ratio = body
        .aspect_ratio
        .unwrap_or_else(|| "9:16".to_string())
        .trim()
        .to_string();
    let script_parse_mode = body
        .script_parse_mode
        .unwrap_or_else(|| "short_drama".to_string())
        .trim()
        .to_string();

    conn.execute(
        "INSERT INTO projects (id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8)",
        params![
            id,
            body.title.trim(),
            body.description.unwrap_or_default(),
            script_parse_mode,
            style_id,
            aspect_ratio,
            now,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "project": {
        "id": id
      }
    })))
}

async fn api_project_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let affected = conn
        .execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if affected == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "项目不存在"));
    }
    Ok(Json(json!({
      "success": true,
      "message": "项目已删除"
    })))
}

async fn api_project_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let project = conn
        .query_row(
            "SELECT id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at
             FROM projects WHERE id = ?1 LIMIT 1",
            params![id],
            |row| {
                Ok(json!({
                  "id": row.get::<_, String>(0)?,
                  "name": row.get::<_, String>(1)?,
                  "description": row.get::<_, Option<String>>(2)?,
                  "scriptParseMode": row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "short_drama".to_string()),
                  "styleId": row.get::<_, String>(4)?,
                  "aspectRatio": row.get::<_, String>(5)?,
                  "status": row.get::<_, Option<String>>(6)?,
                  "createdAt": row.get::<_, String>(7)?,
                  "updatedAt": row.get::<_, String>(8)?
                }))
            },
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let project = project.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "项目不存在"))?;

    let script_row: Option<(String, Option<String>, String, Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT id, title, raw_text, parsed_data, total_duration FROM scripts WHERE project_id = ?1 LIMIT 1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let (script_id, script_payload) = match script_row {
        Some((script_id, title, raw_text, parsed_data, total_duration)) => {
            let parsed = serde_json::from_str::<Value>(&raw_text)
                .unwrap_or_else(|_| json!({"rawText": raw_text}));
            let payload = json!({
              "id": script_id.clone(),
              "title": title,
              "storyIdea": parsed.get("storyIdea").cloned().or_else(|| parsed.get("rawText").cloned()).unwrap_or(json!("")),
              "novelText": parsed.get("novelText").cloned().unwrap_or(json!("")),
              "rawText": parsed.get("rawText").cloned().or_else(|| parsed.get("storyIdea").cloned()).unwrap_or(json!("")),
              "selectedStyleId": parsed.get("selectedStyleId").cloned().unwrap_or(json!("")),
              "inputMode": parsed.get("inputMode").cloned().unwrap_or(json!("idea")),
              "scriptParseMode": parsed.get("scriptParseMode").cloned().or_else(|| project.get("scriptParseMode").cloned()).unwrap_or(json!("short_drama")),
              "episodePlan": parsed.get("episodePlan").cloned().unwrap_or_else(|| json!([])),
              "assetWorkflow": parsed.get("assetWorkflow").cloned().unwrap_or(Value::Null),
              "parsedData": parsed_data.and_then(|value| serde_json::from_str::<Value>(&value).ok()).unwrap_or(Value::Null),
              "totalDuration": total_duration.unwrap_or(0)
            });
            (Some(script_id), Some(payload))
        }
        None => (None, None),
    };

    let scenes = if let Some(script_id) = script_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, order_index, episode_id, episode_title, episode_index, title, description,
                        dramatic, setting, characters, dialogues, duration, narration, shot_type, camera_movement,
                        camera_note, environment_capture_mode, transition_in, transition_out, transition_duration,
                        first_frame, last_frame, video_url, status
                 FROM scenes WHERE script_id = ?1 ORDER BY order_index ASC",
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        let mapped_rows = stmt
            .query_map(params![script_id], |row| {
                let parse = |value: Option<String>| -> Value {
                    value
                        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                        .unwrap_or(Value::Null)
                };
                let video_url: Option<String> = row.get(22)?;
                let status: Option<String> = row.get(23)?;
                Ok(json!({
                  "id": row.get::<_, String>(0)?,
                  "orderIndex": row.get::<_, i64>(1)?,
                  "episodeId": row.get::<_, Option<String>>(2)?,
                  "episodeTitle": row.get::<_, Option<String>>(3)?,
                  "episodeIndex": row.get::<_, Option<i64>>(4)?,
                  "title": row.get::<_, Option<String>>(5)?,
                  "description": row.get::<_, String>(6)?,
                  "dramatic": parse(row.get(7)?),
                  "setting": parse(row.get(8)?),
                  "characters": parse(row.get(9)?),
                  "dialogues": parse(row.get(10)?),
                  "duration": row.get::<_, Option<i64>>(11)?.unwrap_or(8),
                  "narration": row.get::<_, Option<String>>(12)?,
                  "shotType": row.get::<_, Option<String>>(13)?,
                  "cameraMovement": row.get::<_, Option<String>>(14)?,
                  "cameraNote": row.get::<_, Option<String>>(15)?,
                  "environmentCaptureMode": row.get::<_, Option<String>>(16)?,
                  "transitionIn": row.get::<_, Option<String>>(17)?,
                  "transitionOut": row.get::<_, Option<String>>(18)?,
                  "transitionDuration": row.get::<_, Option<f64>>(19)?,
                  "firstFrame": row.get::<_, Option<String>>(20)?,
                  "lastFrame": row.get::<_, Option<String>>(21)?,
                  "videoUrl": video_url,
                  "status": if video_url.as_ref().is_some_and(|value| !value.trim().is_empty()) {
                    "video_ready".to_string()
                  } else {
                    status.unwrap_or_else(|| "pending".to_string())
                  }
                }))
            })
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        mapped_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    } else {
        Vec::new()
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, name, role, appearance, personality, traits, background, motivation,
                    speaking_style, catchphrase, voice_tone, voice_asset, age, gender, base_image, expressions, views
             FROM characters WHERE project_id = ?1",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let characters = stmt
        .query_map(params![id], |row| {
            let parse = |value: Option<String>| -> Value {
                value
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .unwrap_or(Value::Null)
            };
            let base_image: Option<String> = row.get(14)?;
            Ok(json!({
              "id": row.get::<_, String>(0)?,
              "name": row.get::<_, String>(1)?,
              "role": row.get::<_, Option<String>>(2)?,
              "appearance": row.get::<_, String>(3)?,
              "personality": row.get::<_, Option<String>>(4)?,
              "traits": parse(row.get(5)?),
              "background": row.get::<_, Option<String>>(6)?,
              "motivation": row.get::<_, Option<String>>(7)?,
              "speakingStyle": row.get::<_, Option<String>>(8)?,
              "catchphrase": row.get::<_, Option<String>>(9)?,
              "voiceTone": row.get::<_, Option<String>>(10)?,
              "voiceAsset": parse(row.get(11)?),
              "age": row.get::<_, Option<i64>>(12)?,
              "gender": row.get::<_, Option<String>>(13)?,
              "imageUrl": base_image,
              "baseImage": base_image,
              "expressions": parse(row.get(15)?),
              "views": parse(row.get(16)?)
            }))
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "project": project,
        "script": script_payload,
        "scenes": scenes,
        "characters": characters
      }
    })))
}

async fn api_project_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let now = now_iso();

    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未命名项目")
        .trim()
        .to_string();
    let description = body
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        .to_string();
    let style_id = body
        .get("styleId")
        .and_then(Value::as_str)
        .unwrap_or("ghibli")
        .to_string();
    let aspect_ratio = body
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or("9:16")
        .to_string();
    let script_parse_mode = body
        .get("scriptParseMode")
        .and_then(Value::as_str)
        .unwrap_or("short_drama")
        .to_string();

    let affected = conn
        .execute(
            "UPDATE projects SET name = ?1, description = ?2, status = ?3, style_id = ?4, aspect_ratio = ?5, script_parse_mode = ?6, updated_at = ?7 WHERE id = ?8",
            params![name, description, status, style_id, aspect_ratio, script_parse_mode, now, id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if affected == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "项目不存在"));
    }

    let script_id: String = match conn
        .query_row(
            "SELECT id FROM scripts WHERE project_id = ?1 LIMIT 1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    {
        Some(script_id) => script_id,
        None => {
            let new_script_id = format!("script_{}", Uuid::new_v4().simple());
            conn.execute(
                "INSERT INTO scripts (id, project_id, title, raw_text, parsed_data, total_duration, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5, ?6)",
                params![
                    new_script_id,
                    id,
                    Option::<String>::None,
                    "{}".to_string(),
                    now,
                    now
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            new_script_id
        }
    };

    let script_payload = json!({
      "storyIdea": body.get("storyIdea").cloned().unwrap_or(Value::Null),
      "novelText": body.get("novelText").cloned().unwrap_or(Value::Null),
      "rawText": body.get("rawText").cloned().unwrap_or_else(|| body.get("novelText").cloned().unwrap_or(Value::Null)),
      "selectedStyleId": body.get("selectedStyleId").cloned().unwrap_or(Value::Null),
      "inputMode": body.get("inputMode").cloned().unwrap_or(Value::Null),
      "scriptParseMode": body.get("scriptParseMode").cloned().unwrap_or(Value::Null),
      "episodePlan": body.get("episodePlan").cloned().unwrap_or_else(|| json!([])),
      "assetWorkflow": body.get("assetWorkflow").cloned().unwrap_or(Value::Null)
    });
    conn.execute(
        "UPDATE scripts SET raw_text = ?1, updated_at = ?2 WHERE id = ?3",
        params![script_payload.to_string(), now, script_id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if let Some(scenes) = body.get("scenes").and_then(Value::as_array) {
        conn.execute(
            "DELETE FROM scenes WHERE script_id = ?1",
            params![script_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        for (index, scene) in scenes.iter().enumerate() {
            let scene_id = scene
                .get("id")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .unwrap_or_else(|| format!("scene_{}", Uuid::new_v4().simple()));
            let order_index = scene
                .get("orderIndex")
                .and_then(Value::as_i64)
                .unwrap_or(index as i64);
            let description = scene
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let duration = scene.get("duration").and_then(Value::as_i64).unwrap_or(8);
            let video_url = scene
                .get("videoUrl")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            let status = scene
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or(if video_url.is_some() {
                    "video_ready"
                } else {
                    "pending"
                })
                .to_string();
            let encode = |key: &str| -> Option<String> {
                scene.get(key).and_then(|value| {
                    if value.is_null() {
                        None
                    } else {
                        Some(value.to_string())
                    }
                })
            };

            conn.execute(
                "INSERT INTO scenes (
                  id, script_id, order_index, episode_id, episode_title, episode_index, title, description,
                  dramatic, setting, characters, dialogues, duration, narration, shot_type, camera_movement,
                  camera_note, environment_capture_mode, transition_in, transition_out, transition_duration,
                  first_frame, last_frame, video_url, status, created_at, updated_at
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                  ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                  ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27
                )",
                params![
                    scene_id,
                    script_id,
                    order_index,
                    scene.get("episodeId").and_then(Value::as_str),
                    scene.get("episodeTitle").and_then(Value::as_str),
                    scene.get("episodeIndex").and_then(Value::as_i64),
                    scene.get("title").and_then(Value::as_str),
                    description,
                    encode("dramatic"),
                    encode("setting"),
                    encode("characters"),
                    encode("dialogues"),
                    duration,
                    scene.get("narration").and_then(Value::as_str),
                    scene.get("shotType").and_then(Value::as_str),
                    scene.get("cameraMovement").and_then(Value::as_str),
                    scene.get("cameraNote").and_then(Value::as_str),
                    scene.get("environmentCaptureMode").and_then(Value::as_str),
                    scene.get("transitionIn").and_then(Value::as_str),
                    scene.get("transitionOut").and_then(Value::as_str),
                    scene.get("transitionDuration").and_then(Value::as_f64),
                    scene.get("firstFrame").and_then(Value::as_str),
                    scene.get("lastFrame").and_then(Value::as_str),
                    video_url,
                    status,
                    now,
                    now
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
    }

    if let Some(characters) = body.get("characters").and_then(Value::as_array) {
        conn.execute("DELETE FROM characters WHERE project_id = ?1", params![id])
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        for character in characters {
            let character_id = character
                .get("id")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .unwrap_or_else(|| format!("char_{}", Uuid::new_v4().simple()));
            let appearance = character
                .get("appearance")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let encode = |key: &str| -> Option<String> {
                character.get(key).and_then(|value| {
                    if value.is_null() {
                        None
                    } else {
                        Some(value.to_string())
                    }
                })
            };

            conn.execute(
                "INSERT INTO characters (
                  id, project_id, name, role, appearance, personality, traits, background, motivation, speaking_style,
                  catchphrase, voice_tone, voice_asset, age, gender, base_image, expressions, views, created_at, updated_at
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
                )",
                params![
                    character_id,
                    id,
                    character.get("name").and_then(Value::as_str).unwrap_or("未命名角色"),
                    character.get("role").and_then(Value::as_str),
                    appearance,
                    character.get("personality").and_then(Value::as_str),
                    encode("traits"),
                    character.get("background").and_then(Value::as_str),
                    character.get("motivation").and_then(Value::as_str),
                    character.get("speakingStyle").and_then(Value::as_str),
                    character.get("catchphrase").and_then(Value::as_str),
                    character.get("voiceTone").and_then(Value::as_str),
                    encode("voiceAsset"),
                    character.get("age").and_then(Value::as_i64),
                    character.get("gender").and_then(Value::as_str),
                    character
                        .get("baseImage")
                        .and_then(Value::as_str)
                        .or_else(|| character.get("imageUrl").and_then(Value::as_str)),
                    encode("expressions"),
                    encode("views"),
                    now,
                    now
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
    }

    Ok(Json(json!({
      "success": true
    })))
}

async fn api_styles(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let default_catalog = default_style_catalog();
    let presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_catalog["allPresets"].clone());
    let config = get_config_json(&conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        })
    });

    Ok(Json(json!({
      "success": true,
      "data": {
        "presets": presets,
        "categories": default_style_categories(),
        "defaultStyleId": config.get("defaultStyleId").cloned().unwrap_or(json!("ghibli")),
        "enabledStyleIds": config.get("enabledStyleIds").cloned().unwrap_or_else(|| json!(["ghibli"]))
      }
    })))
}

async fn api_styles_config(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let default_catalog = default_style_catalog();
    let presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_catalog["allPresets"].clone());
    let config = get_config_json(&conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        })
    });

    Ok(Json(json!({
      "success": true,
      "data": {
        "allPresets": presets,
        "enabledStyleIds": config.get("enabledStyleIds").cloned().unwrap_or_else(|| json!([])),
        "defaultStyleId": config.get("defaultStyleId").cloned().unwrap_or(json!("ghibli"))
      }
    })))
}

async fn api_styles_config_put(
    State(state): State<BackendState>,
    Json(body): Json<SaveStyleConfigBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let default_catalog = default_style_catalog();
    let presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_catalog["allPresets"].clone());

    let preset_list = presets.as_array().cloned().unwrap_or_default();
    let valid_ids: HashSet<String> = preset_list
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();

    let mut enabled: Vec<String> = Vec::new();
    for id in body.enabled_style_ids {
        if valid_ids.contains(&id) && !enabled.contains(&id) {
            enabled.push(id);
        }
    }
    if enabled.is_empty() {
        enabled.push("ghibli".to_string());
    }
    let default_id = body
        .default_style_id
        .filter(|value| enabled.contains(value))
        .unwrap_or_else(|| enabled[0].clone());

    let payload = json!({
      "enabledStyleIds": enabled,
      "defaultStyleId": default_id
    });
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &payload)?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "allPresets": presets,
        "enabledStyleIds": payload["enabledStyleIds"],
        "defaultStyleId": payload["defaultStyleId"]
      }
    })))
}

async fn api_styles_preset_create(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_style_catalog()["allPresets"].clone());
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;

    let mut next = body.clone();
    if !next.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效预设数据"));
    }

    let id = next
        .get("id")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("style_{}", Uuid::new_v4().simple()));

    if list
        .iter()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "画风ID已存在"));
    }

    if let Some(obj) = next.as_object_mut() {
        obj.insert("id".to_string(), json!(id));
    }
    list.push(next);
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;

    Ok(Json(json!({ "success": true })))
}

async fn api_styles_preset_update(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_style_catalog()["allPresets"].clone());
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;

    let target = list
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "画风不存在"))?;

    *target = body;
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    Ok(Json(json!({ "success": true })))
}

async fn api_styles_preset_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_style_catalog()["allPresets"].clone());
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;
    list.retain(|item| item.get("id").and_then(Value::as_str) != Some(id.as_str()));
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    Ok(Json(json!({ "success": true })))
}

async fn api_styles_preset_reset(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let default_catalog = default_style_catalog();
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &default_catalog["allPresets"])?;
    set_config_json(
        &conn,
        STYLE_PRESET_CONFIG_KEY,
        &json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        }),
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn api_styles_preset_import(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let payload = body
        .get("payload")
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "缺少 payload"))?;
    let presets = payload
        .get("allPresets")
        .cloned()
        .or_else(|| payload.get("presets").cloned())
        .unwrap_or_else(|| json!([]));
    let enabled_ids = payload
        .get("enabledStyleIds")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let default_style = payload
        .get("defaultStyleId")
        .cloned()
        .unwrap_or_else(|| json!("ghibli"));

    let conn = db_connection(&state)?;
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    set_config_json(
        &conn,
        STYLE_PRESET_CONFIG_KEY,
        &json!({
          "enabledStyleIds": enabled_ids,
          "defaultStyleId": default_style
        }),
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn api_styles_preset_export(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let presets = get_config_json(&conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_style_catalog()["allPresets"].clone());
    let config = get_config_json(&conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": ["ghibli"],
          "defaultStyleId": "ghibli"
        })
    });

    Ok(Json(json!({
      "success": true,
      "data": {
        "version": 1,
        "exportedAt": now_iso(),
        "allPresets": presets,
        "enabledStyleIds": config.get("enabledStyleIds").cloned().unwrap_or_else(|| json!([])),
        "defaultStyleId": config.get("defaultStyleId").cloned().unwrap_or(json!("ghibli"))
      }
    })))
}

async fn api_models(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let selected =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    Ok(Json(json!({
      "success": true,
      "data": {
        "available": default_available_models(),
        "selected": selected
      }
    })))
}

async fn api_models_select(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    api_models_switch(State(state), Json(body)).await
}

async fn api_models_switch(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let model_type = body.get("type").and_then(Value::as_str).unwrap_or("");
    let model_id = body.get("modelId").and_then(Value::as_str).unwrap_or("");
    if model_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "modelId 不能为空"));
    }

    let conn = db_connection(&state)?;
    let mut selected =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    if let Some(obj) = selected.as_object_mut() {
        match model_type {
            "text" => {
                obj.insert("text".to_string(), json!(model_id));
            }
            "image" => {
                obj.insert("image".to_string(), json!(model_id));
            }
            "video" => {
                obj.insert("video".to_string(), json!(model_id));
            }
            "tts" => {
                obj.insert("tts".to_string(), json!(model_id));
            }
            "asr" => {
                obj.insert("asr".to_string(), json!(model_id));
            }
            _ => {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的模型类型"));
            }
        }
    }
    set_config_json(&conn, SELECTED_MODELS_KEY, &selected)?;
    Ok(Json(json!({ "success": true, "data": selected })))
}

async fn api_models_workflow_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let selections =
        get_config_json(&conn, WORKFLOW_MODELS_KEY)?.unwrap_or_else(default_workflow_models);
    let model_options = get_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?
        .unwrap_or_else(default_workflow_model_options);
    let available = default_available_models();

    let workflows = default_workflow_steps()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|step| {
            let step_id = step.get("id").and_then(Value::as_str).unwrap_or("");
            let category = step.get("category").and_then(Value::as_str).unwrap_or("");
            let compatible = match category {
                "text" => available.get("text").cloned().unwrap_or_else(|| json!([])),
                "image" => available.get("image").cloned().unwrap_or_else(|| json!([])),
                "video" => available.get("video").cloned().unwrap_or_else(|| json!([])),
                _ => json!([]),
            };
            let current = selections
                .get(step_id)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            json!({
              "id": step_id,
              "name": step.get("name").cloned().unwrap_or(json!(step_id)),
              "description": step.get("description").cloned().unwrap_or(json!("")),
              "category": category,
              "requiredCapabilities": step.get("requiredCapabilities").cloned().unwrap_or_else(|| json!([])),
              "optionalCapabilities": step.get("optionalCapabilities").cloned().unwrap_or_else(|| json!([])),
              "compatibleModels": compatible,
              "selectedModel": if current.is_empty() { Value::Null } else { json!(current) }
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({
      "success": true,
      "data": {
        "workflows": workflows,
        "currentSelections": selections,
        "modelOptions": model_options
      }
    })))
}

async fn api_models_workflow_post(
    State(state): State<BackendState>,
    Json(body): Json<UpdateWorkflowBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;

    if let Some(models) = body.models {
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &models)?;
    } else if let (Some(step), Some(model_id)) = (body.step.clone(), body.model_id.clone()) {
        let mut current =
            get_config_json(&conn, WORKFLOW_MODELS_KEY)?.unwrap_or_else(default_workflow_models);
        if let Some(obj) = current.as_object_mut() {
            obj.insert(step, json!(model_id));
        }
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &current)?;
    } else if let (Some(step), Some(model_options)) = (body.step, body.model_options) {
        let mut current = get_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?
            .unwrap_or_else(default_workflow_model_options);
        if let Some(obj) = current.as_object_mut() {
            obj.insert(step, model_options);
        }
        set_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY, &current)?;
    } else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "无效的工作流更新参数",
        ));
    }

    Ok(Json(json!({ "success": true })))
}

const SUPPORTED_MODEL_PROVIDERS: [&str; 6] = [
    "qwen",
    "volcengine",
    "deepseek",
    "custom_openai",
    "gemini",
    "kling",
];

fn is_supported_provider(provider: &str) -> bool {
    SUPPORTED_MODEL_PROVIDERS.contains(&provider)
}

fn env_var_non_empty(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn json_string_list(value: Option<&Value>) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();

    let Some(items) = value.and_then(Value::as_array) else {
        return output;
    };

    for item in items {
        let Some(text) = item.as_str().map(str::trim) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        let owned = text.to_string();
        if seen.insert(owned.clone()) {
            output.push(owned);
        }
    }

    output
}

fn static_provider_models(provider: &str) -> Vec<String> {
    match provider {
        "qwen" => vec![
            "qwen3.6-plus".to_string(),
            "qwen-image-2.0-pro".to_string(),
            "wan2.7-t2v".to_string(),
        ],
        "volcengine" => vec![
            "doubao-seed-2.0-pro".to_string(),
            "doubao-seedream-5-0-lite".to_string(),
            "doubao-seedance-2.0".to_string(),
        ],
        "deepseek" => vec!["deepseek-v4-pro".to_string(), "deepseek-v4-flash".to_string()],
        "gemini" => vec![
            "gemini-3-flash-preview".to_string(),
            "gemini-3.1-pro-preview".to_string(),
        ],
        "kling" => vec![
            "kling-v2-6".to_string(),
            "kling-v3".to_string(),
            "kling-v3-omni".to_string(),
        ],
        "custom_openai" => vec![],
        _ => vec![],
    }
}

fn resolve_provider_meta(
    provider: &str,
) -> Option<(
    &'static str,
    &'static str,
    &'static str,
    bool,
)> {
    match provider {
        "qwen" => Some((
            "通义千问",
            "通过 DashScope OpenAI 兼容 /models 同步账号可用模型，再按本地能力表过滤可用流程模型。",
            "official_api",
            true,
        )),
        "volcengine" => Some((
            "火山引擎",
            "通过方舟 OpenAI 兼容 /models 同步账号可用模型，再按本地能力表过滤可用流程模型。",
            "official_api",
            true,
        )),
        "deepseek" => Some((
            "DeepSeek",
            "通过 DeepSeek 官方 OpenAI 兼容 /models 同步账号可用模型，默认接入文本生成流程。",
            "official_api",
            true,
        )),
        "custom_openai" => Some((
            "自定义 OpenAI",
            "通过自定义 OpenAI 兼容 /models 同步模型，默认接入文本生成流程。",
            "official_api",
            true,
        )),
        "gemini" => Some((
            "Google Gemini",
            "当前使用本地能力表；模型能力仍由 Gemini 专用接口和仓库能力配置约束。",
            "manual",
            false,
        )),
        "kling" => Some((
            "可灵 AI",
            "当前使用本地能力表；图片/视频能力依赖可灵专用接口参数。",
            "manual",
            false,
        )),
        _ => None,
    }
}

fn resolve_provider_configured(provider: &str, custom_openai: &Value) -> bool {
    match provider {
        "qwen" => env_var_non_empty("QWEN_API_KEY"),
        "volcengine" => env_var_non_empty("VOLCENGINE_API_KEY"),
        "deepseek" => env_var_non_empty("DEEPSEEK_API_KEY"),
        "gemini" => env_var_non_empty("GEMINI_API_KEY"),
        "kling" => env_var_non_empty("KLING_ACCESS_KEY") && env_var_non_empty("KLING_SECRET_KEY"),
        "custom_openai" => {
            let api_key = custom_openai
                .get("apiKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            let base_url = custom_openai
                .get("baseUrl")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            !api_key.is_empty() && !base_url.is_empty()
        }
        _ => false,
    }
}

fn resolve_provider_models(
    provider: &str,
    catalog_entry: Option<&Value>,
    custom_openai: &Value,
) -> (Vec<String>, Vec<String>, Option<String>, Option<String>) {
    if provider == "custom_openai" {
        let models = json_string_list(custom_openai.get("textModels"));
        let available = {
            let custom_available = json_string_list(custom_openai.get("availableTextModels"));
            if custom_available.is_empty() {
                models.clone()
            } else {
                custom_available
            }
        };
        let synced_at = custom_openai
            .get("modelsSyncedAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        let sync_error = custom_openai
            .get("modelsSyncError")
            .and_then(Value::as_str)
            .map(str::to_string);

        return (models, available, synced_at, sync_error);
    }

    let static_models = static_provider_models(provider);
    let models = {
        let catalog_models = json_string_list(catalog_entry.and_then(|item| item.get("models")));
        if catalog_models.is_empty() {
            static_models.clone()
        } else {
            catalog_models
        }
    };
    let available = {
        let catalog_available =
            json_string_list(catalog_entry.and_then(|item| item.get("availableModels")));
        if catalog_available.is_empty() {
            static_models
        } else {
            catalog_available
        }
    };
    let synced_at = catalog_entry
        .and_then(|item| item.get("syncedAt"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let sync_error = catalog_entry
        .and_then(|item| item.get("syncError"))
        .and_then(Value::as_str)
        .map(str::to_string);

    (models, available, synced_at, sync_error)
}

fn provider_summary(conn: &Connection) -> Result<Vec<Value>, ApiError> {
    let catalog = get_config_json(conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
    let custom_openai = get_config_json(conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let custom_display_name = custom_openai
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("自定义 OpenAI")
        .to_string();

    let mut providers = Vec::new();
    for provider in SUPPORTED_MODEL_PROVIDERS {
        let Some((default_display_name, description, sync_mode, supported_dynamic_sync)) =
            resolve_provider_meta(provider)
        else {
            continue;
        };

        let display_name = if provider == "custom_openai" {
            custom_display_name.clone()
        } else {
            default_display_name.to_string()
        };

        let catalog_entry = catalog
            .as_object()
            .and_then(|items| items.get(provider));
        let (models, available_models, synced_at, sync_error) =
            resolve_provider_models(provider, catalog_entry, &custom_openai);

        providers.push(json!({
          "provider": provider,
          "displayName": display_name,
          "description": description,
          "syncMode": sync_mode,
          "configured": resolve_provider_configured(provider, &custom_openai),
          "supportedDynamicSync": supported_dynamic_sync,
          "syncedAt": synced_at,
          "syncError": sync_error,
          "modelCount": models.len(),
          "models": models,
          "availableModels": available_models
        }));
    }

    Ok(providers)
}

async fn api_model_providers(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    Ok(Json(json!({
      "success": true,
      "data": { "providers": provider_summary(&conn)? }
    })))
}

async fn api_model_provider_models_put(
    Path(provider): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<PutProviderModelsBody>,
) -> Result<Json<Value>, ApiError> {
    if !is_supported_provider(&provider) {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"));
    }

    let conn = db_connection(&state)?;
    let mut catalog = get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
    if !catalog.is_object() {
        catalog = json!({});
    }

    let current_summary = provider_summary(&conn)?
        .into_iter()
        .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

    let available_models = json_string_list(current_summary.get("availableModels"));
    let available_set: HashSet<String> = available_models.iter().cloned().collect();
    let mut next_models = Vec::new();
    let mut seen = HashSet::new();
    for model in body.models {
        let normalized = model.trim().to_string();
        if normalized.is_empty() {
            continue;
        }
        if !available_set.is_empty() && !available_set.contains(&normalized) {
            continue;
        }
        if seen.insert(normalized.clone()) {
            next_models.push(normalized);
        }
    }

    if let Some(obj) = catalog.as_object_mut() {
        let mut entry = obj
            .get(&provider)
            .cloned()
            .unwrap_or_else(|| json!({}));
        if !entry.is_object() {
            entry = json!({});
        }
        if let Some(entry_obj) = entry.as_object_mut() {
            entry_obj.insert("models".to_string(), json!(next_models));
            entry_obj.insert("availableModels".to_string(), json!(available_models));
        }
        obj.insert(provider.clone(), entry);
    }

    set_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY, &catalog)?;

    let updated = provider_summary(&conn)?
        .into_iter()
        .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

    Ok(Json(json!({
      "success": true,
      "data": updated
    })))
}

async fn api_model_provider_sync(
    Path(provider): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if !is_supported_provider(&provider) {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"));
    }

    let conn = db_connection(&state)?;
    let mut catalog = get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
    if !catalog.is_object() {
        catalog = json!({});
    }

    let current_summary = provider_summary(&conn)?
        .into_iter()
        .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

    let current_models = json_string_list(current_summary.get("models"));
    let available_models = json_string_list(current_summary.get("availableModels"));
    let next_models = if current_models.is_empty() {
        available_models.clone()
    } else {
        current_models
    };

    if let Some(obj) = catalog.as_object_mut() {
        let mut entry = obj
            .get(&provider)
            .cloned()
            .unwrap_or_else(|| json!({}));
        if !entry.is_object() {
            entry = json!({});
        }
        if let Some(entry_obj) = entry.as_object_mut() {
            entry_obj.insert("models".to_string(), json!(next_models));
            entry_obj.insert("availableModels".to_string(), json!(available_models));
            entry_obj.insert("syncedAt".to_string(), json!(now_iso()));
            entry_obj.insert("syncError".to_string(), Value::Null);
        }
        obj.insert(provider.clone(), entry);
    }

    set_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY, &catalog)?;

    let updated = provider_summary(&conn)?
        .into_iter()
        .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

    Ok(Json(json!({
      "success": true,
      "data": updated
    })))
}

async fn api_custom_openai_get(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let has_key = config
        .get("apiKey")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let mut public_config = config.clone();
    if let Some(obj) = public_config.as_object_mut() {
        obj.remove("apiKey");
        obj.insert("hasApiKey".to_string(), json!(has_key));
    }

    Ok(Json(json!({
      "success": true,
      "data": public_config
    })))
}

async fn api_custom_openai_put(
    State(state): State<BackendState>,
    Json(body): Json<CustomOpenAIPutBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);

    if let Some(obj) = config.as_object_mut() {
        if let Some(enabled) = body.enabled {
            obj.insert("enabled".to_string(), json!(enabled));
        }
        if let Some(display_name) = body.display_name {
            obj.insert("displayName".to_string(), json!(display_name));
        }
        if let Some(base_url) = body.base_url {
            obj.insert("baseUrl".to_string(), json!(base_url));
        }
        if let Some(api_key) = body.api_key {
            obj.insert("apiKey".to_string(), json!(api_key));
        }
        if let Some(text_models) = body.text_models {
            obj.insert("textModels".to_string(), json!(text_models));
        }
        if let Some(available) = body.available_text_models {
            obj.insert("availableTextModels".to_string(), json!(available));
        }
        if let Some(synced_at) = body.models_synced_at {
            obj.insert("modelsSyncedAt".to_string(), json!(synced_at));
        }
        if let Some(sync_error) = body.models_sync_error {
            obj.insert("modelsSyncError".to_string(), json!(sync_error));
        }
    }

    set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;
    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_sync(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    if let Some(obj) = config.as_object_mut() {
        obj.insert("modelsSyncedAt".to_string(), json!(now_iso()));
        obj.insert("modelsSyncError".to_string(), Value::Null);
    }
    set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;
    api_custom_openai_get(State(state)).await
}

async fn api_debug_logs_get(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(100)
        .clamp(1, 500);
    let provider_filter = query
        .get("provider")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let operation_filter = query
        .get("operation")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let status_filter = query
        .get("status")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let model_filter = query
        .get("model")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let keyword_filter = query
        .get("keyword")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());

    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, provider, model, operation, status, duration_ms,
                    request_json, request_raw_json, response_json, response_raw_json,
                    media_refs_json, error_json
             FROM model_debug_logs ORDER BY timestamp DESC LIMIT 1000",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let logs_raw = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let parse_json = |raw: Option<String>| -> Option<Value> {
        let text = raw?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        serde_json::from_str::<Value>(trimmed)
            .ok()
            .or_else(|| Some(Value::String(text)))
    };

    let mut logs = Vec::new();
    for (
        id,
        timestamp,
        provider,
        model,
        operation,
        status,
        duration_ms,
        request_json,
        request_raw_json,
        response_json,
        response_raw_json,
        media_refs_json,
        error_json,
    ) in logs_raw
    {
        let provider_lower = provider.to_ascii_lowercase();
        let model_lower = model.to_ascii_lowercase();
        let operation_lower = operation.to_ascii_lowercase();
        let status_lower = status.to_ascii_lowercase();

        if provider_filter
            .as_ref()
            .is_some_and(|value| provider_lower != *value)
        {
            continue;
        }
        if operation_filter
            .as_ref()
            .is_some_and(|value| operation_lower != *value)
        {
            continue;
        }
        if status_filter
            .as_ref()
            .is_some_and(|value| status_lower != *value)
        {
            continue;
        }
        if model_filter
            .as_ref()
            .is_some_and(|value| !model_lower.contains(value))
        {
            continue;
        }
        if let Some(keyword) = &keyword_filter {
            let mut haystack = String::new();
            haystack.push_str(&provider_lower);
            haystack.push('\n');
            haystack.push_str(&model_lower);
            haystack.push('\n');
            haystack.push_str(&operation_lower);
            haystack.push('\n');
            if let Some(value) = &request_json {
                haystack.push_str(&value.to_ascii_lowercase());
                haystack.push('\n');
            }
            if let Some(value) = &request_raw_json {
                haystack.push_str(&value.to_ascii_lowercase());
                haystack.push('\n');
            }
            if let Some(value) = &response_json {
                haystack.push_str(&value.to_ascii_lowercase());
                haystack.push('\n');
            }
            if let Some(value) = &response_raw_json {
                haystack.push_str(&value.to_ascii_lowercase());
                haystack.push('\n');
            }
            if let Some(value) = &error_json {
                haystack.push_str(&value.to_ascii_lowercase());
                haystack.push('\n');
            }
            if !haystack.contains(keyword) {
                continue;
            }
        }

        logs.push(json!({
          "id": id,
          "timestamp": timestamp,
          "provider": provider,
          "model": model,
          "operation": operation,
          "status": status,
          "durationMs": duration_ms,
          "request": parse_json(request_json),
          "requestRaw": parse_json(request_raw_json),
          "response": parse_json(response_json),
          "responseRaw": parse_json(response_raw_json),
          "mediaRefs": parse_json(media_refs_json),
          "error": parse_json(error_json)
        }))
    }
    logs.truncate(limit);

    Ok(Json(json!({ "success": true, "data": { "logs": logs } })))
}

async fn api_debug_logs_delete(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    conn.execute("DELETE FROM model_debug_logs", [])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

async fn api_not_implemented(Path(path): Path<String>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
          "success": false,
          "message": format!("Rust 后端暂未实现该接口: /api/{}", path)
        })),
    )
}
