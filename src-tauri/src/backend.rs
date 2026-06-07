use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
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
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const STYLE_PRESET_CONFIG_KEY: &str = "style_preset_config";
const STYLE_PRESET_DATA_KEY: &str = "style_preset_data";
const SELECTED_MODELS_KEY: &str = "selected_models";
const WORKFLOW_MODELS_KEY: &str = "workflow_models";
const WORKFLOW_MODEL_OPTIONS_KEY: &str = "workflow_model_options";
const SELECTED_MODELS_USER_SELECTED_KEY: &str = "_userSelected";
const CUSTOM_OPENAI_CONFIG_KEY: &str = "custom_openai_provider";
const PROVIDER_CREDENTIALS_KEY: &str = "provider_credentials";
const TOS_STORAGE_CONFIG_KEY: &str = "tos_storage_config";
const PROVIDER_MODEL_CATALOG_KEY: &str = "provider_model_catalog";
const PROMPT_TEMPLATES_KEY: &str = "prompt_templates_default";
const PROMPT_PROFILES_KEY: &str = "prompt_profiles_default";
const PROMPT_VERSIONS_KEY: &str = "prompt_versions_default";
const PROMPT_PROFILE_STATE_KEY: &str = "prompt_profile_state_default";

const DEFAULT_STYLE_PRESETS_JSON: &str = include_str!("../assets/default-style-presets.json");
const DEFAULT_STYLE_CATEGORIES_JSON: &str = include_str!("../assets/default-style-categories.json");
const STYLE_THUMBNAIL_CDN_BASE: &str = "https://playlet-ai.tos-cn-guangzhou.volces.com/manju-assets/styles";
const LEGACY_STYLE_THUMBNAIL_CDN_BASE: &str =
    "https://playlet-ai.tos-cn-guangzhou.volces.com/playlet-assets/styles";
const DEFAULT_PROMPT_TEMPLATES_JSON: &str = include_str!("../assets/default-prompt-templates.json");

#[path = "backend/model_constraints.rs"]
mod model_constraints;
#[path = "backend/prompts_api.rs"]
mod prompts_api;
#[path = "backend/runtime_api.rs"]
mod runtime_api;

use model_constraints::{build_available_model_entry, image_model_config, AvailableModelKind};
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
    status: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    keyword: Option<String>,
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
struct ProviderCredentialsPutBody {
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(rename = "accessKey")]
    access_key: Option<String>,
    #[serde(rename = "secretKey")]
    secret_key: Option<String>,
}

#[derive(Deserialize)]
struct TosConfigPutBody {
    enabled: Option<bool>,
    #[serde(rename = "accessKeyId")]
    access_key_id: Option<String>,
    #[serde(rename = "secretKey")]
    secret_key: Option<String>,
    #[serde(rename = "securityToken")]
    security_token: Option<String>,
    region: Option<String>,
    endpoint: Option<String>,
    bucket: Option<String>,
    #[serde(rename = "keyPrefix")]
    key_prefix: Option<String>,
    #[serde(rename = "publicBaseUrl")]
    public_base_url: Option<String>,
    #[serde(rename = "isCustomDomain")]
    is_custom_domain: Option<bool>,
}

struct ProjectSceneRow {
    id: String,
    order_index: i64,
    episode_id: Option<String>,
    episode_title: Option<String>,
    episode_index: Option<i64>,
    title: Option<String>,
    description: String,
    dramatic: Option<String>,
    setting: Option<String>,
    characters: Option<String>,
    dialogues: Option<String>,
    duration: i64,
    narration: Option<String>,
    shot_type: Option<String>,
    camera_movement: Option<String>,
    camera_note: Option<String>,
    environment_capture_mode: Option<String>,
    transition_in: Option<String>,
    transition_out: Option<String>,
    transition_duration: Option<f64>,
    first_frame: Option<String>,
    last_frame: Option<String>,
    video_url: Option<String>,
    status: String,
}

struct ProjectCharacterRow {
    id: String,
    name: String,
    role: String,
    appearance: String,
    personality: Option<String>,
    traits: Option<String>,
    background: Option<String>,
    motivation: Option<String>,
    speaking_style: Option<String>,
    catchphrase: Option<String>,
    voice_tone: Option<String>,
    voice_asset: Option<String>,
    age: Option<i64>,
    gender: Option<String>,
    base_image: Option<String>,
    expressions: Option<String>,
    views: Option<String>,
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
    #[serde(rename = "cloneFromProfileId")]
    clone_from_profile_id: Option<String>,
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

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static LLM_DEV_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn set_global_db_path(path: PathBuf) {
    let _ = DB_PATH.set(path);
}

fn set_global_llm_dev_log_dir(path: PathBuf) {
    let _ = LLM_DEV_LOG_DIR.set(path);
}

fn llm_dev_log_dir() -> Option<PathBuf> {
    LLM_DEV_LOG_DIR.get().cloned()
}

fn db_connection(state: &BackendState) -> Result<Connection, ApiError> {
    open_db_connection(&state.db_path)
}

fn open_db_connection(path: &FsPath) -> Result<Connection, ApiError> {
    let conn = Connection::open(path).map_err(|error| {
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

/// 为没有 `BackendState` 的深层助手提供只读配置连接（依赖 `set_global_db_path` 在启动时初始化）。
fn config_connection() -> Option<Connection> {
    let path = DB_PATH.get()?;
    open_db_connection(path).ok()
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

fn llm_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("failed to build llm reqwest client")
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


fn normalize_style_thumbnail(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(path) = trimmed.strip_prefix(LEGACY_STYLE_THUMBNAIL_CDN_BASE) {
        return Some(format!("{}{}", STYLE_THUMBNAIL_CDN_BASE, path));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    if let Some(filename) = trimmed.strip_prefix("/styles/") {
        return Some(format!("{}/{}", STYLE_THUMBNAIL_CDN_BASE, filename));
    }
    Some(trimmed.to_string())
}

fn normalize_style_preset_value(item: &Value) -> Value {
    let mut next = item.clone();
    if let Some(obj) = next.as_object_mut() {
        let normalized = normalize_style_thumbnail(obj.get("thumbnail").and_then(Value::as_str));
        match normalized {
            Some(url) => {
                obj.insert("thumbnail".to_string(), Value::String(url));
            }
            None => {
                obj.insert("thumbnail".to_string(), Value::Null);
            }
        }
    }
    next
}

fn normalize_style_presets_value(value: &Value) -> Value {
    Value::Array(
        value
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|item| normalize_style_preset_value(&item))
            .collect(),
    )
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
    let normalized = if parsed.is_array() {
        normalize_style_presets_value(&parsed)
    } else {
        normalize_style_presets_value(&fallback_style_presets())
    };
    if normalized.is_array() {
        normalized
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

fn default_selected_models() -> Value {
    json!({
      "text": "",
      "image": "",
      "video": "",
      "tts": "",
      "asr": "",
      "_userSelected": {}
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
    json!({})
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

/// 各供应商凭证（apiKey / baseUrl，kling 为 accessKey / secretKey），客户端可配，持久化到 system_config。
fn default_provider_credentials() -> Value {
    json!({
      "gemini":     { "apiKey": "", "baseUrl": "" },
      "qwen":       { "apiKey": "", "baseUrl": "" },
      "volcengine": { "apiKey": "", "baseUrl": "" },
      "deepseek":   { "apiKey": "", "baseUrl": "" },
      "kling":      { "accessKey": "", "secretKey": "", "baseUrl": "" }
    })
}

/// TOS 云存储配置，客户端可配，持久化到 system_config。
fn default_tos_config() -> Value {
    json!({
      "enabled": false,
      "accessKeyId": "",
      "secretKey": "",
      "securityToken": "",
      "region": "",
      "endpoint": "",
      "bucket": "",
      "keyPrefix": "",
      "publicBaseUrl": "",
      "isCustomDomain": false
    })
}

fn build_available_models(conn: &Connection) -> Result<Value, ApiError> {
    let mut text_models: Vec<Value> = Vec::new();
    let mut image_models: Vec<Value> = Vec::new();
    let mut three_d_models: Vec<Value> = Vec::new();
    let mut video_models: Vec<Value> = Vec::new();
    let mut voice_models: Vec<Value> = Vec::new();
    let mut seen = HashSet::new();

    for provider_item in provider_summary(conn)? {
        let Some(provider) = provider_item.get("provider").and_then(Value::as_str) else {
            continue;
        };
        // 未配置凭证的供应商不提供可用模型，避免在流程模型/测试中误选。
        if !provider_item
            .get("configured")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        for model_id in json_string_list(provider_item.get("models")) {
            let key = format!("{}::{}", provider, model_id);
            if !seen.insert(key) {
                continue;
            }
            let (kind, entry) = build_available_model_entry(provider, &model_id);
            match kind {
                AvailableModelKind::Text => text_models.push(entry),
                AvailableModelKind::Image => image_models.push(entry),
                AvailableModelKind::ThreeD => three_d_models.push(entry),
                AvailableModelKind::Video => video_models.push(entry),
                AvailableModelKind::VoiceTts | AvailableModelKind::VoiceAsr => {
                    voice_models.push(entry)
                }
            }
        }
    }

    Ok(json!({
      "text": text_models,
      "image": image_models,
      "threeD": three_d_models,
      "video": video_models,
      "voice": voice_models
    }))
}

fn available_model_kind_key(kind: AvailableModelKind) -> &'static str {
    match kind {
        AvailableModelKind::Text => "text",
        AvailableModelKind::Image => "image",
        AvailableModelKind::ThreeD => "three_d",
        AvailableModelKind::Video => "video",
        AvailableModelKind::VoiceTts => "voice_tts",
        AvailableModelKind::VoiceAsr => "voice_asr",
    }
}

fn available_model_category(kind: AvailableModelKind) -> &'static str {
    match kind {
        AvailableModelKind::Text => "text",
        AvailableModelKind::Image => "image",
        AvailableModelKind::ThreeD => "three_d",
        AvailableModelKind::Video => "video",
        AvailableModelKind::VoiceTts | AvailableModelKind::VoiceAsr => "voice",
    }
}

fn find_available_model_for_type(
    available: &Value,
    model_type: &str,
    model_id: &str,
) -> Option<Value> {
    let bucket = match model_type {
        "text" => available.get("text"),
        "image" => available.get("image"),
        "video" => available.get("video"),
        "tts" | "asr" => available.get("voice"),
        _ => None,
    }?;
    bucket.as_array()?.iter().find_map(|item| {
        let matches_model = item
            .get("model")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            == Some(model_id);
        if !matches_model {
            return None;
        }
        if matches!(model_type, "tts" | "asr") {
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
            if item_type != model_type {
                return None;
            }
        }
        Some(item.clone())
    })
}

fn workflow_step_category(step_id: &str) -> Option<&'static str> {
    match step_id {
        "script_parsing" | "scene_description_refinement" => Some("text"),
        "character_portrait" | "frame_generation" => Some("image"),
        "video_generation" => Some("video"),
        _ => None,
    }
}

fn is_workflow_step(step_id: &str) -> bool {
    workflow_step_category(step_id).is_some()
}

fn legacy_selected_model_for_type(model_type: &str) -> Option<&'static str> {
    match model_type {
        "text" => Some("qwen3.6-plus"),
        "image" => Some("qwen-image-2.0-pro"),
        "video" => Some("wan2.7-t2v"),
        _ => None,
    }
}

fn selected_model_marked_by_user(selected: &Value, model_type: &str) -> bool {
    selected
        .get(SELECTED_MODELS_USER_SELECTED_KEY)
        .and_then(Value::as_object)
        .and_then(|object| object.get(model_type))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn selected_model_value(selected: &Value, model_type: &str) -> Option<String> {
    let model_id = selected
        .get(model_type)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    if legacy_selected_model_for_type(model_type) == Some(model_id)
        && !selected_model_marked_by_user(selected, model_type)
    {
        return None;
    }

    Some(model_id.to_string())
}

fn mark_selected_model_by_user(selected: &mut Value, model_type: &str) {
    if !selected.is_object() {
        *selected = default_selected_models();
    }

    let Some(root) = selected.as_object_mut() else {
        return;
    };
    let marker = root
        .entry(SELECTED_MODELS_USER_SELECTED_KEY.to_string())
        .or_insert_with(|| json!({}));
    if !marker.is_object() {
        *marker = json!({});
    }
    if let Some(marker_object) = marker.as_object_mut() {
        marker_object.insert(model_type.to_string(), json!(true));
    }
}

fn set_selected_model_by_user(selected: &mut Value, model_type: &str, model_id: &str) {
    if !selected.is_object() {
        *selected = default_selected_models();
    }
    if let Some(obj) = selected.as_object_mut() {
        obj.insert(model_type.to_string(), json!(model_id));
    }
    mark_selected_model_by_user(selected, model_type);
}

fn selected_models_public_view(selected: &Value) -> Value {
    json!({
      "text": selected_model_value(selected, "text").unwrap_or_default(),
      "image": selected_model_value(selected, "image").unwrap_or_default(),
      "video": selected_model_value(selected, "video").unwrap_or_default(),
      "tts": selected_model_value(selected, "tts").unwrap_or_default(),
      "asr": selected_model_value(selected, "asr").unwrap_or_default()
    })
}

fn legacy_workflow_default_model_for_step(step_id: &str) -> Option<&'static str> {
    match step_id {
        "script_parsing" => Some("qwen3.6-plus"),
        "scene_description_refinement" => Some("qwen3.6-plus"),
        "character_portrait" => Some("qwen-image-2.0-pro"),
        "frame_generation" => Some("qwen-image-2.0-pro"),
        "video_generation" => Some("wan2.7-t2v"),
        _ => None,
    }
}

fn workflow_global_selected_model(selected: &Value, category: &str) -> Option<String> {
    selected_model_value(selected, category)
}

fn workflow_model_exists_for_step(available: &Value, step_id: &str, model_id: &str) -> bool {
    let Some(category) = workflow_step_category(step_id) else {
        return false;
    };
    find_available_model_for_type(available, category, model_id).is_some()
}

fn workflow_resolved_default_model(
    available: &Value,
    selected: &Value,
    step_id: &str,
) -> Option<String> {
    let category = workflow_step_category(step_id)?;
    if let Some(global) = workflow_global_selected_model(selected, category) {
        if workflow_model_exists_for_step(available, step_id, &global) {
            return Some(global);
        }
    }
    None
}

fn workflow_overrides(conn: &Connection) -> Result<Value, ApiError> {
    let raw = get_config_json(conn, WORKFLOW_MODELS_KEY)?.unwrap_or_else(|| json!({}));
    let Some(object) = raw.as_object() else {
        return Ok(json!({}));
    };
    let workflow_steps = [
        "script_parsing",
        "scene_description_refinement",
        "character_portrait",
        "frame_generation",
        "video_generation",
    ];
    let configured_count = workflow_steps
        .iter()
        .filter(|step| {
            object
                .get(**step)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        })
        .count();
    let maybe_legacy_full_snapshot = configured_count >= workflow_steps.len();
    let mut normalized = serde_json::Map::new();
    for (key, value) in object {
        if !is_workflow_step(key) {
            continue;
        }
        let Some(model_id) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if maybe_legacy_full_snapshot
            && legacy_workflow_default_model_for_step(key) == Some(model_id)
        {
            continue;
        }
        normalized.insert(key.clone(), json!(model_id));
    }
    Ok(Value::Object(normalized))
}

fn workflow_current_selections(conn: &Connection, available: &Value) -> Result<Value, ApiError> {
    let selected =
        get_config_json(conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    let overrides = workflow_overrides(conn)?;
    let mut output = serde_json::Map::new();
    for step_id in [
        "script_parsing",
        "scene_description_refinement",
        "character_portrait",
        "frame_generation",
        "video_generation",
    ] {
        let resolved = overrides
            .get(step_id)
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| workflow_resolved_default_model(available, &selected, step_id))
            .unwrap_or_default();
        output.insert(step_id.to_string(), json!(resolved));
    }
    Ok(Value::Object(output))
}

fn merge_json_object_defaults(mut raw: Value, defaults: &Value) -> Value {
    if !raw.is_object() {
        return defaults.clone();
    }
    if let (Some(raw_obj), Some(default_obj)) = (raw.as_object_mut(), defaults.as_object()) {
        for (key, default_value) in default_obj {
            match (raw_obj.get_mut(key), default_value) {
                (Some(existing), Value::Object(_)) => {
                    *existing = merge_json_object_defaults(existing.clone(), default_value);
                }
                (Some(_), _) => {}
                (None, _) => {
                    raw_obj.insert(key.clone(), default_value.clone());
                }
            }
        }
    }
    raw
}

fn workflow_model_options(conn: &Connection) -> Result<Value, ApiError> {
    let raw = get_config_json(conn, WORKFLOW_MODEL_OPTIONS_KEY)?
        .unwrap_or_else(default_workflow_model_options);
    Ok(merge_json_object_defaults(
        raw,
        &default_workflow_model_options(),
    ))
}

fn validate_workflow_model_options(step: &str, options: &Value) -> Result<(), ApiError> {
    match step {
        "image_options" => {
            let Some(obj) = options.as_object() else {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "modelOptions 必须是对象",
                ));
            };
            if let Some(value) = obj.get("geminiImageSize").and_then(Value::as_str) {
                if !matches!(value, "512" | "1K" | "2K" | "4K") {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "geminiImageSize 无效",
                    ));
                }
            }
            if let Some(value) = obj.get("openaiImageQuality").and_then(Value::as_str) {
                if !matches!(value, "auto" | "low" | "medium" | "high") {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "openaiImageQuality 无效",
                    ));
                }
            }
            if let Some(value) = obj.get("panoramaSourceMode").and_then(Value::as_str) {
                if !matches!(
                    value,
                    "equirectangular_360"
                        | "equirectangular_180"
                        | "cubemap_3x2"
                        | "cubemap_6x1"
                        | "custom"
                ) {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "panoramaSourceMode 无效",
                    ));
                }
            }
            Ok(())
        }
        "video_generation" => {
            if !options.is_object() {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "modelOptions 必须是对象",
                ));
            }
            if let Some(sound) = options
                .get("klingV3Omni")
                .and_then(|value| value.get("sound"))
                .and_then(Value::as_str)
            {
                if !matches!(sound, "on" | "off") {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "klingV3Omni.sound 无效",
                    ));
                }
            }
            if let Some(mode) = options
                .get("klingV3Omni")
                .and_then(|value| value.get("mode"))
                .and_then(Value::as_str)
            {
                if !matches!(mode, "std" | "pro") {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "klingV3Omni.mode 无效",
                    ));
                }
            }
            if let Some(quality) = options
                .get("seedance")
                .and_then(|value| value.get("quality"))
                .and_then(Value::as_str)
            {
                if !matches!(quality, "480p" | "720p" | "1080p") {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "seedance.quality 无效",
                    ));
                }
            }
            Ok(())
        }
        "completion_notification" => {
            let Some(obj) = options.as_object() else {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "modelOptions 必须是对象",
                ));
            };
            for key in ["sound", "systemNotification"] {
                if let Some(value) = obj.get(key) {
                    if !value.is_boolean() {
                        return Err(ApiError::new(
                            StatusCode::BAD_REQUEST,
                            format!("{key} 必须是布尔值"),
                        ));
                    }
                }
            }
            Ok(())
        }
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不支持的模型扩展配置",
        )),
    }
}

fn fallback_prompt_templates() -> Value {
    let now = now_iso();
    json!([
      {
        "id": "script_parsing",
        "name": "精品剧解析与资产规划",
        "category": "text",
        "description": "默认模板",
        "content": include_str!("../assets/default-prompts/fallback_script_parsing.txt"),
        "variables": [],
        "isCustomized": false,
        "updatedAt": now
      },
      {
        "id": "scene_video_generation",
        "name": "分镜视频生成",
        "category": "video",
        "description": "默认模板",
        "content": include_str!("../assets/default-prompts/fallback_scene_video_generation.txt"),
        "variables": [],
        "isCustomized": false,
        "updatedAt": now
      }
    ])
}

fn default_prompt_template_content(content_file: &str) -> Option<&'static str> {
    match content_file {
        "default-prompts/script_episode_plan.txt" => {
            Some(include_str!("../assets/default-prompts/script_episode_plan.txt"))
        }
        "default-prompts/script_parsing.txt" => {
            Some(include_str!("../assets/default-prompts/script_parsing.txt"))
        }
        "default-prompts/script_parsing_short_drama.txt" => {
            Some(include_str!("../assets/default-prompts/script_parsing_short_drama.txt"))
        }
        "default-prompts/script_parsing_segment_context.txt" => {
            Some(include_str!("../assets/default-prompts/script_parsing_segment_context.txt"))
        }
        "default-prompts/script_parsing_episode_drama_context.txt" => Some(include_str!(
            "../assets/default-prompts/script_parsing_episode_drama_context.txt"
        )),
        "default-prompts/character_sheet.txt" => {
            Some(include_str!("../assets/default-prompts/character_sheet.txt"))
        }
        "default-prompts/character_regeneration.txt" => {
            Some(include_str!("../assets/default-prompts/character_regeneration.txt"))
        }
        "default-prompts/environment_reference_generation.txt" => Some(include_str!(
            "../assets/default-prompts/environment_reference_generation.txt"
        )),
        "default-prompts/environment_reference_negative_prompt.txt" => Some(include_str!(
            "../assets/default-prompts/environment_reference_negative_prompt.txt"
        )),
        "default-prompts/prop_asset_generation.txt" => {
            Some(include_str!("../assets/default-prompts/prop_asset_generation.txt"))
        }
        "default-prompts/prop_asset_negative_prompt.txt" => {
            Some(include_str!("../assets/default-prompts/prop_asset_negative_prompt.txt"))
        }
        "default-prompts/scene_description_refinement.txt" => Some(include_str!(
            "../assets/default-prompts/scene_description_refinement.txt"
        )),
        "default-prompts/scene_video_generation.txt" => {
            Some(include_str!("../assets/default-prompts/scene_video_generation.txt"))
        }
        _ => None,
    }
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

            let content = obj
                .get("contentFile")
                .and_then(Value::as_str)
                .and_then(default_prompt_template_content)
                .map(str::to_string)
                .or_else(|| obj.get("content").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            obj.insert("content".to_string(), json!(content));
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

fn ensure_sql_identifier(identifier: &str) -> Result<(), ApiError> {
    let is_valid = !identifier.is_empty()
        && identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
    if is_valid {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("invalid sqlite identifier: {identifier}"),
        ))
    }
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, ApiError> {
    ensure_sql_identifier(table)?;
    ensure_sql_identifier(column)?;

    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    {
        let name: String = row
            .get(1)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), ApiError> {
    ensure_sql_identifier(table)?;
    ensure_sql_identifier(column)?;
    if table_has_column(conn, table, column)? {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map(|_| ())
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn ensure_runtime_schema(conn: &Connection) -> Result<(), ApiError> {
    for (column, definition) in [
        ("script_parse_mode", "TEXT NOT NULL DEFAULT 'short_drama'"),
        ("style_id", "TEXT NOT NULL DEFAULT ''"),
        ("aspect_ratio", "TEXT NOT NULL DEFAULT '16:9'"),
    ] {
        ensure_column(conn, "projects", column, definition)?;
    }

    for (column, definition) in [
        ("episode_id", "TEXT"),
        ("episode_title", "TEXT"),
        ("episode_index", "INTEGER"),
        ("dramatic", "TEXT"),
        ("shot_type", "TEXT"),
        ("camera_movement", "TEXT"),
        ("camera_note", "TEXT"),
        ("environment_capture_mode", "TEXT"),
        ("transition_in", "TEXT"),
        ("transition_out", "TEXT"),
        ("transition_duration", "REAL"),
        ("first_frame", "TEXT"),
        ("last_frame", "TEXT"),
        ("video_url", "TEXT"),
    ] {
        ensure_column(conn, "scenes", column, definition)?;
    }

    for (column, definition) in [
        ("traits", "TEXT"),
        ("background", "TEXT"),
        ("motivation", "TEXT"),
        ("speaking_style", "TEXT"),
        ("catchphrase", "TEXT"),
        ("voice_tone", "TEXT"),
        ("voice_asset", "TEXT"),
        ("views", "TEXT"),
    ] {
        ensure_column(conn, "characters", column, definition)?;
    }

    for (column, definition) in [
        ("audio_data", "TEXT"),
        ("metadata", "TEXT"),
        ("error", "TEXT"),
    ] {
        ensure_column(conn, "video_tasks", column, definition)?;
    }

    for (column, definition) in [
        ("audio_path", "TEXT"),
        ("duration", "REAL"),
        ("resolution", "TEXT"),
        ("aspect_ratio", "TEXT"),
        ("fps", "INTEGER DEFAULT 24"),
        ("has_audio", "INTEGER DEFAULT 1"),
        ("file_size", "INTEGER"),
    ] {
        ensure_column(conn, "generated_videos", column, definition)?;
    }

    for (column, definition) in [
        ("request_json", "TEXT"),
        ("request_raw_json", "TEXT"),
        ("response_json", "TEXT"),
        ("response_raw_json", "TEXT"),
        ("media_refs_json", "TEXT"),
        ("error_json", "TEXT"),
    ] {
        ensure_column(conn, "model_debug_logs", column, definition)?;
    }

    Ok(())
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

    ensure_runtime_schema(&conn)?;

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
    if get_config_json(&conn, PROVIDER_CREDENTIALS_KEY)?.is_none() {
        set_config_json(
            &conn,
            PROVIDER_CREDENTIALS_KEY,
            &default_provider_credentials(),
        )?;
    }
    if get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)?.is_none() {
        set_config_json(&conn, TOS_STORAGE_CONFIG_KEY, &default_tos_config())?;
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
    if get_config_json(&conn, PROMPT_PROFILE_STATE_KEY)?.is_none() {
        let mut snapshots = serde_json::Map::new();
        snapshots.insert(
            "default".to_string(),
            json!({
              "templates": default_prompt_templates(),
              "versions": []
            }),
        );
        set_config_json(
            &conn,
            PROMPT_PROFILE_STATE_KEY,
            &json!({
              "activeProfileId": "default",
              "profiles": default_prompt_profiles().get("profiles").cloned().unwrap_or_else(|| json!([])),
              "snapshots": snapshots
            }),
        )?;
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
    #[cfg(debug_assertions)]
    fs::create_dir_all(state.data_dir.join("llm-debug-logs"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

pub async fn start_server(state: BackendState, host: &str, port: u16) -> Result<(), String> {
    set_global_db_path(state.db_path.clone());
    #[cfg(debug_assertions)]
    set_global_llm_dev_log_dir(state.data_dir.join("llm-debug-logs"));
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
            "/api/model-providers/credentials",
            get(api_provider_credentials_get),
        )
        .route(
            "/api/model-providers/{provider}/credentials",
            put(api_provider_credentials_put),
        )
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
        .route(
            "/api/tos/config",
            get(api_tos_config_get).put(api_tos_config_put),
        )
        .route("/api/video/generate", post(api_video_generate))
        .route("/api/video/merge", post(api_video_merge))
        .route(
            "/api/video/export-jianying",
            post(api_video_export_jianying),
        )
        .route("/api/video/status/{id}", get(api_video_status))
        .route("/api/video/file/{*filename}", get(api_video_file))
        .route("/audios/{*filename}", get(api_audio_file))
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
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    serve_video_file(
        &[
            state.public_dir.join("videos"),
            state.data_dir.join("videos"),
        ],
        &filename,
        &headers,
    )
    .await
}

async fn api_audio_file(
    Path(filename): Path<String>,
    State(state): State<BackendState>,
) -> Result<Response, ApiError> {
    serve_media_file(
        &[
            state.public_dir.join("audios"),
            state.data_dir.join("audios"),
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

async fn serve_video_file(
    roots: &[PathBuf],
    filename: &str,
    headers: &HeaderMap,
) -> Result<Response, ApiError> {
    let rel = sanitize_rel_path(filename)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效的视频文件名"))?;
    if rel.contains('/') {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效的视频文件名"));
    }

    let path = roots
        .iter()
        .map(|root| root.join(&rel))
        .find(|path| path.is_file())
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?;

    let total_size = tokio::fs::metadata(&path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?
        .len();
    let content_type = HeaderValue::from_static(path_content_type(&path));

    let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    else {
        let data = tokio::fs::read(&path)
            .await
            .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?;
        return Ok((
            [
                (header::CONTENT_TYPE, content_type),
                (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                ),
                (
                    header::CONTENT_LENGTH,
                    HeaderValue::from_str(&total_size.to_string()).map_err(|error| {
                        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                    })?,
                ),
            ],
            data,
        )
            .into_response());
    };

    let Some((start, end)) = parse_next_style_byte_range(range, total_size) else {
        if range.starts_with("bytes=") {
            return range_not_satisfiable_response(total_size, "Range 超出文件范围");
        }
        return Err(ApiError::new(
            StatusCode::RANGE_NOT_SATISFIABLE,
            "无效的 Range 请求",
        ));
    };

    let chunk_size = end - start + 1;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut data = vec![0; chunk_size as usize];
    file.read_exact(&mut data)
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok((
        StatusCode::PARTIAL_CONTENT,
        [
            (header::CONTENT_TYPE, content_type),
            (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            ),
            (
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{end}/{total_size}")).map_err(
                    |error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
                )?,
            ),
            (
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&chunk_size.to_string()).map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?,
            ),
        ],
        data,
    )
        .into_response())
}

fn parse_next_style_byte_range(range: &str, total_size: u64) -> Option<(u64, u64)> {
    let spec = range.strip_prefix("bytes=")?;
    let (start_raw, end_raw) = spec.split_once('-')?;
    if start_raw.contains('-') || end_raw.contains('-') || total_size == 0 {
        return None;
    }

    let start = if start_raw.is_empty() {
        0
    } else {
        start_raw.parse::<u64>().ok()?
    };
    let end = if end_raw.is_empty() {
        total_size.checked_sub(1)?
    } else {
        end_raw.parse::<u64>().ok()?
    };

    if start > end || end >= total_size {
        return None;
    }
    Some((start, end))
}

fn range_not_satisfiable_response(total_size: u64, message: &str) -> Result<Response, ApiError> {
    Ok((
        StatusCode::RANGE_NOT_SATISFIABLE,
        [(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes */{total_size}")).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        )],
        Json(json!({
            "success": false,
            "message": message
        })),
    )
        .into_response())
}

async fn api_project_list(
    State(state): State<BackendState>,
    Query(query): Query<ProjectListQuery>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let should_paginate = query.page.is_some() || query.page_size.is_some();
    if query.page.is_some_and(|page| page < 1) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "page 必须大于等于 1",
        ));
    }
    if query
        .page_size
        .is_some_and(|page_size| page_size < 1 || page_size > 100)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "pageSize 必须在 1 到 100 之间",
        ));
    }
    let requested_page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("all");
    if !matches!(status, "all" | "draft" | "in_progress" | "completed") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效项目状态"));
    }
    let sort_by = query
        .sort_by
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("updated");
    if !matches!(sort_by, "updated" | "created" | "name") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效排序字段"));
    }
    let keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let mut where_parts = Vec::<String>::new();
    let mut where_params = Vec::<String>::new();
    if status != "all" {
        where_parts.push("status = ?".to_string());
        where_params.push(status.to_string());
    }
    if let Some(keyword) = &keyword {
        where_parts.push(
            "(name LIKE ? OR description LIKE ? OR style_id LIKE ? OR script_parse_mode LIKE ?)"
                .to_string(),
        );
        let pattern = format!("%{}%", keyword);
        for _ in 0..4 {
            where_params.push(pattern.clone());
        }
    }
    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };

    let mut count_stmt = conn
        .prepare(&format!("SELECT COUNT(*) FROM projects{}", where_clause))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let total: i64 = count_stmt
        .query_row(rusqlite::params_from_iter(where_params.iter()), |row| {
            row.get(0)
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let total_pages = ((total as f64) / (page_size as f64)).ceil().max(1.0) as usize;
    let page = if should_paginate {
        requested_page.min(total_pages).max(1)
    } else {
        requested_page
    };
    let order_by = match sort_by {
        "created" => "created_at DESC",
        "name" => "name ASC",
        _ => "updated_at DESC",
    };

    let mut list_sql = format!(
        "SELECT id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at FROM projects{} ORDER BY {}",
        where_clause, order_by
    );
    let mut list_params = where_params.clone();
    if should_paginate {
        let offset = (page - 1) * page_size;
        list_sql.push_str(" LIMIT ? OFFSET ?");
        list_params.push(page_size.to_string());
        list_params.push(offset.to_string());
    }

    let mut stmt = conn
        .prepare(&list_sql)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let projects = stmt
        .query_map(rusqlite::params_from_iter(list_params.iter()), |row| {
            let project_id: String = row.get(0)?;
            let scene_stats = row
                .get_ref(0)
                .ok()
                .and_then(|_| {
                    conn.query_row(
                        "SELECT COUNT(s.id), COALESCE(SUM(CASE WHEN s.status = 'video_ready' THEN 1 ELSE 0 END), 0), COALESCE(SUM(s.duration), 0)
                         FROM scripts sc LEFT JOIN scenes s ON s.script_id = sc.id WHERE sc.project_id = ?1",
                        params![project_id.as_str()],
                        |stats_row| Ok((stats_row.get::<_, i64>(0)?, stats_row.get::<_, i64>(1)?, stats_row.get::<_, i64>(2)?)),
                    )
                    .ok()
                })
                .unwrap_or((0, 0, 0));
            let script_parse_mode: Option<String> = row.get(3)?;
            Ok(json!({
              "id": project_id,
              "title": row.get::<_, String>(1)?,
              "description": row.get::<_, Option<String>>(2)?,
              "scriptParseMode": normalize_script_parse_mode(script_parse_mode.as_deref()),
              "styleId": row.get::<_, String>(4)?,
              "aspectRatio": row.get::<_, String>(5)?,
              "status": row.get::<_, Option<String>>(6)?,
              "totalScenes": scene_stats.0,
              "completedScenes": scene_stats.1,
              "totalDuration": scene_stats.2,
              "createdAt": row.get::<_, String>(7)?,
              "updatedAt": row.get::<_, String>(8)?
            }))
        })
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "projects": projects,
      "pagination": {
        "page": if should_paginate { page } else { 1 },
        "pageSize": if should_paginate { page_size } else { projects.len() },
        "total": total,
        "totalPages": if should_paginate { total_pages } else { 1 }
      }
    })))
}

async fn api_project_create(
    State(state): State<BackendState>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<Value>, ApiError> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "title 不能为空"));
    }
    if title.chars().count() > 100 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "title 长度不能超过 100",
        ));
    }
    if body.description.as_deref().unwrap_or("").chars().count() > 500 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "description 长度不能超过 500",
        ));
    }

    let conn = db_connection(&state)?;
    let now = now_iso();
    let id = format!("proj_{}", Uuid::new_v4().simple());
    let style_id = body
        .style_id
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "styleId 不能为空"))?
        .trim()
        .to_string();
    if style_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "styleId 不能为空"));
    }
    let aspect_ratio = body
        .aspect_ratio
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "aspectRatio 不能为空"))?
        .trim()
        .to_string();
    if !matches!(aspect_ratio.as_str(), "16:9" | "9:16" | "1:1") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "aspectRatio 无效"));
    }
    let script_parse_mode = body
        .script_parse_mode
        .unwrap_or_else(|| "short_drama".to_string())
        .trim()
        .to_string();
    if !matches!(script_parse_mode.as_str(), "premium_drama" | "short_drama") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "scriptParseMode 无效",
        ));
    }
    if !is_style_id_enabled(&conn, &style_id)? {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("当前后台配置未启用该画风: {style_id}"),
        ));
    }
    let description = body.description.unwrap_or_default();

    conn.execute(
        "INSERT INTO projects (id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8)",
        params![
            id,
            title,
            description,
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
        "id": id,
        "title": title,
        "description": description,
        "scriptParseMode": script_parse_mode,
        "styleId": style_id,
        "aspectRatio": aspect_ratio,
        "status": "draft",
        "totalScenes": 0,
        "completedScenes": 0,
        "totalDuration": 0,
        "createdAt": now,
        "updatedAt": now
      }
    })))
}

async fn api_project_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少项目ID"));
    }
    let conn = db_connection(&state)?;
    let exists = conn
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 LIMIT 1",
            params![id.as_str()],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .is_some();
    if !exists {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "项目不存在"));
    }

    let script_ids = {
        let mut stmt = conn
            .prepare("SELECT id FROM scripts WHERE project_id = ?1")
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let rows = stmt
            .query_map(params![id.as_str()], |row| row.get::<_, String>(0))
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        rows
    };

    for script_id in script_ids {
        conn.execute(
            "DELETE FROM scenes WHERE script_id = ?1",
            params![script_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    conn.execute(
        "DELETE FROM characters WHERE project_id = ?1",
        params![id.as_str()],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    conn.execute(
        "DELETE FROM scripts WHERE project_id = ?1",
        params![id.as_str()],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id.as_str()])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

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
                let script_parse_mode: Option<String> = row.get(3)?;
                Ok(json!({
                  "id": row.get::<_, String>(0)?,
                  "name": row.get::<_, String>(1)?,
                  "description": row.get::<_, Option<String>>(2)?,
                  "scriptParseMode": normalize_script_parse_mode(script_parse_mode.as_deref()),
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

        let mut scenes = mapped_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        for scene in &mut scenes {
            let scene_id = scene
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if scene_id.is_empty() {
                continue;
            }

            let mut video_url = scene
                .get("videoUrl")
                .and_then(Value::as_str)
                .map(str::to_string);
            let status = scene
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            if video_url.as_deref().map(str::trim).unwrap_or("").is_empty()
                && status == "video_ready"
            {
                video_url = conn
                    .query_row(
                        "SELECT video_data FROM video_tasks WHERE scene_id = ?1 AND status = 'completed' AND video_data IS NOT NULL AND TRIM(video_data) != '' ORDER BY updated_at DESC LIMIT 1",
                        params![scene_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }

            let first_frame = normalize_project_image_source_for_storage(
                &state,
                scene.get("firstFrame").and_then(Value::as_str),
                &format!("scene_{}_first", sanitize_file_component(&scene_id)),
            )?;
            let last_frame = normalize_project_image_source_for_storage(
                &state,
                scene.get("lastFrame").and_then(Value::as_str),
                &format!("scene_{}_last", sanitize_file_component(&scene_id)),
            )?;
            let normalized_video = normalize_project_video_source_for_storage(
                &state,
                video_url.as_deref(),
                &format!("scene_{}_video", sanitize_file_component(&scene_id)),
            )?;
            let next_status = if normalized_video
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
            {
                status.to_string()
            } else {
                "video_ready".to_string()
            };

            let old_first = scene
                .get("firstFrame")
                .and_then(Value::as_str)
                .map(str::to_string);
            let old_last = scene
                .get("lastFrame")
                .and_then(Value::as_str)
                .map(str::to_string);
            let old_video = scene
                .get("videoUrl")
                .and_then(Value::as_str)
                .map(str::to_string);
            if first_frame != old_first
                || last_frame != old_last
                || normalized_video != old_video
                || next_status != status
            {
                conn.execute(
                    "UPDATE scenes SET first_frame = ?1, last_frame = ?2, video_url = ?3, status = ?4, updated_at = ?5 WHERE id = ?6",
                    params![first_frame, last_frame, normalized_video, next_status, now_iso(), scene_id],
                )
                .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }

            if let Some(obj) = scene.as_object_mut() {
                obj.insert(
                    "firstFrame".to_string(),
                    first_frame.map(Value::String).unwrap_or(Value::Null),
                );
                obj.insert(
                    "lastFrame".to_string(),
                    last_frame.map(Value::String).unwrap_or(Value::Null),
                );
                obj.insert(
                    "videoUrl".to_string(),
                    normalized_video.map(Value::String).unwrap_or(Value::Null),
                );
                obj.insert("status".to_string(), Value::String(next_status));
            }
        }

        scenes
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

    let mut characters = stmt
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

    for character in &mut characters {
        let character_id = character
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if character_id.is_empty() {
            continue;
        }
        let prefix = sanitize_file_component(&character_id);
        let base_image = normalize_project_image_source_for_storage(
            &state,
            character
                .get("baseImage")
                .and_then(Value::as_str)
                .or_else(|| character.get("imageUrl").and_then(Value::as_str)),
            &format!("{}_base", prefix),
        )?;
        let expressions = normalize_project_image_map_for_storage(
            &state,
            character.get("expressions"),
            &format!("{}_expression", prefix),
        )?;
        let views = normalize_project_image_map_for_storage(
            &state,
            character.get("views"),
            &format!("{}_view", prefix),
        )?;

        let old_base = character
            .get("baseImage")
            .and_then(Value::as_str)
            .map(str::to_string);
        let old_expressions = character
            .get("expressions")
            .filter(|value| !value.is_null())
            .map(Value::to_string);
        let old_views = character
            .get("views")
            .filter(|value| !value.is_null())
            .map(Value::to_string);
        if base_image != old_base || expressions != old_expressions || views != old_views {
            conn.execute(
                "UPDATE characters SET base_image = ?1, expressions = ?2, views = ?3, updated_at = ?4 WHERE id = ?5",
                params![base_image, expressions, views, now_iso(), character_id],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }

        let expressions_value = expressions
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .unwrap_or(Value::Null);
        let views_value = views
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .unwrap_or(Value::Null);

        if let Some(obj) = character.as_object_mut() {
            obj.insert(
                "imageUrl".to_string(),
                base_image.clone().map(Value::String).unwrap_or(Value::Null),
            );
            obj.insert(
                "baseImage".to_string(),
                base_image.map(Value::String).unwrap_or(Value::Null),
            );
            obj.insert("expressions".to_string(), expressions_value);
            obj.insert("views".to_string(), views_value);
        }
    }

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

fn looks_like_base64_payload(value: &str) -> bool {
    let compact = normalize_base64_payload(value);
    compact.len() >= 120
        && compact
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn looks_like_base64_image(value: &str) -> bool {
    let compact = normalize_base64_payload(value);
    compact.starts_with("/9j/")
        || compact.starts_with("iVBOR")
        || compact.starts_with("R0lGOD")
        || compact.starts_with("UklGR")
        || compact.starts_with("Qk")
        || compact.starts_with("SUkq")
        || compact.starts_with("TU0A")
}

fn looks_like_base64_video(value: &str) -> bool {
    let compact = normalize_base64_payload(value);
    compact.starts_with("AAAAIGZ0eX")
        || compact.starts_with("AAAAHGZ0eX")
        || compact.starts_with("GkXfow")
        || compact.starts_with("T2dnUw")
}

fn normalize_existing_image_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("url:") {
        return normalize_existing_image_url(rest);
    }
    if is_http_url(trimmed) || trimmed.starts_with("/api/image/file/") {
        return Some(trimmed.to_string());
    }
    if let Some(filename) = trimmed.strip_prefix("/generated-images/") {
        let filename = filename.trim_start_matches('/');
        if !filename.is_empty()
            && sanitize_rel_path(filename).is_some_and(|safe| !safe.contains('/'))
        {
            return Some(format!("/api/image/file/{filename}"));
        }
        return None;
    }
    if trimmed.starts_with('/') {
        return Some(trimmed.to_string());
    }
    Some(trimmed.to_string())
}

fn normalize_existing_video_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("url:") {
        return normalize_existing_video_url(rest);
    }
    if is_http_url(trimmed) || trimmed.starts_with("/api/video/file/") {
        return Some(trimmed.to_string());
    }
    if let Some(filename) = trimmed.strip_prefix("/videos/") {
        let filename = filename.trim_start_matches('/');
        if !filename.is_empty()
            && sanitize_rel_path(filename).is_some_and(|safe| !safe.contains('/'))
        {
            return Some(format!("/api/video/file/{filename}"));
        }
        return None;
    }
    if trimmed.starts_with('/') {
        return Some(trimmed.to_string());
    }
    Some(trimmed.to_string())
}

fn normalize_project_image_source_for_storage(
    state: &BackendState,
    source: Option<&str>,
    prefix: &str,
) -> Result<Option<String>, ApiError> {
    let Some(raw) = source.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if let Some((mime, bytes)) = parse_data_url(raw) {
        if !mime.starts_with("image/") {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "仅支持图片资源"));
        }
        return persist_image_bytes(state, prefix, Some(&mime), "png", &bytes).map(Some);
    }

    if looks_like_base64_image(raw) || looks_like_base64_payload(raw) {
        if let Some(bytes) = decode_base64_bytes(raw) {
            return persist_image_bytes(state, prefix, None, "png", &bytes).map(Some);
        }
    }

    Ok(normalize_existing_image_url(raw))
}

fn normalize_project_video_source_for_storage(
    state: &BackendState,
    source: Option<&str>,
    prefix: &str,
) -> Result<Option<String>, ApiError> {
    let Some(raw) = source.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let raw = raw.strip_prefix("url:").map(str::trim).unwrap_or(raw);

    if let Some((mime, bytes)) = parse_data_url(raw) {
        if !mime.starts_with("video/") {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "仅支持视频资源"));
        }
        return persist_video_bytes(state, prefix, Some(&mime), "mp4", &bytes).map(Some);
    }

    if looks_like_base64_video(raw) || looks_like_base64_payload(raw) {
        if let Some(bytes) = decode_base64_bytes(raw) {
            return persist_video_bytes(state, prefix, None, "mp4", &bytes).map(Some);
        }
    }

    Ok(normalize_existing_video_url(raw))
}

fn normalize_project_image_map_for_storage(
    state: &BackendState,
    value: Option<&Value>,
    prefix: &str,
) -> Result<Option<String>, ApiError> {
    let Some(object) = value.and_then(Value::as_object) else {
        return Ok(None);
    };

    let mut output = serde_json::Map::new();
    for (key, value) in object {
        let Some(raw) = value.as_str() else {
            continue;
        };
        if let Some(normalized) = normalize_project_image_source_for_storage(
            state,
            Some(raw),
            &format!("{}_{}", prefix, key),
        )? {
            output.insert(key.clone(), json!(normalized));
        }
    }

    Ok(Some(Value::Object(output).to_string()))
}

fn merge_script_payload(
    existing_raw: Option<&str>,
    body: &Value,
    project_script_parse_mode: &str,
) -> String {
    let mut merged = existing_raw
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    for key in [
        "storyIdea",
        "novelText",
        "rawText",
        "selectedStyleId",
        "inputMode",
        "scriptParseMode",
        "episodePlan",
        "assetWorkflow",
    ] {
        if let Some(value) = body.get(key) {
            merged.insert(key.to_string(), value.clone());
        }
    }

    if !merged.contains_key("scriptParseMode") {
        merged.insert(
            "scriptParseMode".to_string(),
            json!(project_script_parse_mode),
        );
    }
    if !merged.contains_key("episodePlan") {
        merged.insert("episodePlan".to_string(), json!([]));
    }

    Value::Object(merged).to_string()
}

fn validation_error(path: impl AsRef<str>, message: impl AsRef<str>) -> ApiError {
    ApiError::new(
        StatusCode::BAD_REQUEST,
        format!("{}: {}", path.as_ref(), message.as_ref()),
    )
}

fn required_string<'a>(value: &'a Value, key: &str, path: &str) -> Result<&'a str, ApiError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error(format!("{path}.{key}"), "Expected string"))
}

fn optional_string<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
) -> Result<Option<&'a str>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(raw)) => Ok(Some(raw.as_str())),
        Some(_) => Err(validation_error(format!("{path}.{key}"), "Expected string")),
    }
}

fn optional_i64(value: &Value, key: &str, path: &str) -> Result<Option<i64>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_i64()
            .ok_or_else(|| validation_error(format!("{path}.{key}"), "Expected integer"))
            .map(Some),
        Some(_) => Err(validation_error(format!("{path}.{key}"), "Expected number")),
    }
}

fn optional_f64(value: &Value, key: &str, path: &str) -> Result<Option<f64>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_f64()
            .ok_or_else(|| validation_error(format!("{path}.{key}"), "Expected number"))
            .map(Some),
        Some(_) => Err(validation_error(format!("{path}.{key}"), "Expected number")),
    }
}

fn optional_enum_string<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
    allowed: &[&str],
) -> Result<Option<&'a str>, ApiError> {
    let Some(raw) = optional_string(value, key, path)? else {
        return Ok(None);
    };
    if allowed.contains(&raw) {
        Ok(Some(raw))
    } else {
        Err(validation_error(
            format!("{path}.{key}"),
            "Invalid enum value",
        ))
    }
}

fn normalize_scoped_id(entity: &str, project_id: &str, source_id: &str) -> String {
    let scoped_prefix = format!("{entity}_{project_id}_");
    if source_id.starts_with(&scoped_prefix) {
        source_id.to_string()
    } else {
        format!("{scoped_prefix}{source_id}")
    }
}

fn normalize_time_of_day_value(raw: &str) -> String {
    let value = raw.trim();
    let key = value.to_ascii_lowercase();
    match key.as_str() {
        "dawn" | "sunrise" => "黎明".to_string(),
        "morning" | "am" | "forenoon" => "早晨".to_string(),
        "day" | "daytime" => "白天".to_string(),
        "noon" | "midday" => "中午".to_string(),
        "afternoon" | "pm" => "下午".to_string(),
        "evening" | "sunset" | "dusk" => "傍晚".to_string(),
        "night" | "midnight" => "夜晚".to_string(),
        _ if matches!(
            value,
            "黎明" | "早晨" | "白天" | "中午" | "下午" | "傍晚" | "夜晚"
        ) =>
        {
            value.to_string()
        }
        _ => "白天".to_string(),
    }
}

fn normalize_scene_era_value(raw: Option<&str>) -> Option<String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty())?;
    let key = value.to_ascii_lowercase();
    let normalized = match key.as_str() {
        "ancient" | "historical" => "古代",
        "republican" | "republic_of_china" => "民国",
        "modern" | "contemporary" | "present_day" => "现代",
        "near_future" | "future" | "scifi" | "sci_fi" | "cyberpunk" => "近未来",
        "fantasy" | "alternate" => "架空",
        _ if matches!(value, "古代" | "民国" | "现代" | "近未来" | "架空") => value,
        _ => return None,
    };
    Some(normalized.to_string())
}

fn normalize_scene_setting(value: &Value, path: &str) -> Result<Option<String>, ApiError> {
    let Some(setting) = value.get("setting") else {
        return Ok(None);
    };
    if setting.is_null() {
        return Ok(None);
    }
    let object = setting
        .as_object()
        .ok_or_else(|| validation_error(format!("{path}.setting"), "Expected object"))?;
    let location = object
        .get("location")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error(format!("{path}.setting.location"), "Expected string"))?;
    let time_of_day = object
        .get("timeOfDay")
        .and_then(Value::as_str)
        .ok_or_else(|| validation_error(format!("{path}.setting.timeOfDay"), "Expected string"))?;

    let mut normalized = object.clone();
    normalized.insert("location".to_string(), json!(location));
    normalized.insert(
        "timeOfDay".to_string(),
        json!(normalize_time_of_day_value(time_of_day)),
    );
    if let Some(era) = normalize_scene_era_value(object.get("era").and_then(Value::as_str)) {
        normalized.insert("era".to_string(), json!(era));
    } else {
        normalized.remove("era");
    }
    Ok(Some(Value::Object(normalized).to_string()))
}

fn validate_scene_json_fields(scene: &Value, path: &str) -> Result<(), ApiError> {
    if let Some(dramatic) = scene.get("dramatic").filter(|value| !value.is_null()) {
        let object = dramatic
            .as_object()
            .ok_or_else(|| validation_error(format!("{path}.dramatic"), "Expected object"))?;
        if let Some(function) = object.get("function").filter(|value| !value.is_null()) {
            let raw = function.as_str().ok_or_else(|| {
                validation_error(format!("{path}.dramatic.function"), "Expected string")
            })?;
            if ![
                "hook",
                "escalation",
                "confrontation",
                "reversal",
                "payoff",
                "cliffhanger",
                "aftermath",
            ]
            .contains(&raw)
            {
                return Err(validation_error(
                    format!("{path}.dramatic.function"),
                    "Invalid enum value",
                ));
            }
        }
    }

    if let Some(characters) = scene.get("characters").filter(|value| !value.is_null()) {
        let items = characters
            .as_array()
            .ok_or_else(|| validation_error(format!("{path}.characters"), "Expected array"))?;
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("{path}.characters.{index}");
            required_string(item, "name", &item_path)?;
            optional_string(item, "appearance", &item_path)?;
            optional_string(item, "action", &item_path)?;
            optional_string(item, "emotion", &item_path)?;
        }
    }

    if let Some(dialogues) = scene.get("dialogues").filter(|value| !value.is_null()) {
        let items = dialogues
            .as_array()
            .ok_or_else(|| validation_error(format!("{path}.dialogues"), "Expected array"))?;
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("{path}.dialogues.{index}");
            required_string(item, "character", &item_path)?;
            required_string(item, "text", &item_path)?;
            optional_string(item, "emotion", &item_path)?;
            if let Some(value) = item.get("isInnerThought").filter(|value| !value.is_null()) {
                if !value.is_boolean() {
                    return Err(validation_error(
                        format!("{item_path}.isInnerThought"),
                        "Expected boolean",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_string_map(value: Option<&Value>, path: &str) -> Result<(), ApiError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_null() {
        return Ok(());
    }
    let object = value
        .as_object()
        .ok_or_else(|| validation_error(path, "Expected object"))?;
    for (key, value) in object {
        if !value.is_string() {
            return Err(validation_error(format!("{path}.{key}"), "Expected string"));
        }
    }
    Ok(())
}

fn validate_voice_asset(value: Option<&Value>, path: &str) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value
        .as_object()
        .ok_or_else(|| validation_error(path, "Expected object"))?;
    match object.get("audioUrl") {
        Some(Value::String(_)) => {}
        _ => {
            return Err(validation_error(
                format!("{path}.audioUrl"),
                "Expected string",
            ))
        }
    }
    match object.get("updatedAt") {
        Some(Value::String(_)) => {}
        _ => {
            return Err(validation_error(
                format!("{path}.updatedAt"),
                "Expected datetime string",
            ))
        }
    }
    for key in ["transcript", "sourceSceneId", "sourceTaskId"] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            if !value.is_string() {
                return Err(validation_error(format!("{path}.{key}"), "Expected string"));
            }
        }
    }
    if let Some(value) = object.get("locked").filter(|value| !value.is_null()) {
        if !value.is_boolean() {
            return Err(validation_error(
                format!("{path}.locked"),
                "Expected boolean",
            ));
        }
    }
    for key in ["startTimeMs", "endTimeMs", "durationMs", "matchScore"] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            if !value.is_number() {
                return Err(validation_error(format!("{path}.{key}"), "Expected number"));
            }
        }
    }
    Ok(Some(value.to_string()))
}

fn is_style_id_enabled(conn: &Connection, style_id: &str) -> Result<bool, ApiError> {
    let style_id = style_id.trim();
    if style_id.is_empty() {
        return Ok(false);
    }

    let default_catalog = default_style_catalog();
    let config = get_config_json(conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        })
    });
    Ok(config
        .get("enabledStyleIds")
        .and_then(Value::as_array)
        .map(|items| items.iter().any(|item| item.as_str() == Some(style_id)))
        .unwrap_or(false))
}

fn normalize_script_parse_mode(value: Option<&str>) -> &'static str {
    match value {
        Some("premium_drama") => "premium_drama",
        Some("short_drama") => "short_drama",
        _ => "short_drama",
    }
}

async fn api_project_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let now = now_iso();

    let existing_project: (String, Option<String>, Option<String>, String, String, String) = conn
        .query_row(
            "SELECT name, description, status, style_id, aspect_ratio, script_parse_mode FROM projects WHERE id = ?1 LIMIT 1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "项目不存在"))?;

    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&existing_project.0)
        .trim()
        .to_string();
    let description = body
        .get("description")
        .and_then(Value::as_str)
        .or(existing_project.1.as_deref())
        .unwrap_or("")
        .to_string();
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .or(existing_project.2.as_deref())
        .unwrap_or("draft")
        .to_string();
    if !matches!(status.as_str(), "draft" | "in_progress" | "completed") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "status 无效"));
    }
    let style_id = body
        .get("styleId")
        .and_then(Value::as_str)
        .unwrap_or(&existing_project.3)
        .trim()
        .to_string();
    if body.get("styleId").is_some() && !is_style_id_enabled(&conn, &style_id)? {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("当前后台配置未启用该画风: {style_id}"),
        ));
    }
    let aspect_ratio = body
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or(&existing_project.4)
        .trim()
        .to_string();
    if !matches!(aspect_ratio.as_str(), "16:9" | "9:16" | "1:1") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "aspectRatio 无效"));
    }
    let script_parse_mode = body
        .get("scriptParseMode")
        .and_then(Value::as_str)
        .unwrap_or(&existing_project.5)
        .trim()
        .to_string();
    if !matches!(script_parse_mode.as_str(), "premium_drama" | "short_drama") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "scriptParseMode 无效",
        ));
    }

    conn.execute(
        "UPDATE projects SET name = ?1, description = ?2, status = ?3, style_id = ?4, aspect_ratio = ?5, script_parse_mode = ?6, updated_at = ?7 WHERE id = ?8",
        params![name, description, status, style_id, aspect_ratio, script_parse_mode, now, id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let script_row: Option<(String, String)> = conn
        .query_row(
            "SELECT id, raw_text FROM scripts WHERE project_id = ?1 LIMIT 1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let (script_id, existing_script_raw): (String, Option<String>) = match script_row {
        Some((script_id, raw_text)) => (script_id, Some(raw_text)),
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
            (new_script_id, None)
        }
    };

    let script_payload =
        merge_script_payload(existing_script_raw.as_deref(), &body, &script_parse_mode);
    conn.execute(
        "UPDATE scripts SET raw_text = ?1, updated_at = ?2 WHERE id = ?3",
        params![script_payload, now, script_id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if let Some(scenes) = body.get("scenes").and_then(Value::as_array) {
        let mut scene_rows: Vec<ProjectSceneRow> = Vec::new();
        let mut total_duration = 0_i64;

        for (index, scene) in scenes.iter().enumerate() {
            let path = format!("scenes.{index}");
            let raw_scene_id = required_string(scene, "id", &path)?;
            let scene_id = normalize_scoped_id("scene", &id, raw_scene_id);
            let episode_index = optional_i64(scene, "episodeIndex", &path)?;
            if let Some(value) = episode_index {
                if value < 1 {
                    return Err(validation_error(
                        format!("{path}.episodeIndex"),
                        "Number must be greater than or equal to 1",
                    ));
                }
            }
            let order_index = index as i64;
            let description = required_string(scene, "description", &path)?.to_string();
            validate_scene_json_fields(scene, &path)?;
            let duration = optional_i64(scene, "duration", &path)?.unwrap_or(8);
            total_duration += duration;
            let video_url = optional_string(scene, "videoUrl", &path)?;
            let scene_id_for_prefix = sanitize_file_component(&scene_id);
            let first_frame = normalize_project_image_source_for_storage(
                &state,
                optional_string(scene, "firstFrame", &path)?,
                &format!("scene_{}_first", scene_id_for_prefix),
            )?;
            let last_frame = normalize_project_image_source_for_storage(
                &state,
                optional_string(scene, "lastFrame", &path)?,
                &format!("scene_{}_last", scene_id_for_prefix),
            )?;
            let video_url = normalize_project_video_source_for_storage(
                &state,
                video_url,
                &format!("scene_{}_video", scene_id_for_prefix),
            )?;
            let status = scene
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or(
                    if video_url
                        .as_ref()
                        .is_some_and(|value| !value.trim().is_empty())
                    {
                        "video_ready"
                    } else {
                        "pending"
                    },
                )
                .to_string();
            let shot_type = optional_enum_string(
                scene,
                "shotType",
                &path,
                &[
                    "extreme_wide",
                    "wide",
                    "medium_wide",
                    "medium",
                    "medium_close",
                    "close",
                    "extreme_close",
                    "detail",
                ],
            )?
            .map(str::to_string);
            let camera_movement = optional_enum_string(
                scene,
                "cameraMovement",
                &path,
                &[
                    "static",
                    "push",
                    "pull",
                    "pan_left",
                    "pan_right",
                    "tilt_up",
                    "tilt_down",
                    "track",
                    "dolly",
                    "zoom_in",
                    "zoom_out",
                    "crane",
                    "handheld",
                    "arc",
                ],
            )?
            .map(str::to_string);
            let environment_capture_mode = optional_enum_string(
                scene,
                "environmentCaptureMode",
                &path,
                &["single", "four_view"],
            )?
            .map(str::to_string);
            let transition_in = optional_enum_string(
                scene,
                "transitionIn",
                &path,
                &[
                    "cut", "fade", "dissolve", "wipe", "slide", "zoom", "blur", "flash", "none",
                ],
            )?
            .map(str::to_string);
            let transition_out = optional_enum_string(
                scene,
                "transitionOut",
                &path,
                &[
                    "cut", "fade", "dissolve", "wipe", "slide", "zoom", "blur", "flash", "none",
                ],
            )?
            .map(str::to_string);
            let encode = |key: &str| -> Option<String> {
                scene
                    .get(key)
                    .filter(|value| !value.is_null())
                    .map(Value::to_string)
            };

            scene_rows.push(ProjectSceneRow {
                id: scene_id,
                order_index,
                episode_id: optional_string(scene, "episodeId", &path)?.map(str::to_string),
                episode_title: optional_string(scene, "episodeTitle", &path)?.map(str::to_string),
                episode_index,
                title: optional_string(scene, "title", &path)?.map(str::to_string),
                description,
                dramatic: encode("dramatic"),
                setting: normalize_scene_setting(scene, &path)?,
                characters: encode("characters"),
                dialogues: encode("dialogues"),
                duration,
                narration: optional_string(scene, "narration", &path)?.map(str::to_string),
                shot_type,
                camera_movement,
                camera_note: optional_string(scene, "cameraNote", &path)?.map(str::to_string),
                environment_capture_mode,
                transition_in,
                transition_out,
                transition_duration: optional_f64(scene, "transitionDuration", &path)?,
                first_frame,
                last_frame,
                video_url,
                status,
            });
        }

        conn.execute(
            "DELETE FROM scenes WHERE script_id = ?1",
            params![script_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        for scene_row in scene_rows {
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
                    scene_row.id,
                    script_id,
                    scene_row.order_index,
                    scene_row.episode_id,
                    scene_row.episode_title,
                    scene_row.episode_index,
                    scene_row.title,
                    scene_row.description,
                    scene_row.dramatic,
                    scene_row.setting,
                    scene_row.characters,
                    scene_row.dialogues,
                    scene_row.duration,
                    scene_row.narration,
                    scene_row.shot_type,
                    scene_row.camera_movement,
                    scene_row.camera_note,
                    scene_row.environment_capture_mode,
                    scene_row.transition_in,
                    scene_row.transition_out,
                    scene_row.transition_duration,
                    scene_row.first_frame,
                    scene_row.last_frame,
                    scene_row.video_url,
                    scene_row.status,
                    now,
                    now
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }

        conn.execute(
            "UPDATE scripts SET total_duration = ?1, updated_at = ?2 WHERE id = ?3",
            params![total_duration, now, script_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }

    if let Some(characters) = body.get("characters").and_then(Value::as_array) {
        let mut existing_character_by_id: HashMap<String, Option<String>> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, voice_asset FROM characters WHERE project_id = ?1")
                .map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            let rows = stmt
                .query_map(params![id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            for row in rows {
                let (character_id, voice_asset) = row.map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
                existing_character_by_id.insert(character_id, voice_asset);
            }
        }

        let mut character_rows: Vec<ProjectCharacterRow> = Vec::new();

        for (index, character) in characters.iter().enumerate() {
            let path = format!("characters.{index}");
            let raw_character_id = required_string(character, "id", &path)?;
            let character_id = normalize_scoped_id("char", &id, raw_character_id);
            let name = required_string(character, "name", &path)?.to_string();
            let appearance = required_string(character, "appearance", &path)?.to_string();
            let age = optional_i64(character, "age", &path)?;
            validate_string_map(character.get("expressions"), &format!("{path}.expressions"))?;
            validate_string_map(character.get("views"), &format!("{path}.views"))?;
            if let Some(traits) = character.get("traits").filter(|value| !value.is_null()) {
                let items = traits
                    .as_array()
                    .ok_or_else(|| validation_error(format!("{path}.traits"), "Expected array"))?;
                for (trait_index, item) in items.iter().enumerate() {
                    if !item.is_string() {
                        return Err(validation_error(
                            format!("{path}.traits.{trait_index}"),
                            "Expected string",
                        ));
                    }
                }
            }
            let character_id_for_prefix = sanitize_file_component(&character_id);
            let base_image = normalize_project_image_source_for_storage(
                &state,
                optional_string(character, "baseImage", &path)?
                    .or(optional_string(character, "imageUrl", &path)?),
                &format!("{}_base", character_id_for_prefix),
            )?;
            let expressions = normalize_project_image_map_for_storage(
                &state,
                character.get("expressions"),
                &format!("{}_expression", character_id_for_prefix),
            )?;
            let views = normalize_project_image_map_for_storage(
                &state,
                character.get("views"),
                &format!("{}_view", character_id_for_prefix),
            )?;
            let voice_asset = if character.get("voiceAsset").is_some() {
                validate_voice_asset(character.get("voiceAsset"), &format!("{path}.voiceAsset"))?
            } else {
                existing_character_by_id
                    .get(&character_id)
                    .and_then(|raw| raw.as_ref())
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .and_then(|value| {
                        validate_voice_asset(Some(&value), &format!("{path}.voiceAsset"))
                            .ok()
                            .flatten()
                    })
            };

            character_rows.push(ProjectCharacterRow {
                id: character_id,
                name,
                role: optional_string(character, "role", &path)?
                    .unwrap_or("supporting")
                    .to_string(),
                appearance,
                personality: optional_string(character, "personality", &path)?.map(str::to_string),
                traits: character
                    .get("traits")
                    .filter(|value| !value.is_null())
                    .map(Value::to_string),
                background: optional_string(character, "background", &path)?.map(str::to_string),
                motivation: optional_string(character, "motivation", &path)?.map(str::to_string),
                speaking_style: optional_string(character, "speakingStyle", &path)?
                    .map(str::to_string),
                catchphrase: optional_string(character, "catchphrase", &path)?.map(str::to_string),
                voice_tone: optional_string(character, "voiceTone", &path)?.map(str::to_string),
                voice_asset,
                age,
                gender: optional_string(character, "gender", &path)?.map(str::to_string),
                base_image,
                expressions,
                views,
            });
        }

        conn.execute("DELETE FROM characters WHERE project_id = ?1", params![id])
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        for character_row in character_rows {
            conn.execute(
                "INSERT INTO characters (
                  id, project_id, name, role, appearance, personality, traits, background, motivation, speaking_style,
                  catchphrase, voice_tone, voice_asset, age, gender, base_image, expressions, views, created_at, updated_at
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
                )",
                params![
                    character_row.id,
                    id,
                    character_row.name,
                    character_row.role,
                    character_row.appearance,
                    character_row.personality,
                    character_row.traits,
                    character_row.background,
                    character_row.motivation,
                    character_row.speaking_style,
                    character_row.catchphrase,
                    character_row.voice_tone,
                    character_row.voice_asset,
                    character_row.age,
                    character_row.gender,
                    character_row.base_image,
                    character_row.expressions,
                    character_row.views,
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
    let (presets, config) = load_style_presets_and_config(&conn)?;
    let runtime = style_runtime_response(&presets, &config);

    Ok(Json(json!({
      "success": true,
      "data": {
        "presets": runtime["enabledPresets"],
        "categories": runtime["enabledCategories"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledStyleIds": runtime["enabledStyleIds"]
      }
    })))
}

async fn api_styles_config(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let (presets, config) = load_style_presets_and_config(&conn)?;
    let runtime = style_runtime_response(&presets, &config);

    Ok(Json(json!({
      "success": true,
      "data": {
        "allPresets": runtime["allPresets"],
        "allCategories": default_style_categories(),
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
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
    let mut invalid_ids: Vec<String> = Vec::new();
    for id in body.enabled_style_ids {
        if !valid_ids.contains(&id) {
            invalid_ids.push(id);
            continue;
        }
        if !enabled.contains(&id) {
            enabled.push(id);
        }
    }
    if !invalid_ids.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("存在无效画风ID: {}", invalid_ids.join(", ")),
        ));
    }
    if enabled.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "至少保留一个画风预设",
        ));
    }
    if let Some(default_style_id) = body.default_style_id.as_deref() {
        if !default_style_id.trim().is_empty() && !valid_ids.contains(default_style_id) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("无效默认画风ID: {}", default_style_id),
            ));
        }
    }
    let default_id = body.default_style_id.unwrap_or_else(|| enabled[0].clone());

    let payload = json!({
      "enabledStyleIds": enabled,
      "defaultStyleId": default_id
    });
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &payload)?;
    let runtime = style_runtime_response(&presets, &payload);

    Ok(Json(json!({
      "success": true,
      "data": {
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
}

fn style_slug(value: &str) -> String {
    let mut output = String::new();
    let mut previous_underscore = false;
    for ch in value.trim().to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' {
            output.push(ch);
            previous_underscore = false;
        } else if ch == '_' || !previous_underscore {
            output.push('_');
            previous_underscore = true;
        }
    }
    output.trim_matches('_').to_string()
}

fn valid_style_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn string_field(
    value: &Value,
    key: &str,
    required: bool,
    min_len: usize,
    max_len: usize,
) -> Result<Option<String>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) if !required => Ok(None),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim().to_string();
            let len = trimmed.chars().count();
            if len < min_len {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("{} 不能为空", key),
                ));
            }
            if len > max_len {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("{} 最多 {} 个字符", key, max_len),
                ));
            }
            Ok(Some(trimmed))
        }
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{} 必须是字符串", key),
        )),
    }
}

fn optional_bool_field(value: &Value, key: &str) -> Result<Option<bool>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(raw)) => Ok(Some(*raw)),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{} 必须是布尔值", key),
        )),
    }
}

fn style_category_ids() -> HashSet<String> {
    default_style_categories()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn validate_style_category(category: &str) -> Result<(), ApiError> {
    if style_category_ids().contains(category) {
        return Ok(());
    }
    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        format!("无效画风分类: {}", category),
    ))
}

fn style_runtime_response(presets: &Value, config: &Value) -> Value {
    let normalized_presets = normalize_style_presets_value(presets);
    let normalized_config = normalize_style_config_for_presets(config, &normalized_presets);
    let enabled_ids = normalized_config
        .get("enabledStyleIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let enabled_presets = normalized_presets
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| enabled_ids.iter().any(|enabled| enabled == id))
        })
        .collect::<Vec<_>>();
    let enabled_category_ids = enabled_presets
        .iter()
        .filter_map(|item| item.get("category").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let enabled_categories = default_style_categories()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| enabled_category_ids.contains(id))
        })
        .collect::<Vec<_>>();
    json!({
      "allPresets": normalized_presets,
      "enabledStyleIds": enabled_ids,
      "defaultStyleId": normalized_config.get("defaultStyleId").cloned().unwrap_or(Value::Null),
      "enabledPresets": enabled_presets,
      "enabledCategories": enabled_categories
    })
}

fn load_style_presets_and_config(conn: &Connection) -> Result<(Value, Value), ApiError> {
    let default_catalog = default_style_catalog();
    let presets = get_config_json(conn, STYLE_PRESET_DATA_KEY)?
        .unwrap_or_else(|| default_catalog["allPresets"].clone());
    let config = get_config_json(conn, STYLE_PRESET_CONFIG_KEY)?.unwrap_or_else(|| {
        json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        })
    });
    Ok((presets, config))
}

fn normalize_style_config_for_presets(config: &Value, presets: &Value) -> Value {
    let valid_ids = presets
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<HashSet<_>>();
    let all_ids = presets
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>();
    let source_ids = config
        .get("enabledStyleIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| all_ids.iter().cloned().map(Value::String).collect());
    let mut enabled = source_ids
        .into_iter()
        .filter_map(|item| item.as_str().map(str::to_string))
        .filter(|id| valid_ids.contains(id))
        .collect::<Vec<_>>();
    enabled.dedup();
    if enabled.is_empty() {
        enabled = all_ids;
    }
    let default_id = config
        .get("defaultStyleId")
        .and_then(Value::as_str)
        .filter(|id| enabled.iter().any(|enabled_id| enabled_id == id))
        .map(str::to_string)
        .unwrap_or_else(|| enabled.first().cloned().unwrap_or_default());
    json!({
      "enabledStyleIds": enabled,
      "defaultStyleId": default_id
    })
}

fn resolve_new_style_id(
    input_id: Option<String>,
    name: &str,
    used_ids: &HashSet<String>,
) -> Result<String, ApiError> {
    if let Some(input_id) = input_id.filter(|value| !value.trim().is_empty()) {
        let normalized = style_slug(&input_id);
        if !valid_style_id(&normalized) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "ID 仅支持字母、数字、下划线和短横线",
            ));
        }
        if used_ids.contains(&normalized) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                format!("画风 ID 已存在: {}", normalized),
            ));
        }
        return Ok(normalized);
    }

    let base = style_slug(name);
    let base = if base.is_empty() {
        "custom_style"
    } else {
        &base
    };
    let mut next = base.to_string();
    let mut suffix = 2;
    while used_ids.contains(&next) {
        next = format!("{}_{}", base, suffix);
        suffix += 1;
    }
    Ok(next)
}

fn validate_imported_style_preset(item: &Value, path: &str) -> Result<String, ApiError> {
    if !item.is_object() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{} 必须是对象", path),
        ));
    }
    let id = string_field(item, "id", true, 1, 64)?.unwrap_or_default();
    if !valid_style_id(&id) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{}.id 仅支持字母、数字、下划线和短横线", path),
        ));
    }
    string_field(item, "name", true, 1, 64)?;
    string_field(item, "nameEn", false, 0, 64)?;
    let category = string_field(item, "category", true, 1, 64)?.unwrap_or_default();
    validate_style_category(&category)?;
    string_field(item, "description", true, 1, 200)?;
    string_field(item, "prompt", true, 1, 500)?;
    string_field(item, "negativePrompt", false, 0, 500)?;
    string_field(item, "thumbnail", false, 0, 500)?;
    optional_bool_field(item, "isNew")?;
    optional_bool_field(item, "isPro")?;
    Ok(id)
}

async fn api_styles_preset_create(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    if !body.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效预设数据"));
    }
    let (mut presets, config) = load_style_presets_and_config(&conn)?;
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;
    let used_ids = list
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<HashSet<_>>();

    let name = string_field(&body, "name", true, 1, 64)?.unwrap_or_default();
    let input_id = string_field(&body, "id", false, 1, 64)?;
    let id = resolve_new_style_id(input_id, &name, &used_ids)?;
    let category = string_field(&body, "category", true, 1, 64)?.unwrap_or_default();
    validate_style_category(&category)?;
    let description = string_field(&body, "description", true, 1, 200)?.unwrap_or_default();
    let prompt = string_field(&body, "prompt", true, 1, 500)?.unwrap_or_default();
    let name_en = string_field(&body, "nameEn", false, 0, 64)?.unwrap_or_else(|| name.clone());
    let negative_prompt = string_field(&body, "negativePrompt", false, 0, 500)?;
    let thumbnail = string_field(&body, "thumbnail", false, 0, 500)?;
    let is_new = optional_bool_field(&body, "isNew")?.unwrap_or(false);
    let is_pro = optional_bool_field(&body, "isPro")?.unwrap_or(false);
    let enabled = optional_bool_field(&body, "enabled")?.unwrap_or(true);
    let set_as_default = optional_bool_field(&body, "setAsDefault")?.unwrap_or(false);

    let new_preset = json!({
      "id": id,
      "name": name,
      "nameEn": name_en,
      "category": category,
      "description": description,
      "prompt": prompt,
      "negativePrompt": negative_prompt,
      "thumbnail": thumbnail,
      "isNew": is_new,
      "isPro": is_pro
    });
    list.push(new_preset.clone());

    let mut next_config = normalize_style_config_for_presets(&config, &presets);
    if let Some(enabled_ids) = next_config
        .get_mut("enabledStyleIds")
        .and_then(Value::as_array_mut)
    {
        if enabled
            && !enabled_ids
                .iter()
                .any(|item| item.as_str() == Some(id.as_str()))
        {
            enabled_ids.push(json!(id.clone()));
        }
    }
    if set_as_default {
        if let Some(obj) = next_config.as_object_mut() {
            obj.insert("defaultStyleId".to_string(), json!(id));
        }
    }

    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &next_config)?;
    let runtime = style_runtime_response(&presets, &next_config);
    Ok(Json(json!({
      "success": true,
      "data": {
        "preset": new_preset,
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
}

async fn api_styles_preset_update(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少画风ID"));
    }
    if !body.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效预设数据"));
    }
    let conn = db_connection(&state)?;
    let (mut presets, config) = load_style_presets_and_config(&conn)?;
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;
    let target_index = list
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, format!("未找到画风: {}", id)))?;
    let target = list[target_index].clone();

    let name = string_field(&body, "name", false, 1, 64)?
        .or_else(|| {
            target
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let category = string_field(&body, "category", false, 1, 64)?
        .or_else(|| {
            target
                .get("category")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    validate_style_category(&category)?;
    let description = string_field(&body, "description", false, 1, 200)?
        .or_else(|| {
            target
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let prompt = string_field(&body, "prompt", false, 1, 500)?
        .or_else(|| {
            target
                .get("prompt")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let name_en = string_field(&body, "nameEn", false, 0, 64)?.unwrap_or_else(|| {
        target
            .get("nameEn")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| name.clone())
    });
    let negative_prompt = if body.get("negativePrompt").is_some() {
        string_field(&body, "negativePrompt", false, 0, 500)?
    } else {
        target
            .get("negativePrompt")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let thumbnail = if body.get("thumbnail").is_some() {
        string_field(&body, "thumbnail", false, 0, 500)?
    } else {
        target
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let is_new = optional_bool_field(&body, "isNew")?.unwrap_or_else(|| {
        target
            .get("isNew")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });
    let is_pro = optional_bool_field(&body, "isPro")?.unwrap_or_else(|| {
        target
            .get("isPro")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });

    let updated = json!({
      "id": id,
      "name": name,
      "nameEn": name_en,
      "category": category,
      "description": description,
      "prompt": prompt,
      "negativePrompt": negative_prompt,
      "thumbnail": thumbnail,
      "isNew": is_new,
      "isPro": is_pro
    });
    list[target_index] = updated.clone();

    let mut next_config = normalize_style_config_for_presets(&config, &presets);
    let mut enabled_ids = next_config
        .get("enabledStyleIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let currently_enabled = enabled_ids.iter().any(|item| item == &id);
    if let Some(enabled) = optional_bool_field(&body, "enabled")? {
        if !enabled && currently_enabled && enabled_ids.len() <= 1 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "不能禁用最后一个启用的画风",
            ));
        }
        if enabled && !currently_enabled {
            enabled_ids.push(id.clone());
        } else if !enabled {
            enabled_ids.retain(|item| item != &id);
        }
    }
    if enabled_ids.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不能禁用最后一个启用的画风",
        ));
    }
    let set_as_default = optional_bool_field(&body, "setAsDefault")?.unwrap_or(false);
    let mut default_id = next_config
        .get("defaultStyleId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if set_as_default {
        if !enabled_ids.iter().any(|item| item == &id) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "请先启用该画风后再设为默认",
            ));
        }
        default_id = id.clone();
    } else if !enabled_ids.iter().any(|item| item == &default_id) {
        default_id = enabled_ids.first().cloned().unwrap_or_default();
    }
    next_config = json!({
      "enabledStyleIds": enabled_ids,
      "defaultStyleId": default_id
    });

    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &next_config)?;
    let runtime = style_runtime_response(&presets, &next_config);
    Ok(Json(json!({
      "success": true,
      "data": {
        "preset": updated,
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
}

async fn api_styles_preset_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少画风ID"));
    }
    let conn = db_connection(&state)?;
    let (mut presets, config) = load_style_presets_and_config(&conn)?;
    let list = presets
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "预设数据结构错误"))?;
    if !list
        .iter()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("未找到画风: {}", id),
        ));
    }
    if list.len() <= 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不能删除最后一个画风预设",
        ));
    }
    list.retain(|item| item.get("id").and_then(Value::as_str) != Some(id.as_str()));
    let next_config = normalize_style_config_for_presets(&config, &presets);
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &next_config)?;
    let runtime = style_runtime_response(&presets, &next_config);
    Ok(Json(json!({
      "success": true,
      "data": {
        "removedId": id,
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
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
    let runtime = style_runtime_response(
        &default_catalog["allPresets"],
        &json!({
          "enabledStyleIds": default_catalog["enabledStyleIds"],
          "defaultStyleId": default_catalog["defaultStyleId"]
        }),
    );
    Ok(Json(json!({
      "success": true,
      "data": {
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
}

async fn api_styles_preset_import(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !body.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "导入数据必须是对象"));
    }
    let payload = body.get("payload").cloned().unwrap_or_else(|| body.clone());
    let presets = payload
        .get("allPresets")
        .cloned()
        .or_else(|| payload.get("presets").cloned())
        .unwrap_or_else(|| json!([]));
    let preset_list = presets.as_array().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "导入数据缺少 allPresets/presets 数组",
        )
    })?;
    if preset_list.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "导入数据至少包含一个画风预设",
        ));
    }
    let mut valid_ids = HashSet::<String>::new();
    for (index, item) in preset_list.iter().enumerate() {
        let id = validate_imported_style_preset(item, &format!("allPresets.{index}"))?;
        if !valid_ids.insert(id) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "画风预设必须包含唯一 id",
            ));
        }
    }
    if valid_ids.len() != preset_list.len() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "画风预设必须包含唯一 id",
        ));
    }
    let input_config = json!({
      "enabledStyleIds": payload.get("enabledStyleIds").filter(|value| value.is_array()).cloned().unwrap_or(Value::Null),
      "defaultStyleId": payload.get("defaultStyleId").and_then(Value::as_str).unwrap_or("")
    });
    let normalized_config = normalize_style_config_for_presets(&input_config, &presets);

    let conn = db_connection(&state)?;
    set_config_json(&conn, STYLE_PRESET_DATA_KEY, &presets)?;
    set_config_json(&conn, STYLE_PRESET_CONFIG_KEY, &normalized_config)?;
    let runtime = style_runtime_response(&presets, &normalized_config);
    Ok(Json(json!({
      "success": true,
      "data": {
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"],
        "enabledPresets": runtime["enabledPresets"],
        "enabledCategories": runtime["enabledCategories"]
      }
    })))
}

async fn api_styles_preset_export(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let (presets, config) = load_style_presets_and_config(&conn)?;
    let runtime = style_runtime_response(&presets, &config);

    Ok(Json(json!({
      "success": true,
      "data": {
        "version": 1,
        "exportedAt": now_iso(),
        "allPresets": runtime["allPresets"],
        "enabledStyleIds": runtime["enabledStyleIds"],
        "defaultStyleId": runtime["defaultStyleId"]
      }
    })))
}

async fn api_models(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let selected =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    let available = build_available_models(&conn)?;
    Ok(Json(json!({
      "success": true,
      "data": {
        "available": available,
        "selected": selected_models_public_view(&selected)
      }
    })))
}

async fn api_models_select(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let model_type = body.get("type").and_then(Value::as_str).unwrap_or("");
    let model_id = body.get("modelId").and_then(Value::as_str).unwrap_or("");
    if !matches!(model_type, "text" | "image" | "video" | "tts" | "asr") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的模型类型"));
    }
    if model_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "modelId 不能为空"));
    }

    let conn = db_connection(&state)?;
    let mut selected =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    set_selected_model_by_user(&mut selected, model_type, model_id);
    set_config_json(&conn, SELECTED_MODELS_KEY, &selected)?;

    Ok(Json(json!({
      "success": true,
      "selected": selected_models_public_view(&selected)
    })))
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
    if !matches!(model_type, "text" | "image" | "video" | "tts" | "asr") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的模型类型"));
    }

    let conn = db_connection(&state)?;
    let available = build_available_models(&conn)?;
    let model_info =
        find_available_model_for_type(&available, model_type, model_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                format!("未找到类型为 {} 的模型: {}", model_type, model_id),
            )
        })?;
    let mut selected =
        get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
    set_selected_model_by_user(&mut selected, model_type, model_id);
    set_config_json(&conn, SELECTED_MODELS_KEY, &selected)?;
    Ok(Json(json!({
      "success": true,
      "message": format!("已切换 {} 模型", model_type),
      "data": {
        "type": model_type,
        "modelId": model_id,
        "modelInfo": model_info,
        "selected": selected_models_public_view(&selected)
      },
      "selected": selected_models_public_view(&selected)
    })))
}

async fn api_models_workflow_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let available = build_available_models(&conn)?;
    let overrides = workflow_overrides(&conn)?;
    let selections = workflow_current_selections(&conn, &available)?;
    let model_options = workflow_model_options(&conn)?;

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
              "selectedModel": if current.is_empty() { Value::Null } else { json!(current) },
              "isOverridden": overrides.get(step_id).and_then(Value::as_str).is_some()
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
    let available = build_available_models(&conn)?;
    let response_step = body.step.clone();
    let response_model_id = body.model_id.clone();
    let response_models = body.models.clone();

    if let Some(models) = body.models.as_ref() {
        let Some(items) = models.as_object() else {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "models 必须是对象"));
        };
        let mut overrides = workflow_overrides(&conn)?;
        let selected =
            get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
        let Some(overrides_obj) = overrides.as_object_mut() else {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "workflow models 数据结构错误",
            ));
        };
        for (step, value) in items {
            if !is_workflow_step(step) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("无效工作流步骤: {step}"),
                ));
            }
            let Some(model_id) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "modelId 不能为空"));
            };
            if !workflow_model_exists_for_step(&available, step, model_id) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("模型不兼容该工作流步骤: {step} -> {model_id}"),
                ));
            }
            let default_model =
                workflow_resolved_default_model(&available, &selected, step).unwrap_or_default();
            if model_id == default_model {
                overrides_obj.remove(step);
            } else {
                overrides_obj.insert(step.clone(), json!(model_id));
            }
        }
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &overrides)?;
    } else if let (Some(step), Some(model_id)) = (body.step.clone(), body.model_id.clone()) {
        if !is_workflow_step(&step) {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效工作流步骤"));
        }
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "modelId 不能为空"));
        }
        if !workflow_model_exists_for_step(&available, &step, model_id) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "模型不兼容该工作流步骤",
            ));
        }
        let selected =
            get_config_json(&conn, SELECTED_MODELS_KEY)?.unwrap_or_else(default_selected_models);
        let default_model =
            workflow_resolved_default_model(&available, &selected, &step).unwrap_or_default();
        let mut overrides = workflow_overrides(&conn)?;
        if let Some(obj) = overrides.as_object_mut() {
            if model_id == default_model {
                obj.remove(&step);
            } else {
                obj.insert(step.clone(), json!(model_id));
            }
        }
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &overrides)?;
    } else if let (Some(step), Some(model_options)) = (body.step.as_ref(), body.model_options) {
        validate_workflow_model_options(step, &model_options)?;
        let mut current = workflow_model_options(&conn)?;
        if let Some(obj) = current.as_object_mut() {
            let default_options = default_workflow_model_options();
            let merged = merge_json_object_defaults(
                model_options,
                default_options.get(step).unwrap_or(&json!({})),
            );
            obj.insert(step.clone(), merged);
        }
        set_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY, &current)?;
    } else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "无效的工作流更新参数",
        ));
    }

    let current_selections = workflow_current_selections(&conn, &available)?;
    Ok(Json(json!({
      "success": true,
      "data": {
        "step": response_step,
        "modelId": response_model_id,
        "updated": response_models,
        "currentSelections": current_selections,
        "modelOptions": workflow_model_options(&conn)?
      }
    })))
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

/// 加载合并后的供应商凭证：各供应商节点 + 内嵌完整 custom_openai 配置（键 `custom_openai`）。
fn load_provider_creds(conn: &Connection) -> Value {
    let mut creds = get_config_json(conn, PROVIDER_CREDENTIALS_KEY)
        .ok()
        .flatten()
        .unwrap_or_else(default_provider_credentials);
    let custom_openai = get_config_json(conn, CUSTOM_OPENAI_CONFIG_KEY)
        .ok()
        .flatten()
        .unwrap_or_else(default_custom_openai_config);
    if let Some(obj) = creds.as_object_mut() {
        obj.insert("custom_openai".to_string(), custom_openai);
    }
    creds
}

/// 把单个 custom_openai 配置包装成合并凭证结构，供共享供应商助手读取。
fn wrap_custom_openai_creds(custom_openai: &Value) -> Value {
    json!({ "custom_openai": custom_openai.clone() })
}

/// 供无 `&Connection` 的深层助手按需加载合并凭证（依赖全局 DB 路径）。
fn current_provider_creds() -> Value {
    config_connection()
        .map(|conn| load_provider_creds(&conn))
        .unwrap_or_else(default_provider_credentials)
}

/// 读取某供应商凭证的指定字段（去空白、过滤空串）。
fn provider_credential_field(creds: &Value, provider: &str, field: &str) -> Option<String> {
    creds
        .get(provider)
        .and_then(|node| node.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

fn normalize_non_empty_string_list(
    items: Vec<String>,
    field: &str,
) -> Result<Vec<String>, ApiError> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let normalized = item.trim().to_string();
        if normalized.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("{field} 不能包含空模型 ID"),
            ));
        }
        if seen.insert(normalized.clone()) {
            output.push(normalized);
        }
    }
    Ok(output)
}

fn validate_custom_openai_body(
    body: &CustomOpenAIPutBody,
    sync_only: bool,
) -> Result<(), ApiError> {
    if let Some(display_name) = body.display_name.as_deref() {
        let trimmed = display_name.trim();
        if trimmed.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "displayName 不能为空",
            ));
        }
        if trimmed.chars().count() > 60 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "displayName 不能超过 60 个字符",
            ));
        }
    }
    if sync_only {
        return Ok(());
    }
    if let Some(items) = body.text_models.clone() {
        normalize_non_empty_string_list(items, "textModels")?;
    }
    if let Some(items) = body.available_text_models.clone() {
        normalize_non_empty_string_list(items, "availableTextModels")?;
    }
    Ok(())
}

fn split_keys(raw: &str) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for part in raw.split([',', ';', '\n', '\r']) {
        let value = part.trim();
        if value.is_empty() {
            continue;
        }
        let owned = value.to_string();
        if seen.insert(owned.clone()) {
            output.push(owned);
        }
    }
    output
}

fn normalize_provider_base_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn provider_sync_base_url(provider: &str, creds: &Value) -> Option<String> {
    let configured =
        provider_credential_field(creds, provider, "baseUrl").and_then(|value| normalize_provider_base_url(&value));
    match provider {
        "qwen" => configured
            .or_else(|| Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string())),
        "volcengine" => {
            configured.or_else(|| Some("https://ark.cn-beijing.volces.com/api/v3".to_string()))
        }
        "deepseek" => configured.or_else(|| Some("https://api.deepseek.com".to_string())),
        "gemini" => configured
            .or_else(|| Some("https://generativelanguage.googleapis.com/v1beta".to_string())),
        "custom_openai" => configured,
        _ => None,
    }
}

fn provider_sync_api_key(provider: &str, creds: &Value) -> Option<String> {
    match provider {
        "qwen" | "volcengine" | "deepseek" | "custom_openai" => {
            provider_credential_field(creds, provider, "apiKey")
        }
        _ => None,
    }
}

fn provider_sync_api_keys(provider: &str, creds: &Value) -> Vec<String> {
    if provider == "gemini" {
        return provider_credential_field(creds, "gemini", "apiKey")
            .map(|value| split_keys(&value))
            .unwrap_or_default();
    }
    provider_sync_api_key(provider, creds)
        .map(|value| vec![value])
        .unwrap_or_default()
}

fn provider_models_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim_end_matches('/');
    if normalized.to_ascii_lowercase().ends_with("/models") {
        normalized.to_string()
    } else {
        format!("{}/models", normalized)
    }
}

fn normalize_remote_model_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(stripped) = trimmed.strip_prefix("models/") {
        return stripped.trim().to_string();
    }
    trimmed.to_string()
}

fn push_model_id(value: &Value, output: &mut Vec<String>, seen: &mut HashSet<String>) {
    let candidate = if let Some(id) = value.as_str() {
        normalize_remote_model_id(id)
    } else if let Some(id) = value.get("id").and_then(Value::as_str) {
        normalize_remote_model_id(id)
    } else if let Some(id) = value.get("model").and_then(Value::as_str) {
        normalize_remote_model_id(id)
    } else if let Some(id) = value.get("name").and_then(Value::as_str) {
        normalize_remote_model_id(id)
    } else {
        String::new()
    };

    if candidate.is_empty() {
        return;
    }
    if seen.insert(candidate.clone()) {
        output.push(candidate);
    }
}

fn parse_openai_compatible_model_ids(payload: &Value) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();

    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        for item in items {
            push_model_id(item, &mut output, &mut seen);
        }
    }
    if let Some(items) = payload.get("models").and_then(Value::as_array) {
        for item in items {
            push_model_id(item, &mut output, &mut seen);
        }
    }
    if output.is_empty() {
        push_model_id(payload, &mut output, &mut seen);
    }

    output
}

fn retain_enabled_models(previous: &[String], available: &[String]) -> Vec<String> {
    let available_set: HashSet<String> = available.iter().cloned().collect();
    let mut output = Vec::new();
    let mut seen = HashSet::new();

    for model in previous {
        let normalized = model.trim();
        if normalized.is_empty() {
            continue;
        }
        if !available_set.contains(normalized) {
            continue;
        }
        let owned = normalized.to_string();
        if seen.insert(owned.clone()) {
            output.push(owned);
        }
    }

    output
}

fn truncate_for_error(raw: &str, max_chars: usize) -> String {
    let compact = raw.replace(['\r', '\n'], " ");
    let mut output = String::new();
    for ch in compact.chars().take(max_chars) {
        output.push(ch);
    }
    if compact.chars().count() > max_chars {
        output.push_str("...");
    }
    output.trim().to_string()
}

fn build_sync_error_message(status: reqwest::StatusCode, body_text: &str) -> String {
    if let Ok(payload) = serde_json::from_str::<Value>(body_text) {
        let message = payload
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .or_else(|| error.as_str())
            })
            .or_else(|| payload.get("message").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(text) = message {
            return format!("{}: {}", status, text);
        }
    }

    let snippet = truncate_for_error(body_text, 240);
    if snippet.is_empty() {
        status.to_string()
    } else {
        format!("{}: {}", status, snippet)
    }
}

async fn fetch_provider_models_from_remote(
    provider: &str,
    creds: &Value,
) -> Result<Vec<String>, String> {
    let api_keys = provider_sync_api_keys(provider, creds);
    if api_keys.is_empty() {
        return Err("未配置 API Key".to_string());
    }
    let base_url = provider_sync_base_url(provider, creds)
        .ok_or_else(|| "未配置 Base URL".to_string())?;
    let endpoint = provider_models_endpoint(&base_url);
    let mut last_error = None::<String>;

    for api_key in api_keys {
        let request = http_client()
            .get(&endpoint)
            .header(reqwest::header::ACCEPT, "application/json");
        let request = if provider == "gemini" {
            request.query(&[("key", api_key.as_str())])
        } else {
            request.bearer_auth(api_key)
        };

        let response = request.send().await.map_err(|error| error.to_string())?;
        let status = response.status();
        let body_text = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            last_error = Some(build_sync_error_message(status, &body_text));
            continue;
        }

        let payload = serde_json::from_str::<Value>(&body_text).map_err(|error| {
            format!(
                "解析 /models 响应失败: {} ({})",
                error,
                truncate_for_error(&body_text, 160)
            )
        })?;
        let model_ids = parse_openai_compatible_model_ids(&payload);
        if model_ids.is_empty() {
            last_error = Some("远端 /models 返回为空".to_string());
            continue;
        }

        return Ok(model_ids);
    }

    Err(last_error.unwrap_or_else(|| "同步模型失败".to_string()))
}

fn resolve_provider_meta(
    provider: &str,
) -> Option<(&'static str, &'static str, &'static str, bool)> {
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
            "通过自定义 OpenAI 兼容 /models 同步模型，并按本地能力表自动归类。",
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

fn resolve_provider_configured(provider: &str, creds: &Value) -> bool {
    match provider {
        "qwen" | "volcengine" | "deepseek" | "gemini" => {
            provider_credential_field(creds, provider, "apiKey").is_some()
        }
        "kling" => {
            provider_credential_field(creds, "kling", "accessKey").is_some()
                && provider_credential_field(creds, "kling", "secretKey").is_some()
        }
        "custom_openai" => {
            provider_credential_field(creds, "custom_openai", "apiKey").is_some()
                && provider_credential_field(creds, "custom_openai", "baseUrl").is_some()
        }
        _ => false,
    }
}

fn resolve_provider_models(
    provider: &str,
    catalog_entry: Option<&Value>,
    creds: &Value,
) -> (Vec<String>, Vec<String>, Option<String>, Option<String>) {
    if provider == "custom_openai" {
        let custom_openai = creds.get("custom_openai").cloned().unwrap_or_else(default_custom_openai_config);
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

    let models = json_string_list(catalog_entry.and_then(|item| item.get("models")));
    let mut available = {
        let catalog_available =
            json_string_list(catalog_entry.and_then(|item| item.get("availableModels")));
        if catalog_available.is_empty() {
            models.clone()
        } else {
            catalog_available
        }
    };
    if available.is_empty() {
        available = manual_provider_seed_available_models(provider);
    }
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

fn manual_provider_seed_available_models(provider: &str) -> Vec<String> {
    match provider {
        "qwen" => vec![
            "qwen3.6-plus".to_string(),
            "qwen3-max-2026-01-23".to_string(),
            "qwen-image-2.0-pro".to_string(),
            "wan2.7-image-pro".to_string(),
            "wan2.7-image".to_string(),
            "z-image-turbo".to_string(),
            "wan2.7-t2v".to_string(),
            "wan2.7-i2v".to_string(),
            "wan2.7-r2v".to_string(),
            "qwen3-tts-instruct-flash".to_string(),
            "qwen3-asr-flash".to_string(),
            "fun-asr-mtl".to_string(),
        ],
        "volcengine" => vec![
            "doubao-seed-2-0-pro-260215".to_string(),
            "deepseek-v3-2-251201".to_string(),
            "doubao-seedream-5-0-260128".to_string(),
            "doubao-seedream-5-0-lite-260128".to_string(),
            "doubao-seedance-2-0-260128".to_string(),
            "doubao-seedance-2-0-fast-260128".to_string(),
        ],
        "deepseek" => vec![
            "deepseek-v4-pro".to_string(),
            "deepseek-v4-flash".to_string(),
        ],
        "gemini" => vec![
            "gemini-3-flash-preview".to_string(),
            "gemini-3.1-pro-preview".to_string(),
            "gemini-3-pro-image-preview".to_string(),
            "gemini-3.1-flash-image-preview".to_string(),
            "veo-3.1-generate-preview".to_string(),
            "veo-3.1-fast-generate-preview".to_string(),
            "lyria-realtime-exp".to_string(),
        ],
        "kling" => vec![
            "kling-image-o1".to_string(),
            "kling-v3-omni".to_string(),
            "kling-video-o1".to_string(),
            "kling-v3".to_string(),
            "kling-v2-6".to_string(),
            "kling-v2.5-turbo".to_string(),
        ],
        _ => vec![],
    }
}

fn provider_summary(conn: &Connection) -> Result<Vec<Value>, ApiError> {
    let catalog = get_config_json(conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
    let creds = load_provider_creds(conn);
    let custom_display_name = creds
        .get("custom_openai")
        .and_then(|node| node.get("displayName"))
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

        let catalog_entry = catalog.as_object().and_then(|items| items.get(provider));
        let (models, available_models, synced_at, sync_error) =
            resolve_provider_models(provider, catalog_entry, &creds);
        let available_model_catalog = available_models
            .iter()
            .map(|model_id| {
                let (kind, entry) = build_available_model_entry(provider, model_id);
                let capabilities = entry
                    .get("capabilities")
                    .cloned()
                    .unwrap_or_else(|| json!([]));
                let display_name = entry
                    .get("displayName")
                    .cloned()
                    .unwrap_or_else(|| json!(model_id));
                let description = entry
                    .get("description")
                    .cloned()
                    .unwrap_or_else(|| json!(""));
                let doc_url = entry.get("docUrl").cloned().unwrap_or(Value::Null);
                json!({
                  "model": model_id,
                  "kind": available_model_kind_key(kind),
                  "category": available_model_category(kind),
                  "displayName": display_name,
                  "description": description,
                  "docUrl": doc_url,
                  "capabilities": capabilities
                })
            })
            .collect::<Vec<_>>();

        providers.push(json!({
          "provider": provider,
          "displayName": display_name,
          "description": description,
          "syncMode": sync_mode,
          "configured": resolve_provider_configured(provider, &creds),
          "supportedDynamicSync": supported_dynamic_sync,
          "syncedAt": synced_at,
          "syncError": sync_error,
          "modelCount": models.len(),
          "models": models,
          "availableModels": available_models,
          "availableModelCatalog": available_model_catalog
        }));
    }

    Ok(providers)
}

async fn api_model_providers(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    // 所有受支持的供应商都展示，凭证在卡片表单内填写；`configured` 字段反映数据库中是否已配置密钥。
    let providers = provider_summary(&conn)?;
    Ok(Json(json!({
      "success": true,
      "data": { "providers": providers }
    })))
}

async fn api_model_provider_models_put(
    Path(provider): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<PutProviderModelsBody>,
) -> Result<Json<Value>, ApiError> {
    if !is_supported_provider(&provider) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "供应商不存在"));
    }
    if body.models.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "models 不能为空"));
    }
    let requested_models = normalize_non_empty_string_list(body.models, "models")?;

    let conn = db_connection(&state)?;
    let mut catalog =
        get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
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
    for model in requested_models {
        let normalized = model.trim().to_string();
        if !available_set.is_empty() && !available_set.contains(&normalized) {
            continue;
        }
        if seen.insert(normalized.clone()) {
            next_models.push(normalized);
        }
    }
    if next_models.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "models 未匹配到可用模型",
        ));
    }

    if let Some(obj) = catalog.as_object_mut() {
        let mut entry = obj.get(&provider).cloned().unwrap_or_else(|| json!({}));
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
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "供应商不存在"));
    }

    let Some((_, _, _, supported_dynamic_sync)) = resolve_provider_meta(&provider) else {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "供应商不存在"));
    };
    if !supported_dynamic_sync {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "该供应商不支持官方模型同步",
        ));
    }

    let conn = db_connection(&state)?;
    let mut custom_openai = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let mut catalog =
        get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?.unwrap_or_else(|| json!({}));
    if !catalog.is_object() {
        catalog = json!({});
    }

    let previous_selected_models = if provider == "custom_openai" {
        json_string_list(custom_openai.get("textModels"))
    } else {
        json_string_list(
            catalog
                .as_object()
                .and_then(|items| items.get(&provider))
                .and_then(|entry| entry.get("models")),
        )
    };

    let sync_result =
        fetch_provider_models_from_remote(&provider, &load_provider_creds(&conn)).await;
    let synced_at = now_iso();
    let sync_error = sync_result.as_ref().err().cloned();
    let synced_models = sync_result.clone().unwrap_or_default();
    let next_selected_models = if let Ok(models) = sync_result.as_ref() {
        retain_enabled_models(&previous_selected_models, models)
    } else {
        previous_selected_models.clone()
    };

    if let Some(obj) = catalog.as_object_mut() {
        let mut entry = obj.get(&provider).cloned().unwrap_or_else(|| json!({}));
        if !entry.is_object() {
            entry = json!({});
        }
        if let Some(entry_obj) = entry.as_object_mut() {
            if sync_result.is_ok() {
                entry_obj.insert("models".to_string(), json!(next_selected_models.clone()));
                entry_obj.insert("availableModels".to_string(), json!(synced_models.clone()));
            }
            entry_obj.insert("syncedAt".to_string(), json!(synced_at));
            entry_obj.insert(
                "syncError".to_string(),
                sync_error
                    .as_ref()
                    .map(|value| json!(value))
                    .unwrap_or(Value::Null),
            );
        }
        obj.insert(provider.clone(), entry);
    }

    if provider == "custom_openai" {
        if let Some(obj) = custom_openai.as_object_mut() {
            if sync_result.is_ok() {
                obj.insert(
                    "textModels".to_string(),
                    json!(next_selected_models.clone()),
                );
                obj.insert(
                    "availableTextModels".to_string(),
                    json!(synced_models.clone()),
                );
            }
            obj.insert("modelsSyncedAt".to_string(), json!(synced_at));
            obj.insert(
                "modelsSyncError".to_string(),
                sync_error
                    .as_ref()
                    .map(|value| json!(value))
                    .unwrap_or(Value::Null),
            );
        }
        set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &custom_openai)?;
    }

    set_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY, &catalog)?;

    if let Err(error) = sync_result {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("同步模型失败: {}", error),
        ));
    }

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
    validate_custom_openai_body(&body, false)?;
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);

    if let Some(obj) = config.as_object_mut() {
        if let Some(enabled) = body.enabled {
            obj.insert("enabled".to_string(), json!(enabled));
        }
        if let Some(display_name) = body.display_name {
            obj.insert("displayName".to_string(), json!(display_name.trim()));
        }
        if let Some(base_url) = body.base_url {
            obj.insert("baseUrl".to_string(), json!(base_url));
        }
        if let Some(api_key) = body.api_key {
            obj.insert("apiKey".to_string(), json!(api_key));
        }
        if let Some(text_models) = body.text_models {
            obj.insert(
                "textModels".to_string(),
                json!(normalize_non_empty_string_list(text_models, "textModels")?),
            );
        }
        if let Some(available) = body.available_text_models {
            obj.insert(
                "availableTextModels".to_string(),
                json!(normalize_non_empty_string_list(
                    available,
                    "availableTextModels"
                )?),
            );
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
    payload: Option<Json<CustomOpenAIPutBody>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);

    if let Some(Json(body)) = payload {
        validate_custom_openai_body(&body, true)?;
        if let Some(obj) = config.as_object_mut() {
            if let Some(enabled) = body.enabled {
                obj.insert("enabled".to_string(), json!(enabled));
            }
            if let Some(display_name) = body.display_name {
                obj.insert("displayName".to_string(), json!(display_name.trim()));
            }
            if let Some(base_url) = body.base_url {
                obj.insert("baseUrl".to_string(), json!(base_url));
            }
            if let Some(api_key) = body.api_key {
                obj.insert("apiKey".to_string(), json!(api_key));
            }
            if let Some(text_models) = body.text_models {
                obj.insert(
                    "textModels".to_string(),
                    json!(normalize_non_empty_string_list(text_models, "textModels")?),
                );
            }
        }
    }

    let sync_result =
        fetch_provider_models_from_remote("custom_openai", &wrap_custom_openai_creds(&config)).await;
    let synced_at = now_iso();
    let sync_error = sync_result.as_ref().err().cloned();
    let synced_models = sync_result.clone().unwrap_or_default();
    let previous_selected_models = json_string_list(config.get("textModels"));
    let next_selected_models = if let Ok(models) = sync_result.as_ref() {
        retain_enabled_models(&previous_selected_models, models)
    } else {
        previous_selected_models
    };

    if let Some(obj) = config.as_object_mut() {
        if sync_result.is_ok() {
            obj.insert("textModels".to_string(), json!(next_selected_models));
            obj.insert("availableTextModels".to_string(), json!(synced_models));
        }
        obj.insert("modelsSyncedAt".to_string(), json!(synced_at));
        obj.insert(
            "modelsSyncError".to_string(),
            sync_error.map(|value| json!(value)).unwrap_or(Value::Null),
        );
    }

    set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;

    if let Err(error) = sync_result {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("同步模型失败: {}", error),
        ));
    }

    api_custom_openai_get(State(state)).await
}

/// 构造脱敏后的供应商凭证视图（不回传密钥明文，仅返回是否已配置 + Base URL）。
fn provider_credentials_public(creds: &Value) -> Value {
    let mask = |provider: &str, field: &str| provider_credential_field(creds, provider, field).is_some();
    let base_url = |provider: &str| {
        provider_credential_field(creds, provider, "baseUrl").unwrap_or_default()
    };
    json!({
      "gemini":     { "hasApiKey": mask("gemini", "apiKey"), "baseUrl": base_url("gemini") },
      "qwen":       { "hasApiKey": mask("qwen", "apiKey"), "baseUrl": base_url("qwen") },
      "volcengine": { "hasApiKey": mask("volcengine", "apiKey"), "baseUrl": base_url("volcengine") },
      "deepseek":   { "hasApiKey": mask("deepseek", "apiKey"), "baseUrl": base_url("deepseek") },
      "kling": {
        "hasAccessKey": mask("kling", "accessKey"),
        "hasSecretKey": mask("kling", "secretKey"),
        "baseUrl": base_url("kling")
      }
    })
}

async fn api_provider_credentials_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let creds = load_provider_creds(&conn);
    Ok(Json(json!({
      "success": true,
      "data": provider_credentials_public(&creds)
    })))
}

async fn api_provider_credentials_put(
    Path(provider): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<ProviderCredentialsPutBody>,
) -> Result<Json<Value>, ApiError> {
    if !matches!(
        provider.as_str(),
        "gemini" | "qwen" | "volcengine" | "deepseek" | "kling"
    ) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "该供应商不支持凭证配置",
        ));
    }

    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, PROVIDER_CREDENTIALS_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(default_provider_credentials);

    {
        let root = config.as_object_mut().expect("provider credentials must be object");
        let entry = root
            .entry(provider.clone())
            .or_insert_with(|| json!({}));
        let entry_obj = match entry.as_object_mut() {
            Some(obj) => obj,
            None => {
                *entry = json!({});
                entry.as_object_mut().unwrap()
            }
        };

        // 留空字符串视为“清除”，未提供（None）视为“保留已有”。
        if provider == "kling" {
            if let Some(access_key) = body.access_key {
                entry_obj.insert("accessKey".to_string(), json!(access_key.trim()));
            }
            if let Some(secret_key) = body.secret_key {
                entry_obj.insert("secretKey".to_string(), json!(secret_key.trim()));
            }
        } else if let Some(api_key) = body.api_key {
            entry_obj.insert("apiKey".to_string(), json!(api_key.trim()));
        }
        if let Some(base_url) = body.base_url {
            entry_obj.insert("baseUrl".to_string(), json!(base_url.trim()));
        }
    }

    set_config_json(&conn, PROVIDER_CREDENTIALS_KEY, &config)?;
    api_provider_credentials_get(State(state)).await
}

/// TOS 配置脱敏视图：密钥仅返回是否已配置。
fn tos_config_public(config: &Value) -> Value {
    let has = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    };
    let text = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    json!({
      "enabled": config.get("enabled").and_then(Value::as_bool).unwrap_or(false),
      "accessKeyId": text("accessKeyId"),
      "hasSecretKey": has("secretKey"),
      "hasSecurityToken": has("securityToken"),
      "region": text("region"),
      "endpoint": text("endpoint"),
      "bucket": text("bucket"),
      "keyPrefix": text("keyPrefix"),
      "publicBaseUrl": text("publicBaseUrl"),
      "isCustomDomain": config.get("isCustomDomain").and_then(Value::as_bool).unwrap_or(false)
    })
}

async fn api_tos_config_get(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)?.unwrap_or_else(default_tos_config);
    Ok(Json(json!({
      "success": true,
      "data": tos_config_public(&config)
    })))
}

async fn api_tos_config_put(
    State(state): State<BackendState>,
    Json(body): Json<TosConfigPutBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(default_tos_config);

    {
        let obj = config.as_object_mut().expect("tos config must be object");
        if let Some(enabled) = body.enabled {
            obj.insert("enabled".to_string(), json!(enabled));
        }
        if let Some(access_key_id) = body.access_key_id {
            obj.insert("accessKeyId".to_string(), json!(access_key_id.trim()));
        }
        if let Some(secret_key) = body.secret_key {
            obj.insert("secretKey".to_string(), json!(secret_key.trim()));
        }
        if let Some(security_token) = body.security_token {
            obj.insert("securityToken".to_string(), json!(security_token.trim()));
        }
        if let Some(region) = body.region {
            obj.insert("region".to_string(), json!(region.trim()));
        }
        if let Some(endpoint) = body.endpoint {
            obj.insert("endpoint".to_string(), json!(endpoint.trim()));
        }
        if let Some(bucket) = body.bucket {
            obj.insert("bucket".to_string(), json!(bucket.trim()));
        }
        if let Some(key_prefix) = body.key_prefix {
            obj.insert("keyPrefix".to_string(), json!(key_prefix.trim()));
        }
        if let Some(public_base_url) = body.public_base_url {
            obj.insert("publicBaseUrl".to_string(), json!(public_base_url.trim()));
        }
        if let Some(is_custom_domain) = body.is_custom_domain {
            obj.insert("isCustomDomain".to_string(), json!(is_custom_domain));
        }
    }

    set_config_json(&conn, TOS_STORAGE_CONFIG_KEY, &config)?;
    api_tos_config_get(State(state)).await
}

async fn api_debug_logs_get(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let limit = match query.get("limit") {
        Some(raw) => {
            let parsed = raw
                .parse::<usize>()
                .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "limit 必须是整数"))?;
            if !(1..=500).contains(&parsed) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "limit 必须在 1 到 500 之间",
                ));
            }
            parsed
        }
        None => 100,
    };
    let require_non_empty_query = |key: &str| -> Result<Option<String>, ApiError> {
        match query.get(key) {
            None => Ok(None),
            Some(value) => {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        format!("{} 不能为空", key),
                    ));
                }
                Ok(Some(trimmed.to_ascii_lowercase()))
            }
        }
    };
    let provider_filter = query
        .get("provider")
        .map(|_| require_non_empty_query("provider"))
        .transpose()?
        .flatten();
    let operation_filter = query
        .get("operation")
        .map(|_| require_non_empty_query("operation"))
        .transpose()?
        .flatten();
    let status_filter = query
        .get("status")
        .map(|_| require_non_empty_query("status"))
        .transpose()?
        .flatten();
    if let Some(status) = &status_filter {
        if !matches!(status.as_str(), "success" | "error") {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "status 无效"));
        }
    }
    let model_filter = query
        .get("model")
        .map(|_| require_non_empty_query("model"))
        .transpose()?
        .flatten();
    let keyword_filter = query
        .get("keyword")
        .map(|_| require_non_empty_query("keyword"))
        .transpose()?
        .flatten();

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
    let total = logs.len();

    Ok(Json(
        json!({ "success": true, "data": { "logs": logs, "total": total } }),
    ))
}

async fn api_debug_logs_delete(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    conn.execute("DELETE FROM model_debug_logs", [])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    #[cfg(debug_assertions)]
    {
        let dir = state.data_dir.join("llm-debug-logs");
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
        }
        fs::create_dir_all(&dir)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
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
