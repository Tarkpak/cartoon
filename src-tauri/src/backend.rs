#[cfg(target_os = "windows")]
use crate::process_util::hidden_command;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post, put};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{SecondsFormat, Utc};
use reqwest::Client;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::agreement::{self, EphemeralPrivateKey, UnparsedPublicKey};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use uuid::Uuid;
use ve_tos_rust_sdk::object::{DeleteObjectInput, ObjectAPI, PutObjectFromBufferInput};
use ve_tos_rust_sdk::tos;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const STYLE_PRESET_CONFIG_KEY: &str = "style_preset_config";
const STYLE_PRESET_DATA_KEY: &str = "style_preset_data";
const SELECTED_MODELS_KEY: &str = "selected_models";
const WORKFLOW_MODELS_KEY: &str = "workflow_models";
const WORKFLOW_MODEL_OPTIONS_KEY: &str = "workflow_model_options";
const CLOUD_MODEL_OPTIONS_MODEL_ID: &str = "__model_options__";
const SELECTED_MODELS_USER_SELECTED_KEY: &str = "_userSelected";
const CUSTOM_OPENAI_CONFIG_KEY: &str = "custom_openai_provider";
const PROVIDER_CREDENTIALS_KEY: &str = "provider_credentials";
const TOS_STORAGE_CONFIG_KEY: &str = "tos_storage_config";
const PROVIDER_MODEL_CATALOG_KEY: &str = "provider_model_catalog";
const PROMPT_TEMPLATES_KEY: &str = "prompt_templates_default";
const PROMPT_PROFILES_KEY: &str = "prompt_profiles_default";
const PROMPT_VERSIONS_KEY: &str = "prompt_versions_default";
const PROMPT_PROFILE_STATE_KEY: &str = "prompt_profile_state_default";
const ASSET_IMAGE_UPLOAD_BODY_LIMIT_BYTES: usize = 50 * 1024 * 1024;
const VIDEO_IMPORT_UPLOAD_BODY_LIMIT_BYTES: usize = 2 * 1024 * 1024 * 1024;
const SETTINGS_CONFIG_EXPORT_VERSION: i32 = 1;
const SETTINGS_CONFIG_TEXT_MAX_CHARS: usize = 16 * 1024;
const SETTINGS_CONFIG_ENCRYPTED_TYPE: &str = "playlet.settings_config.encrypted";
const SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN: usize = 12;
const SETTINGS_CONFIG_ENCRYPTION_AAD: &[u8] = b"playlet.settings-config.v1";
const SETTINGS_CONFIG_ENCRYPTION_CONTEXT: &[u8] =
    b"playlet.desktop.local-settings-config-export.v1";
const APP_LOG_RETENTION_LIMIT: i64 = 10_000;
const MODEL_DEBUG_LOG_RETENTION_LIMIT: i64 = 5_000;
const APP_LOG_MESSAGE_MAX_CHARS: usize = 16 * 1024;
const APP_LOG_JSON_MAX_CHARS: usize = 64 * 1024;
const REQUEST_ID_HEADER: &str = "x-request-id";
const CLOUD_ADMIN_CONFIG_KEY: &str = "cloud_admin_config";
const CLOUD_ADMIN_SESSION_KEY: &str = "cloud_admin_session";
const CLOUD_PROVIDER_CREDENTIALS_KEY: &str = "cloud_provider_credentials";
const CLOUD_DEVICE_ID_KEY: &str = "cloud_device_id";
const CLOUD_DELETED_PROJECT_TOMBSTONES_KEY: &str = "cloud_deleted_project_tombstones";
const CLOUD_SECRET_TRANSPORT_HEADER: &str = "x-playlet-secure-request";
const CLOUD_SECRET_TRANSPORT_CONTEXT: &[u8] = b"playlet.cloud-secret-transport.v1";
const CLOUD_SECRET_TRANSPORT_AAD: &[u8] = b"playlet.cloud-secret-response.v1";
const CLOUD_SECRET_TRANSPORT_NONCE_LEN: usize = 12;
const DEV_CLOUD_ADMIN_BASE_URL: &str = "http://127.0.0.1:43200";
const PROD_CLOUD_ADMIN_BASE_URL: &str = "https://admin.tempocc.cn";

const DEFAULT_STYLE_PRESETS_JSON: &str = include_str!("../assets/default-style-presets.json");
const DEFAULT_STYLE_CATEGORIES_JSON: &str = include_str!("../assets/default-style-categories.json");
const STYLE_THUMBNAIL_CDN_BASE: &str =
    "https://playlet-ai.tos-cn-guangzhou.volces.com/manju-assets/styles";
const LEGACY_STYLE_THUMBNAIL_CDN_BASE: &str =
    "https://playlet-ai.tos-cn-guangzhou.volces.com/playlet-assets/styles";
const DEFAULT_PROMPT_TEMPLATES_JSON: &str = include_str!("../assets/default-prompt-templates.json");
const ARK_OPENAPI_ENDPOINT: &str = "https://open.volcengineapi.com";
const ARK_OPENAPI_REGION: &str = "cn-beijing";
const ARK_OPENAPI_SERVICE: &str = "ark";
const ARK_OPENAPI_VERSION: &str = "2024-01-01";

#[path = "backend/douyin.rs"]
mod douyin;
#[path = "backend/model_constraints.rs"]
mod model_constraints;
#[path = "backend/prompts_api.rs"]
mod prompts_api;
#[path = "backend/runtime_api.rs"]
mod runtime_api;
#[path = "backend/short_video.rs"]
mod short_video;
#[path = "backend/video_import.rs"]
mod video_import;
#[path = "backend/wx_channels.rs"]
mod wx_channels;

use model_constraints::{build_available_model_entry, image_model_config, AvailableModelKind};
use prompts_api::*;
use runtime_api::*;
use short_video::*;
use video_import::*;

tokio::task_local! {
    static CURRENT_REQUEST_ID: String;
    static CURRENT_MODEL_LOG_CONTEXT: ModelLogContext;
}

#[derive(Clone, Debug, Default)]
struct ModelLogContext {
    project_id: Option<String>,
    scene_id: Option<String>,
    task_id: Option<String>,
}

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
        let mut body = json!({
          "success": false,
          "message": self.message
        });
        if let Some(request_id) = current_request_id() {
            body["requestId"] = json!(request_id);
        }
        (self.status, Json(body)).into_response()
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
    #[serde(rename = "mediakitApiKey")]
    mediakit_api_key: Option<String>,
    #[serde(rename = "arkAccessKey")]
    ark_access_key: Option<String>,
    #[serde(rename = "arkSecretKey")]
    ark_secret_key: Option<String>,
    #[serde(rename = "arkProjectName")]
    ark_project_name: Option<String>,
    #[serde(rename = "arkOpenApiBaseUrl")]
    ark_open_api_base_url: Option<String>,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(rename = "accessKey")]
    access_key: Option<String>,
    #[serde(rename = "secretKey")]
    secret_key: Option<String>,
}

#[derive(Deserialize)]
struct CloudLoginBody {
    #[serde(rename = "baseUrl")]
    base_url: String,
    account: String,
    password: String,
}

#[derive(Deserialize)]
struct CloudConfigPutBody {
    #[serde(rename = "baseUrl")]
    base_url: String,
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
    props: Option<String>,
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
    parent_character_id: Option<String>,
    variant_name: Option<String>,
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
    ark_asset: Option<String>,
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
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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

fn set_global_db_path(path: PathBuf) {
    let _ = DB_PATH.set(path);
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
    // WAL 允许并发读，但并发写仍会串行；没有 busy_timeout 时第二个写者会立刻拿到
    // SQLITE_BUSY。日志观测中间件让每个请求都写库，写竞争概率明显上升，因此统一等待。
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(conn)
}

/// 为没有 `BackendState` 的深层助手提供只读配置连接（依赖 `set_global_db_path` 在启动时初始化）。
fn config_connection() -> Option<Connection> {
    let path = DB_PATH.get()?;
    open_db_connection(path).ok()
}

fn current_request_id() -> Option<String> {
    CURRENT_REQUEST_ID.try_with(|value| value.clone()).ok()
}

fn sanitize_model_log_context_value(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_model_log_context(
    project_id: Option<String>,
    scene_id: Option<String>,
    task_id: Option<String>,
) -> ModelLogContext {
    ModelLogContext {
        project_id: sanitize_model_log_context_value(project_id),
        scene_id: sanitize_model_log_context_value(scene_id),
        task_id: sanitize_model_log_context_value(task_id),
    }
}

fn current_model_log_context() -> ModelLogContext {
    CURRENT_MODEL_LOG_CONTEXT
        .try_with(|value| value.clone())
        .unwrap_or_default()
}

fn new_request_id() -> String {
    format!("req_{}", Uuid::new_v4().simple())
}

fn sanitize_request_id(raw: &str) -> Option<String> {
    let sanitized = raw
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
        .take(128)
        .collect::<String>();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn request_id_from_headers(headers: &HeaderMap) -> String {
    headers
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(sanitize_request_id)
        .unwrap_or_else(new_request_id)
}

fn truncate_log_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let preview = value.chars().take(max_chars).collect::<String>();
    format!("{}...", preview)
}

fn app_log_json_string(value: Option<&Value>) -> Option<String> {
    let value = value?;
    let raw = value.to_string();
    let char_count = raw.chars().count();
    if char_count <= APP_LOG_JSON_MAX_CHARS {
        return Some(raw);
    }

    Some(
        json!({
          "kind": "truncated-json",
          "chars": char_count,
          "preview": truncate_log_text(&raw, APP_LOG_JSON_MAX_CHARS)
        })
        .to_string(),
    )
}

fn normalize_app_log_level(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "debug" => "debug",
        "info" => "info",
        "warn" | "warning" => "warn",
        "error" => "error",
        _ => "info",
    }
}

fn sanitize_app_log_token(value: Option<&str>, fallback: &str) -> String {
    let sanitized = value
        .unwrap_or(fallback)
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
        .take(80)
        .collect::<String>();
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

/// 采样网关：让保留清理不必每次插入都执行。约每 64 次调用返回一次 true，
/// 期间表可能短暂超出上限若干行，滚动清理会再次收敛，属可接受的折中。
fn should_run_log_retention() -> bool {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed) % 64 == 0
}

/// 将日志表裁剪到最新的 `limit` 行。`table` 必须是受信任的字符串字面量
/// （永不来自用户输入），因为它会被直接拼进 SQL。
fn prune_log_table(conn: &Connection, table: &str, limit: i64) {
    let pending_guard = if table == "model_debug_logs" {
        "AND COALESCE(cloud_sync_status, 'legacy') NOT IN ('pending', 'syncing')"
    } else {
        ""
    };
    let _ = conn.execute(
        &format!(
            "DELETE FROM {table}
             WHERE rowid NOT IN (
               SELECT rowid FROM {table} ORDER BY timestamp DESC LIMIT ?1
             ) {pending_guard}"
        ),
        params![limit],
    );
}

fn insert_app_log(
    state: &BackendState,
    level: &str,
    source: &str,
    category: &str,
    message: &str,
    request_id: Option<&str>,
    method: Option<&str>,
    path: Option<&str>,
    status: Option<u16>,
    duration_ms: Option<i64>,
    metadata: Option<&Value>,
    error: Option<&Value>,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let now = now_iso();
    let request_id = request_id.and_then(sanitize_request_id);
    let status = status.map(i64::from);
    conn.execute(
        "INSERT INTO app_logs (
          id, timestamp, level, source, category, message, request_id,
          method, path, status, duration_ms, metadata_json, error_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            format!("log_{}", Uuid::new_v4().simple()),
            now,
            normalize_app_log_level(level),
            sanitize_app_log_token(Some(source), "backend"),
            sanitize_app_log_token(Some(category), "event"),
            truncate_log_text(message, APP_LOG_MESSAGE_MAX_CHARS),
            request_id,
            method.map(|value| truncate_log_text(value, 16)),
            path.map(|value| truncate_log_text(value, 512)),
            status,
            duration_ms,
            app_log_json_string(metadata),
            app_log_json_string(error),
            now_iso()
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if should_run_log_retention() {
        prune_log_table(&conn, "app_logs", APP_LOG_RETENTION_LIMIT);
    }

    Ok(())
}

fn should_log_http_request(path: &str) -> bool {
    path.starts_with("/api")
        && !path.starts_with("/api/debug/app-logs")
        && !path.starts_with("/api/debug/model-logs")
        && !path.starts_with("/api/video/status/")
}

fn http_log_level(status: StatusCode) -> &'static str {
    if status.is_server_error() {
        "error"
    } else if status.is_client_error() {
        "warn"
    } else {
        "info"
    }
}

async fn request_observability_middleware(
    State(state): State<BackendState>,
    mut request: Request,
    next: Next,
) -> Response {
    let request_id = request_id_from_headers(request.headers());
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    let has_query = request.uri().query().is_some();
    let user_agent = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| truncate_log_text(value, 512));
    let started_at = Instant::now();

    request.extensions_mut().insert(request_id.clone());

    let mut response = CURRENT_REQUEST_ID
        .scope(request_id.clone(), async move { next.run(request).await })
        .await;
    let status = response.status();
    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), value);
    }

    if should_log_http_request(&path) {
        let metadata = json!({
          "hasQuery": has_query,
          "userAgent": user_agent
        });
        let error = if status.is_client_error() || status.is_server_error() {
            Some(json!({
              "status": status.as_u16(),
              "reason": status.canonical_reason().unwrap_or("")
            }))
        } else {
            None
        };
        let message = format!("{} {} -> {}", method, path, status.as_u16());
        let _ = insert_app_log(
            &state,
            http_log_level(status),
            "backend",
            "http_request",
            &message,
            Some(&request_id),
            Some(&method),
            Some(&path),
            Some(status.as_u16()),
            Some(duration_ms),
            Some(&metadata),
            error.as_ref(),
        );
    }

    response
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

fn cloud_runtime_credentials() -> &'static RwLock<Value> {
    static CREDENTIALS: OnceLock<RwLock<Value>> = OnceLock::new();
    CREDENTIALS.get_or_init(|| RwLock::new(json!({})))
}

fn set_cloud_runtime_credentials(value: Value) {
    if let Ok(mut guard) = cloud_runtime_credentials().write() {
        *guard = value;
    }
}

fn get_cloud_runtime_credentials() -> Option<Value> {
    let value = cloud_runtime_credentials().read().ok()?.clone();
    if value.as_object().is_some_and(|object| !object.is_empty()) {
        Some(value)
    } else {
        None
    }
}

fn clear_cloud_runtime_credentials() {
    set_cloud_runtime_credentials(json!({}));
}

fn cloud_runtime_wx_channels_config() -> &'static RwLock<Value> {
    static WX_CHANNELS_CONFIG: OnceLock<RwLock<Value>> = OnceLock::new();
    WX_CHANNELS_CONFIG.get_or_init(|| RwLock::new(json!({})))
}

fn set_cloud_runtime_wx_channels_config(value: Value) {
    if let Ok(mut guard) = cloud_runtime_wx_channels_config().write() {
        *guard = value;
    }
}

fn get_cloud_runtime_wx_channels_config() -> Option<Value> {
    let value = cloud_runtime_wx_channels_config().read().ok()?.clone();
    if value.as_object().is_some_and(|object| !object.is_empty()) {
        Some(value)
    } else {
        None
    }
}

fn cloud_runtime_tos_config() -> &'static RwLock<Value> {
    static TOS_CONFIG: OnceLock<RwLock<Value>> = OnceLock::new();
    TOS_CONFIG.get_or_init(|| RwLock::new(json!({})))
}

fn set_cloud_runtime_tos_config(value: Value) {
    if let Ok(mut guard) = cloud_runtime_tos_config().write() {
        *guard = value;
    }
}

fn get_cloud_runtime_tos_config() -> Option<Value> {
    let value = cloud_runtime_tos_config().read().ok()?.clone();
    if value.as_object().is_some_and(|object| !object.is_empty()) {
        Some(value)
    } else {
        None
    }
}

fn clear_cloud_runtime_config() {
    clear_cloud_runtime_credentials();
    set_cloud_runtime_wx_channels_config(json!({}));
    set_cloud_runtime_tos_config(json!({}));
}

fn build_llm_transport_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("模型服务请求超时: {}", error);
    }
    if error.is_connect() {
        return format!("模型服务连接失败: {}", error);
    }
    error.to_string()
}

fn build_cloud_transport_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("后台请求超时: {}", error);
    }
    if error.is_connect() {
        return format!("后台服务连接失败: {}", error);
    }
    error.to_string()
}

fn normalize_cloud_base_url(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "后台地址不能为空"));
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "后台地址必须以 http:// 或 https:// 开头",
        ));
    }
    Ok(trimmed.to_string())
}

fn default_cloud_admin_base_url() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_CLOUD_ADMIN_BASE_URL
    } else {
        PROD_CLOUD_ADMIN_BASE_URL
    }
}

fn should_use_default_cloud_admin_base_url(value: &str) -> bool {
    let normalized = value.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return true;
    }
    if cfg!(debug_assertions) {
        normalized == PROD_CLOUD_ADMIN_BASE_URL
    } else {
        normalized == DEV_CLOUD_ADMIN_BASE_URL || normalized == "http://localhost:43200"
    }
}

fn cloud_config(conn: &Connection) -> Value {
    get_config_json(conn, CLOUD_ADMIN_CONFIG_KEY)
        .ok()
        .flatten()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "baseUrl": default_cloud_admin_base_url() }))
}

fn cloud_base_url(conn: &Connection) -> Option<String> {
    cloud_config(conn)
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn cloud_session(conn: &Connection) -> Option<Value> {
    get_config_json(conn, CLOUD_ADMIN_SESSION_KEY)
        .ok()
        .flatten()
        .filter(Value::is_object)
}

fn cloud_token(conn: &Connection) -> Option<String> {
    cloud_session(conn)
        .and_then(|session| {
            session
                .get("token")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
}

fn cloud_user_public(conn: &Connection) -> Option<Value> {
    cloud_session(conn).and_then(|session| session.get("user").cloned())
}

fn cloud_user_is_admin() -> bool {
    config_connection()
        .and_then(|conn| cloud_user_public(&conn))
        .and_then(|user| user.get("role").and_then(Value::as_str).map(str::to_string))
        .is_some_and(|role| role == "admin")
}

fn normalize_cloud_model_policy_provider(provider: &str) -> Option<String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return None;
    }
    let normalized = if provider == "openai" {
        "custom_openai"
    } else {
        provider
    };
    if is_supported_provider(normalized) {
        Some(normalized.to_string())
    } else {
        None
    }
}

fn insert_cloud_model_policy(
    policy: &mut HashMap<String, Vec<String>>,
    provider: &str,
    models: Option<&Value>,
) {
    let Some(provider_key) = normalize_cloud_model_policy_provider(provider) else {
        return;
    };
    let entry = policy.entry(provider_key).or_default();
    let mut seen: HashSet<String> = entry.iter().cloned().collect();
    for model in json_string_list(models) {
        if seen.insert(model.clone()) {
            entry.push(model);
        }
    }
}

fn cloud_allowed_models_by_provider(conn: &Connection) -> Option<HashMap<String, Vec<String>>> {
    let session = cloud_session(conn)?;
    let bootstrap = session.get("bootstrap")?;
    let has_policy = bootstrap.get("providerModels").is_some()
        || bootstrap.get("allowedModelsByProvider").is_some();
    if !has_policy {
        return None;
    }

    let mut policy = HashMap::new();
    if let Some(items) = bootstrap.get("providerModels").and_then(Value::as_array) {
        for item in items {
            let provider = item
                .get("providerKey")
                .or_else(|| item.get("provider"))
                .and_then(Value::as_str)
                .unwrap_or("");
            insert_cloud_model_policy(&mut policy, provider, item.get("models"));
        }
    }

    if let Some(object) = bootstrap
        .get("allowedModelsByProvider")
        .and_then(Value::as_object)
    {
        for (provider, models) in object {
            insert_cloud_model_policy(&mut policy, provider, Some(models));
        }
    }

    Some(policy)
}

fn get_or_create_cloud_device_id(conn: &Connection) -> Result<String, ApiError> {
    // 先检查数据库中是否已有设备ID
    if let Some(value) = get_config_json(conn, CLOUD_DEVICE_ID_KEY)?
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(value);
    }

    // 尝试基于机器硬件生成唯一设备ID
    let device_id = match machine_uid::get() {
        Ok(machine_id) => {
            // 使用机器ID + 应用标识生成设备ID
            // 格式: desktop_<machine_id_hash>
            let hash = {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(b"playlet-desktop-v1:");
                hasher.update(machine_id.as_bytes());
                let result = hasher.finalize();
                format!("{:x}", result)[..16].to_string()
            };
            format!("desktop_{}", hash)
        }
        Err(err) => {
            // 如果无法获取机器ID（虚拟机、权限问题等），回退到UUID
            // 但记录警告日志
            log::warn!("无法获取机器唯一ID，回退到随机UUID: {}", err);
            format!("desktop_{}", Uuid::new_v4().simple())
        }
    };

    set_config_json(conn, CLOUD_DEVICE_ID_KEY, &json!(device_id))?;
    Ok(device_id)
}

fn cloud_auth_headers(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    match token.map(str::trim).filter(|value| !value.is_empty()) {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

async fn cloud_request_json(
    base_url: &str,
    method: reqwest::Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let mut request = http_client().request(method, url);
    request = cloud_auth_headers(request, token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "连接后台失败: {}",
                build_cloud_transport_error_message(&error)
            ),
        )
    })?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let payload =
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "message": text }));
    if !status.is_success() {
        let message = payload
            .get("statusMessage")
            .or_else(|| payload.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("后台接口返回失败");
        let local_status = if status.is_client_error() {
            status
        } else {
            StatusCode::BAD_GATEWAY
        };
        return Err(ApiError::new(local_status, message));
    }
    Ok(payload)
}

fn cloud_secret_transport_key(
    shared_secret: &[u8],
    client_public_key: &[u8],
    server_public_key: &[u8],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(CLOUD_SECRET_TRANSPORT_CONTEXT);
    hasher.update(shared_secret);
    hasher.update(client_public_key);
    hasher.update(server_public_key);
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn cloud_secure_envelope_field<'a>(data: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应格式无效"))
}

fn decrypt_cloud_secure_data(
    data: &Value,
    client_private_key: EphemeralPrivateKey,
    client_public_key: &[u8],
) -> Result<Value, ApiError> {
    if data.get("encrypted").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "后台未使用加密通道下发配置",
        ));
    }

    let server_public_key =
        decode_base64_bytes(cloud_secure_envelope_field(data, "serverPublicKey")?)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应格式无效"))?;
    if server_public_key.len() != 32 {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "后台加密响应格式无效",
        ));
    }

    let nonce = decode_base64_bytes(cloud_secure_envelope_field(data, "nonce")?)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应格式无效"))?;
    if nonce.len() != CLOUD_SECRET_TRANSPORT_NONCE_LEN {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "后台加密响应格式无效",
        ));
    }

    let mut nonce_bytes = [0u8; CLOUD_SECRET_TRANSPORT_NONCE_LEN];
    nonce_bytes.copy_from_slice(&nonce);
    let mut encrypted_payload = decode_base64_bytes(cloud_secure_envelope_field(data, "payload")?)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应格式无效"))?;

    let peer_public_key = UnparsedPublicKey::new(&agreement::X25519, server_public_key.as_slice());
    let shared_secret =
        agreement::agree_ephemeral(client_private_key, &peer_public_key, |secret| {
            secret.to_vec()
        })
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密通道协商失败"))?;
    let key_bytes =
        cloud_secret_transport_key(&shared_secret, client_public_key, &server_public_key);
    let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应解密失败"))?;
    let key = LessSafeKey::new(unbound);
    let plaintext = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(CLOUD_SECRET_TRANSPORT_AAD),
            &mut encrypted_payload,
        )
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应解密失败"))?;

    serde_json::from_slice::<Value>(plaintext)
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "后台加密响应 JSON 无效"))
}

async fn cloud_request_secure_json(
    base_url: &str,
    method: reqwest::Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let rng = SystemRandom::new();
    let client_private_key = EphemeralPrivateKey::generate(&agreement::X25519, &rng)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "初始化加密通道失败"))?;
    let client_public_key = client_private_key
        .compute_public_key()
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "初始化加密通道失败"))?;
    let client_public_key_bytes = client_public_key.as_ref().to_vec();
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let mut request = http_client().request(method, url).header(
        CLOUD_SECRET_TRANSPORT_HEADER,
        format!("v1:{}", BASE64_STANDARD.encode(&client_public_key_bytes)),
    );
    request = cloud_auth_headers(request, token);
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "连接后台失败: {}",
                build_cloud_transport_error_message(&error)
            ),
        )
    })?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let mut payload =
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "message": text }));
    if !status.is_success() {
        let message = payload
            .get("statusMessage")
            .or_else(|| payload.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("后台接口返回失败");
        let local_status = if status.is_client_error() {
            status
        } else {
            StatusCode::BAD_GATEWAY
        };
        return Err(ApiError::new(local_status, message));
    }

    let data = payload
        .get("data")
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台响应格式无效"))?;
    let decrypted = decrypt_cloud_secure_data(data, client_private_key, &client_public_key_bytes)?;
    if let Some(object) = payload.as_object_mut() {
        object.insert("data".to_string(), decrypted);
    }
    Ok(payload)
}

fn cloud_provider_credentials_public(raw: Option<Value>) -> Value {
    let Some(value) = raw else {
        return json!({});
    };
    if let Some(object) = value.as_object() {
        let mut output = serde_json::Map::new();
        for (provider, item) in object {
            if provider == "custom_openai" {
                output.insert(
                    "customOpenaiProviders".to_string(),
                    json!(custom_openai_provider_entries(item)
                        .iter()
                        .map(custom_openai_public_entry)
                        .collect::<Vec<_>>()),
                );
                continue;
            }
            let has_api_key = item
                .get("apiKey")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let has_mediakit_api_key = item
                .get("mediakitApiKey")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let has_access_key = item
                .get("accessKey")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let has_secret_key = item
                .get("secretKey")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            output.insert(
                provider.to_string(),
                json!({
                  "baseUrl": item.get("baseUrl").and_then(Value::as_str).unwrap_or(""),
                  "hasApiKey": has_api_key,
                  "hasMediakitApiKey": has_mediakit_api_key,
                  "hasAccessKey": has_access_key,
                  "hasSecretKey": has_secret_key
                }),
            );
        }
        return Value::Object(output);
    }

    let Some(items) = value.as_array().cloned() else {
        return json!({});
    };
    let mut output = serde_json::Map::new();
    for item in items {
        let Some(provider) = item.get("providerKey").and_then(Value::as_str) else {
            continue;
        };
        let has_api_key = item
            .get("apiKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        let has_mediakit_api_key = item
            .get("mediakitApiKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        let has_access_key = item
            .get("accessKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        let has_secret_key = item
            .get("secretKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        output.insert(
            provider.to_string(),
            json!({
              "baseUrl": item.get("baseUrl").and_then(Value::as_str).unwrap_or(""),
              "hasApiKey": has_api_key,
              "hasMediakitApiKey": has_mediakit_api_key,
              "hasAccessKey": has_access_key,
              "hasSecretKey": has_secret_key
            }),
        );
    }
    Value::Object(output)
}

fn cloud_tos_storage_public(raw: Option<Value>) -> Value {
    let Some(config) = raw.filter(Value::is_object) else {
        return json!({});
    };
    let has = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
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

fn cloud_wx_channels_public(raw: Option<Value>) -> Value {
    let Some(config) = raw.filter(Value::is_object) else {
        return json!({
          "source": "cloud",
          "hasYuanbaoCookie": false
        });
    };
    let has_yuanbao_cookie = config
        .get("yuanbaoCookie")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    json!({
      "source": "cloud",
      "hasYuanbaoCookie": has_yuanbao_cookie
    })
}

fn normalize_cloud_wx_channels_config(raw: Value) -> Value {
    if raw.get("yuanbaoCookie").is_some() {
        return raw;
    }
    raw.get("config")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or(raw)
}

fn cloud_value_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn cloud_value_text_from<'a>(sources: impl IntoIterator<Item = &'a Value>, key: &str) -> String {
    for source in sources {
        let value = cloud_value_text(source, key);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn valid_project_status(value: &str) -> &str {
    if matches!(value, "draft" | "in_progress" | "completed") {
        value
    } else {
        "draft"
    }
}

fn valid_project_aspect_ratio(value: &str) -> &str {
    if matches!(value, "16:9" | "9:16" | "1:1") {
        value
    } else {
        "16:9"
    }
}

fn cloud_project_remote_updated_at(project: &Value, snapshot: &Value) -> String {
    let snapshot_project = snapshot.get("project").unwrap_or(&Value::Null);
    for value in [
        cloud_value_text(project, "localUpdatedAt"),
        cloud_value_text(project, "updatedAt"),
        cloud_value_text(project, "lastSyncedAt"),
        cloud_value_text(snapshot_project, "updatedAt"),
    ] {
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn local_project_updated_at(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<String>, ApiError> {
    conn.query_row(
        "SELECT updated_at FROM projects WHERE id = ?1 LIMIT 1",
        params![project_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn local_config_updated_at(conn: &Connection, key: &str) -> Result<Option<String>, ApiError> {
    conn.query_row(
        "SELECT updated_at FROM system_config WHERE key = ?1 LIMIT 1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn should_apply_cloud_update(local_updated_at: Option<String>, remote_updated_at: &str) -> bool {
    let remote = remote_updated_at.trim();
    if remote.is_empty() {
        return local_updated_at.is_none();
    }
    local_updated_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|local| local < remote)
        .unwrap_or(true)
}

fn build_cloud_project_put_body(snapshot: &Value, fallback: &Value) -> Value {
    let snapshot_project = snapshot.get("project").unwrap_or(&Value::Null);
    let script = snapshot.get("script").unwrap_or(&Value::Null);
    let mut body = serde_json::Map::new();

    let name = cloud_value_text_from([snapshot_project, fallback], "name");
    if !name.is_empty() {
        body.insert("name".to_string(), json!(name));
    }
    let description = cloud_value_text_from([snapshot_project, fallback], "description");
    body.insert("description".to_string(), json!(description));
    let status = cloud_value_text_from([snapshot_project, fallback], "status");
    body.insert("status".to_string(), json!(valid_project_status(&status)));

    for key in [
        "storyIdea",
        "novelText",
        "rawText",
        "selectedStyleId",
        "inputMode",
        "episodePlan",
        "assetWorkflow",
    ] {
        if let Some(value) = script.get(key).filter(|value| !value.is_null()) {
            body.insert(key.to_string(), value.clone());
        }
    }
    if let Some(value) = script
        .get("scriptParseMode")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "premium_drama" | "short_drama" | "origin_explainer"))
    {
        body.insert("scriptParseMode".to_string(), json!(value));
    }
    if let Some(value) = snapshot.get("scenes").filter(|value| value.is_array()) {
        body.insert("scenes".to_string(), value.clone());
    }
    if let Some(value) = snapshot.get("characters").filter(|value| value.is_array()) {
        body.insert("characters".to_string(), value.clone());
    }

    Value::Object(body)
}

fn upsert_cloud_project_placeholder(
    state: &BackendState,
    project_id: &str,
    project: &Value,
    snapshot: &Value,
    remote_updated_at: &str,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let snapshot_project = snapshot.get("project").unwrap_or(&Value::Null);
    let now = now_iso();
    let name = cloud_value_text_from([snapshot_project, project], "name");
    let description = cloud_value_text_from([snapshot_project, project], "description");
    let script_parse_mode_raw =
        cloud_value_text_from([snapshot_project, project], "scriptParseMode");
    let script_parse_mode = normalize_script_parse_mode(if script_parse_mode_raw.is_empty() {
        None
    } else {
        Some(script_parse_mode_raw.as_str())
    });
    let style_id = cloud_value_text_from([snapshot_project, project], "styleId");
    let aspect_ratio = cloud_value_text_from([snapshot_project, project], "aspectRatio");
    let status = cloud_value_text_from([snapshot_project, project], "status");
    let local_created_at = cloud_value_text(project, "localCreatedAt");
    let snapshot_created_at = cloud_value_text(snapshot_project, "createdAt");
    let created_at = if !local_created_at.is_empty() {
        local_created_at
    } else if !snapshot_created_at.is_empty() {
        snapshot_created_at
    } else {
        now.clone()
    };
    let updated_at = if remote_updated_at.trim().is_empty() {
        now.clone()
    } else {
        remote_updated_at.trim().to_string()
    };

    conn.execute(
        "INSERT INTO projects (id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at, owner_user_id, owner_account, owner_display_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           script_parse_mode = excluded.script_parse_mode,
           style_id = excluded.style_id,
           aspect_ratio = excluded.aspect_ratio,
           status = excluded.status,
           owner_user_id = excluded.owner_user_id,
           owner_account = excluded.owner_account,
           owner_display_name = excluded.owner_display_name,
           updated_at = excluded.updated_at",
        params![
            project_id,
            if name.is_empty() { "未命名项目" } else { name.as_str() },
            description,
            script_parse_mode,
            style_id,
            valid_project_aspect_ratio(&aspect_ratio),
            valid_project_status(&status),
            created_at,
            updated_at,
            cloud_value_text(project, "ownerUserId"),
            cloud_value_text(project, "ownerAccount"),
            cloud_value_text(project, "ownerDisplayName")
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn cloud_provider_credentials_to_local(raw: Option<Value>) -> Value {
    let mut output = serde_json::Map::new();
    let mut custom_openai_entries = Vec::<Value>::new();
    let Some(items) = raw.and_then(|value| value.as_array().cloned()) else {
        return Value::Object(output);
    };
    for item in items {
        let provider = item
            .get("providerKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if provider.is_empty() {
            continue;
        }
        let base_url = item
            .get("baseUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let api_key = item
            .get("apiKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let mediakit_api_key = item
            .get("mediakitApiKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let access_key = item
            .get("accessKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let secret_key = item
            .get("secretKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let display_name = item
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or("自定义 OpenAI")
            .trim();
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .and_then(sanitize_custom_openai_provider_id)
            .unwrap_or_else(|| format!("cloud_{}", custom_openai_entries.len().saturating_add(1)));

        let target_provider = if provider == "openai" {
            "custom_openai"
        } else {
            provider
        };

        if target_provider == "custom_openai" {
            if api_key.is_empty() || base_url.is_empty() {
                continue;
            }
            custom_openai_entries.push(json!({
              "id": id,
              "enabled": true,
              "displayName": if display_name.is_empty() { "自定义 OpenAI" } else { display_name },
              "baseUrl": base_url,
              "apiKey": api_key,
              "textModels": json_string_list(item.get("models")),
              "availableTextModels": json_string_list(item.get("availableModels")),
              "modelsSyncedAt": Value::Null,
              "modelsSyncError": Value::Null
            }));
            continue;
        }

        if target_provider == "kling" {
            if access_key.is_empty() || secret_key.is_empty() {
                continue;
            }
            output.insert(
                target_provider.to_string(),
                json!({
                  "accessKey": access_key,
                  "secretKey": secret_key,
                  "baseUrl": base_url
                }),
            );
        } else {
            if target_provider == "volcengine" && api_key.is_empty() && mediakit_api_key.is_empty()
            {
                continue;
            }
            if target_provider != "volcengine" && api_key.is_empty() {
                continue;
            }
            output.insert(
                target_provider.to_string(),
                if target_provider == "volcengine" {
                    json!({
                      "apiKey": api_key,
                      "mediakitApiKey": mediakit_api_key,
                      "baseUrl": base_url
                    })
                } else {
                    json!({
                    "apiKey": api_key,
                    "baseUrl": base_url
                      })
                },
            );
        }
    }
    if !custom_openai_entries.is_empty() {
        output.insert(
            "custom_openai".to_string(),
            custom_openai_config_from_entries(custom_openai_entries),
        );
    }
    Value::Object(output)
}

fn overlay_cloud_provider_creds(conn: &Connection, creds: &mut Value) {
    let _ = conn;
    let Some(cloud_creds) = get_cloud_runtime_credentials() else {
        return;
    };
    let Some(root) = creds.as_object_mut() else {
        return;
    };
    let Some(cloud_obj) = cloud_creds.as_object() else {
        return;
    };
    for (provider, value) in cloud_obj {
        root.insert(provider.clone(), value.clone());
    }
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
    let reverse_timestamp = 9_999_999_999_999_i64
        .saturating_sub(Utc::now().timestamp_millis())
        .max(0);
    format!(
        "{:013}_{}_{}.{}",
        reverse_timestamp,
        sanitize_file_component(prefix),
        Uuid::new_v4().simple(),
        sanitize_file_component(ext)
    )
}

#[derive(Clone, Debug)]
struct BackendTosStorageConfig {
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
    proxy_host: Option<String>,
    proxy_port: Option<isize>,
}

#[derive(Clone, Debug)]
struct TosProxyConfig {
    host: String,
    port: isize,
}

fn tos_config_text(config: &Value, key: &str) -> String {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn trim_tos_slashes(value: &str) -> String {
    value.trim().trim_matches('/').to_string()
}

fn normalize_tos_object_path(value: &str) -> String {
    trim_tos_slashes(value)
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn cloud_tos_user_scope_prefix() -> Option<String> {
    let conn = config_connection()?;
    let session = cloud_session(&conn)?;
    let username = session
        .get("user")
        .and_then(|user| user.get("account"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let component = username
        .chars()
        .filter_map(|ch| {
            if ch == '/' || ch == '\\' {
                Some('_')
            } else if ch.is_control() {
                None
            } else {
                Some(ch)
            }
        })
        .collect::<String>();
    if component.is_empty() {
        return None;
    }
    Some(format!("users/{}", component))
}

fn build_scoped_tos_key_prefix(
    raw_key_prefix: &str,
    use_cloud_scope: bool,
) -> (Option<String>, bool) {
    let base_prefix = normalize_tos_object_path(raw_key_prefix);
    let mut parts = Vec::new();
    if !base_prefix.is_empty() {
        parts.push(base_prefix.clone());
    }

    let user_scoped = if use_cloud_scope && !cloud_user_is_admin() {
        if let Some(user_prefix) = cloud_tos_user_scope_prefix() {
            let already_scoped =
                base_prefix == user_prefix || base_prefix.ends_with(&format!("/{user_prefix}"));
            if !already_scoped {
                parts.push(user_prefix);
            }
            true
        } else {
            return (None, true);
        }
    } else {
        false
    };

    let prefix = parts.join("/");
    if prefix.is_empty() {
        (None, user_scoped)
    } else {
        (Some(prefix), user_scoped)
    }
}

fn normalize_tos_base_url(value: &str) -> Option<String> {
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

fn normalize_tos_endpoint(raw: &str) -> (String, String) {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return ("".to_string(), "https".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("http://") {
        return (trim_tos_slashes(rest), "http".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("https://") {
        return (trim_tos_slashes(rest), "https".to_string());
    }
    (trim_tos_slashes(trimmed), "https".to_string())
}

fn normalize_tos_proxy(raw: &str) -> Option<TosProxyConfig> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let host_port = without_scheme
        .split(';')
        .find(|part| {
            let normalized = part.trim().to_ascii_lowercase();
            !normalized.starts_with("socks=")
                && !normalized.starts_with("ftp=")
                && !normalized.starts_with("https=")
        })
        .or_else(|| {
            without_scheme.split(';').find_map(|part| {
                part.trim()
                    .strip_prefix("http=")
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
        })
        .unwrap_or(without_scheme)
        .trim()
        .strip_prefix("http=")
        .unwrap_or(without_scheme.trim())
        .trim();
    let (host, port_raw) = host_port.rsplit_once(':')?;
    let port = port_raw.trim().parse::<isize>().ok()?;
    let host = host.trim().trim_matches('/').to_string();
    if host.is_empty() || port <= 0 || port > 65535 {
        return None;
    }
    Some(TosProxyConfig { host, port })
}

fn resolve_tos_proxy_config() -> Option<TosProxyConfig> {
    for key in ["TOS_PROXY", "tos_proxy"] {
        if let Ok(value) = std::env::var(key) {
            if let Some(proxy) = normalize_tos_proxy(&value) {
                return Some(proxy);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "ProxyServer",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if !line.contains("ProxyServer") {
                continue;
            }
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if let Some(value) = parts.last() {
                return normalize_tos_proxy(value);
            }
        }
    }

    None
}

fn load_backend_tos_config() -> BackendTosStorageConfig {
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

    let access_key_id = tos_config_text(&config, "accessKeyId");
    let access_key_secret = tos_config_text(&config, "secretKey");
    let security_token = {
        let token = tos_config_text(&config, "securityToken");
        if token.is_empty() {
            None
        } else {
            Some(token)
        }
    };
    let region = tos_config_text(&config, "region");
    let bucket = tos_config_text(&config, "bucket");
    let (key_prefix, has_required_scope) =
        build_scoped_tos_key_prefix(&tos_config_text(&config, "keyPrefix"), use_cloud_scope);
    let public_base_url = normalize_tos_base_url(&tos_config_text(&config, "publicBaseUrl"));
    let is_custom_domain = config
        .get("isCustomDomain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (endpoint, endpoint_protocol) =
        normalize_tos_endpoint(&tos_config_text(&config, "endpoint"));
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

    BackendTosStorageConfig {
        enabled: enabled_flag && has_required && (!use_cloud_scope || has_required_scope),
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
        proxy_host: proxy.as_ref().map(|value| value.host.clone()),
        proxy_port: proxy.as_ref().map(|value| value.port),
    }
}

fn tos_url_encode(input: &str) -> String {
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

fn build_backend_tos_public_url(config: &BackendTosStorageConfig, object_key: &str) -> String {
    let encoded_key = object_key
        .split('/')
        .map(tos_url_encode)
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

fn build_backend_tos_object_key(
    config: &BackendTosStorageConfig,
    category: &str,
    filename: &str,
) -> String {
    [config.key_prefix.as_deref(), Some(category), Some(filename)]
        .into_iter()
        .flatten()
        .map(normalize_tos_object_path)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn upload_media_bytes_to_tos(
    category: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<Option<String>, ApiError> {
    let config = load_backend_tos_config();
    if !config.enabled {
        return Ok(None);
    }

    let object_key = build_backend_tos_object_key(&config, category, filename);
    if object_key.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TOS 对象路径为空，无法上传媒体文件",
        ));
    }

    let endpoint = format!("{}://{}", config.endpoint_protocol, config.endpoint);
    let mut builder = tos::builder()
        .connection_timeout(15000)
        .request_timeout(300000)
        .max_retry_count(1)
        .ak(config.access_key_id.clone())
        .sk(config.access_key_secret.clone())
        .region(config.region.clone())
        .endpoint(endpoint)
        .is_custom_domain(config.is_custom_domain);
    if let Some(token) = &config.security_token {
        builder = builder.security_token(token.clone());
    }
    if let (Some(proxy_host), Some(proxy_port)) = (&config.proxy_host, config.proxy_port) {
        builder = builder
            .proxy_host(proxy_host.clone())
            .proxy_port(proxy_port);
    }
    let client = builder.build().map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("初始化 TOS 客户端失败: {}", error),
        )
    })?;
    let input = PutObjectFromBufferInput::new_with_content(
        config.bucket.clone(),
        object_key.clone(),
        bytes,
    );
    client.put_object_from_buffer(&input).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("上传到 TOS 失败: {}", error),
        )
    })?;

    Ok(Some(build_backend_tos_public_url(&config, &object_key)))
}

fn delete_backend_tos_object(object_key: &str) -> Result<(), ApiError> {
    let config = load_backend_tos_config();
    if !config.enabled {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TOS 未启用或配置不完整，无法删除对象",
        ));
    }
    let object_key = normalize_tos_object_path(object_key);
    if object_key.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "TOS 对象路径为空"));
    }
    if let Some(prefix) = &config.key_prefix {
        let prefix = normalize_tos_object_path(prefix);
        if !prefix.is_empty()
            && object_key != prefix
            && !object_key.starts_with(&format!("{prefix}/"))
        {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "只能删除当前 TOS 作用域内的对象",
            ));
        }
    }

    let endpoint = format!("{}://{}", config.endpoint_protocol, config.endpoint);
    let mut builder = tos::builder()
        .connection_timeout(15000)
        .request_timeout(60000)
        .max_retry_count(1)
        .ak(config.access_key_id.clone())
        .sk(config.access_key_secret.clone())
        .region(config.region.clone())
        .endpoint(endpoint)
        .is_custom_domain(config.is_custom_domain);
    if let Some(token) = &config.security_token {
        builder = builder.security_token(token.clone());
    }
    if let (Some(proxy_host), Some(proxy_port)) = (&config.proxy_host, config.proxy_port) {
        builder = builder
            .proxy_host(proxy_host.clone())
            .proxy_port(proxy_port);
    }
    let client = builder.build().map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("初始化 TOS 客户端失败: {}", error),
        )
    })?;
    let input = DeleteObjectInput::new(config.bucket.clone(), object_key);
    client.delete_object(&input).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("删除 TOS 对象失败: {}", error),
        )
    })?;
    Ok(())
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
    if let Some(url) = upload_media_bytes_to_tos("images", &filename, bytes)? {
        return Ok(url);
    }
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
    if let Some(url) = upload_media_bytes_to_tos("videos", &filename, bytes)? {
        return Ok(url);
    }
    let path = state.public_dir.join("videos").join(&filename);
    write_file_bytes(&path, bytes)?;
    Ok(format!("/api/video/file/{}", filename))
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
        "id": "video_import_script_generation",
        "name": "视频转项目剧本整理",
        "description": "将视频字幕整理为分场剧本文本",
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
      "providers": [default_custom_openai_provider_entry()]
    })
}

fn default_custom_openai_provider_entry() -> Value {
    json!({
      "id": "default",
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
      "volcengine": { "apiKey": "", "mediakitApiKey": "", "arkAccessKey": "", "arkSecretKey": "", "arkProjectName": "default", "arkOpenApiBaseUrl": "", "baseUrl": "" },
      "deepseek":   { "apiKey": "", "baseUrl": "" },
      "kling":      { "accessKey": "", "secretKey": "", "baseUrl": "" }
    })
}

/// TOS 云存储配置，本地保留旧配置；登录后台后优先使用后台下发配置。
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
    let cloud_model_policy = cloud_allowed_models_by_provider(conn);

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
        let provider_models = if let Some(policy) = cloud_model_policy.as_ref() {
            policy.get(provider).cloned().unwrap_or_default()
        } else {
            json_string_list(provider_item.get("models"))
        };
        for model_id in provider_models {
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
        "script_parsing" | "video_import_script_generation" | "scene_description_refinement" => {
            Some("text")
        }
        "character_portrait" | "frame_generation" => Some("image"),
        "video_generation" => Some("video"),
        _ => None,
    }
}

fn is_workflow_step(step_id: &str) -> bool {
    workflow_step_category(step_id).is_some()
}

fn is_cloud_model_options_step(step_id: &str) -> bool {
    matches!(step_id, "image_options" | "completion_notification")
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
        "video_import_script_generation" => Some("qwen3.6-plus"),
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
        "video_import_script_generation",
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
        "video_import_script_generation",
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
        "default-prompts/script_episode_plan.txt" => Some(include_str!(
            "../assets/default-prompts/script_episode_plan.txt"
        )),
        "default-prompts/script_parsing.txt" => {
            Some(include_str!("../assets/default-prompts/script_parsing.txt"))
        }
        "default-prompts/script_parsing_short_drama.txt" => Some(include_str!(
            "../assets/default-prompts/script_parsing_short_drama.txt"
        )),
        "default-prompts/script_parsing_episode_drama_context.txt" => Some(include_str!(
            "../assets/default-prompts/script_parsing_episode_drama_context.txt"
        )),
        "default-prompts/origin_explainer_planning.txt" => Some(include_str!(
            "../assets/default-prompts/origin_explainer_planning.txt"
        )),
        "default-prompts/video_import_script_generation.txt" => Some(include_str!(
            "../assets/default-prompts/video_import_script_generation.txt"
        )),
        "default-prompts/character_sheet.txt" => Some(include_str!(
            "../assets/default-prompts/character_sheet.txt"
        )),
        "default-prompts/character_regeneration.txt" => Some(include_str!(
            "../assets/default-prompts/character_regeneration.txt"
        )),
        "default-prompts/environment_reference_generation.txt" => Some(include_str!(
            "../assets/default-prompts/environment_reference_generation.txt"
        )),
        "default-prompts/prop_asset_generation.txt" => Some(include_str!(
            "../assets/default-prompts/prop_asset_generation.txt"
        )),
        "default-prompts/scene_description_refinement.txt" => Some(include_str!(
            "../assets/default-prompts/scene_description_refinement.txt"
        )),
        "default-prompts/scene_video_generation.txt" => Some(include_str!(
            "../assets/default-prompts/scene_video_generation.txt"
        )),
        "default-prompts/origin_explainer_video_generation.txt" => Some(include_str!(
            "../assets/default-prompts/origin_explainer_video_generation.txt"
        )),
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
                .or_else(|| {
                    obj.get("content")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
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

fn merge_prompt_templates_with_defaults(value: Value) -> Value {
    let defaults = default_prompt_templates();
    let Some(saved_items) = value.as_array() else {
        return defaults;
    };
    let Some(default_items) = defaults.as_array() else {
        return value;
    };

    let default_by_id = default_items
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(|id| (id, item)))
        .collect::<HashMap<_, _>>();
    let mut existing_ids = HashSet::<String>::new();
    let mut merged = Vec::new();
    for item in saved_items {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        existing_ids.insert(id.to_string());
        if item
            .get("isCustomized")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            merged.push(item.clone());
        } else if let Some(default_item) = default_by_id.get(id) {
            merged.push((*default_item).clone());
        } else {
            merged.push(item.clone());
        }
    }
    for item in default_items {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        if existing_ids.insert(id.to_string()) {
            merged.push(item.clone());
        }
    }
    Value::Array(merged)
}

fn get_prompt_templates_config(conn: &Connection) -> Result<Value, ApiError> {
    Ok(get_config_json(conn, PROMPT_TEMPLATES_KEY)?
        .map(merge_prompt_templates_with_defaults)
        .unwrap_or_else(default_prompt_templates))
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

fn deleted_project_tombstones(conn: &Connection) -> Result<HashSet<String>, ApiError> {
    let value = get_config_json(conn, CLOUD_DELETED_PROJECT_TOMBSTONES_KEY)?
        .unwrap_or_else(|| json!({ "ids": {} }));
    if let Some(items) = value.as_array() {
        return Ok(items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect());
    }
    Ok(value
        .get("ids")
        .and_then(Value::as_object)
        .map(|items| {
            items
                .keys()
                .filter(|id| !id.trim().is_empty())
                .cloned()
                .collect()
        })
        .unwrap_or_default())
}

fn is_deleted_project_tombstone(conn: &Connection, project_id: &str) -> Result<bool, ApiError> {
    if project_id.trim().is_empty() {
        return Ok(false);
    }
    Ok(deleted_project_tombstones(conn)?.contains(project_id))
}

fn remember_deleted_project_tombstone(conn: &Connection, project_id: &str) -> Result<(), ApiError> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Ok(());
    }

    let mut ids = get_config_json(conn, CLOUD_DELETED_PROJECT_TOMBSTONES_KEY)?
        .and_then(|value| value.get("ids").and_then(Value::as_object).cloned())
        .unwrap_or_default();
    ids.insert(project_id.to_string(), json!(now_iso()));
    set_config_json(
        conn,
        CLOUD_DELETED_PROJECT_TOMBSTONES_KEY,
        &json!({ "ids": ids }),
    )
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
    Some(merge_prompt_templates_with_defaults(templates))
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
        ("owner_user_id", "TEXT"),
        ("owner_account", "TEXT"),
        ("owner_display_name", "TEXT"),
    ] {
        ensure_column(conn, "projects", column, definition)?;
    }

    for (column, definition) in [
        ("episode_id", "TEXT"),
        ("episode_title", "TEXT"),
        ("episode_index", "INTEGER"),
        ("dramatic", "TEXT"),
        ("props", "TEXT"),
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
        ("parent_character_id", "TEXT"),
        ("variant_name", "TEXT"),
        ("traits", "TEXT"),
        ("background", "TEXT"),
        ("motivation", "TEXT"),
        ("speaking_style", "TEXT"),
        ("catchphrase", "TEXT"),
        ("voice_tone", "TEXT"),
        ("voice_asset", "TEXT"),
        ("ark_asset", "TEXT"),
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
        ("series_id", "TEXT"),
        ("episode_number", "INTEGER"),
        ("is_series_group", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        ensure_column(conn, "video_import_tasks", column, definition)?;
    }

    for (column, definition) in [
        ("request_json", "TEXT"),
        ("request_raw_json", "TEXT"),
        ("response_json", "TEXT"),
        ("response_raw_json", "TEXT"),
        ("media_refs_json", "TEXT"),
        ("error_json", "TEXT"),
        ("endpoint", "TEXT"),
        ("request_id", "TEXT"),
        ("project_id", "TEXT"),
        ("scene_id", "TEXT"),
        ("task_id", "TEXT"),
        ("cloud_payload_json", "TEXT"),
        ("cloud_sync_status", "TEXT NOT NULL DEFAULT 'legacy'"),
        ("cloud_sync_attempts", "INTEGER NOT NULL DEFAULT 0"),
        ("cloud_sync_error", "TEXT"),
        ("cloud_synced_at", "TEXT"),
        ("owner_account", "TEXT"),
        ("owner_display_name", "TEXT"),
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
        props TEXT,
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
        parent_character_id TEXT,
        variant_name TEXT,
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
        ark_asset TEXT,
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
        endpoint TEXT,
        request_id TEXT,
        project_id TEXT,
        scene_id TEXT,
        task_id TEXT,
        request_json TEXT,
        request_raw_json TEXT,
        response_json TEXT,
        response_raw_json TEXT,
        media_refs_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        request_id TEXT,
        method TEXT,
        path TEXT,
        status INTEGER,
        duration_ms INTEGER,
        metadata_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_import_tasks (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'upload',
        source_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        current_step TEXT NOT NULL DEFAULT 'created',
        progress INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        asr_provider TEXT NOT NULL DEFAULT 'bcut',
        script_model_id TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        series_id TEXT,
        episode_number INTEGER,
        is_series_group INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS video_import_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES video_import_tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        sha256 TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_import_step_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES video_import_tasks(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER,
        provider TEXT,
        external_task_id TEXT,
        error_message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS video_import_projects (
        import_id TEXT NOT NULL REFERENCES video_import_tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (import_id, project_id)
      );

      CREATE TABLE IF NOT EXISTS video_enhance_tasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        kind_label TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_video_url TEXT NOT NULL,
        source_object_key TEXT,
        source_deleted INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'processing',
        raw_status TEXT,
        result_video_url TEXT,
        saved_video_url TEXT,
        result_object_key TEXT,
        result_deleted INTEGER NOT NULL DEFAULT 0,
        request_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS image_enhance_tasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        kind_label TEXT NOT NULL,
        file_name TEXT NOT NULL,
        source_image_url TEXT NOT NULL,
        source_object_key TEXT,
        source_deleted INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'processing',
        raw_status TEXT,
        result_image_url TEXT,
        saved_image_url TEXT,
        result_object_key TEXT,
        result_deleted INTEGER NOT NULL DEFAULT 0,
        request_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS uploaded_media_cache (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        file_name TEXT,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        object_key TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        UNIQUE(category, sha256)
      );

      CREATE TABLE IF NOT EXISTS wx_channels_history (
        id TEXT PRIMARY KEY,
        share_url TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL DEFAULT '',
        author_icon TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        origin_video_url TEXT NOT NULL DEFAULT '',
        create_time INTEGER,
        downloaded_path TEXT,
        downloaded_filename TEXT,
        download_dir TEXT,
        size_bytes INTEGER,
        parsed_at TEXT NOT NULL,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS douyin_history (
        id TEXT PRIMARY KEY,
        aweme_id TEXT NOT NULL UNIQUE,
        real_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        downloaded_path TEXT,
        downloaded_filename TEXT,
        download_dir TEXT,
        size_bytes INTEGER,
        parsed_at TEXT NOT NULL,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL
      );
    ",
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    ensure_runtime_schema(&conn)?;
    conn.execute_batch(
        "
      CREATE INDEX IF NOT EXISTS idx_model_debug_logs_timestamp ON model_debug_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_model_debug_logs_cloud_sync
        ON model_debug_logs(cloud_sync_status, timestamp);
      CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_video_import_tasks_status ON video_import_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_video_import_tasks_created ON video_import_tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_video_import_tasks_updated ON video_import_tasks(updated_at);
      CREATE INDEX IF NOT EXISTS idx_video_import_tasks_series
        ON video_import_tasks(series_id) WHERE series_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_video_import_artifacts_task ON video_import_artifacts(task_id);
      CREATE INDEX IF NOT EXISTS idx_video_import_artifacts_kind ON video_import_artifacts(kind);
      CREATE INDEX IF NOT EXISTS idx_video_import_step_runs_task ON video_import_step_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_video_import_step_runs_step ON video_import_step_runs(step);
      CREATE INDEX IF NOT EXISTS idx_video_enhance_tasks_status ON video_enhance_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_video_enhance_tasks_created ON video_enhance_tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_image_enhance_tasks_status ON image_enhance_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_image_enhance_tasks_created ON image_enhance_tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_uploaded_media_cache_category_sha256
        ON uploaded_media_cache(category, sha256);
      CREATE INDEX IF NOT EXISTS idx_wx_channels_history_updated
        ON wx_channels_history(updated_at);
      CREATE INDEX IF NOT EXISTS idx_douyin_history_updated
        ON douyin_history(updated_at);
      -- 日志查询统一按 timestamp DESC 排序取 LIMIT，过滤走大小写无关 / 子串匹配，
      -- 规划器不会用到下面这些二级索引；清理掉以省去写入开销。
      DROP INDEX IF EXISTS idx_model_debug_logs_provider;
      DROP INDEX IF EXISTS idx_model_debug_logs_operation;
      DROP INDEX IF EXISTS idx_model_debug_logs_status;
      DROP INDEX IF EXISTS idx_model_debug_logs_request_id;
      DROP INDEX IF EXISTS idx_app_logs_level;
      DROP INDEX IF EXISTS idx_app_logs_source;
      DROP INDEX IF EXISTS idx_app_logs_category;
      DROP INDEX IF EXISTS idx_app_logs_request_id;
      DROP INDEX IF EXISTS idx_app_logs_status;
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
    match get_config_json(&conn, CLOUD_ADMIN_CONFIG_KEY)? {
        Some(config) => {
            let current_base_url = config
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .trim_end_matches('/');
            let default_base_url = default_cloud_admin_base_url();
            if should_use_default_cloud_admin_base_url(current_base_url)
                && current_base_url != default_base_url
            {
                set_config_json(
                    &conn,
                    CLOUD_ADMIN_CONFIG_KEY,
                    &json!({ "baseUrl": default_base_url }),
                )?;
                set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &json!({}))?;
            }
        }
        None => {
            set_config_json(
                &conn,
                CLOUD_ADMIN_CONFIG_KEY,
                &json!({ "baseUrl": default_cloud_admin_base_url() }),
            )?;
            set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &json!({}))?;
        }
    }
    if get_config_json(&conn, CLOUD_PROVIDER_CREDENTIALS_KEY)?.is_none() {
        set_config_json(&conn, CLOUD_PROVIDER_CREDENTIALS_KEY, &json!({}))?;
    }
    match get_config_json(&conn, PROMPT_TEMPLATES_KEY)? {
        Some(saved) => {
            if is_legacy_minimal_prompt_templates(&saved) {
                let migrated_templates = get_config_json(&conn, PROMPT_PROFILE_STATE_KEY)?
                    .as_ref()
                    .and_then(extract_templates_from_prompt_profile_state)
                    .unwrap_or_else(default_prompt_templates);
                set_config_json(&conn, PROMPT_TEMPLATES_KEY, &migrated_templates)?;
            } else {
                let merged_templates = merge_prompt_templates_with_defaults(saved.clone());
                if merged_templates != saved {
                    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &merged_templates)?;
                }
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
    Ok(())
}

pub async fn start_server(state: BackendState, host: &str, port: u16) -> Result<(), String> {
    set_global_db_path(state.db_path.clone());
    ensure_dirs(&state).map_err(|error| error.message.clone())?;
    init_database(&state).map_err(|error| error.message.clone())?;
    spawn_video_enhance_task_poller(state.clone());
    spawn_image_enhance_task_poller(state.clone());
    spawn_model_call_log_sync_poller();

    let observability_state = state.clone();
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
            get(api_custom_openai_get)
                .post(api_custom_openai_create)
                .put(api_custom_openai_put),
        )
        .route(
            "/api/models/custom-openai/{id}",
            put(api_custom_openai_provider_put).delete(api_custom_openai_provider_delete),
        )
        .route(
            "/api/models/custom-openai/sync",
            post(api_custom_openai_sync),
        )
        .route(
            "/api/models/custom-openai/{id}/sync",
            post(api_custom_openai_provider_sync),
        )
        .route("/api/model-providers", get(api_model_providers))
        .route("/api/model-providers/index", get(api_model_providers))
        .route(
            "/api/model-providers/config/export",
            get(api_model_providers_config_export),
        )
        .route(
            "/api/model-providers/config/download",
            get(api_model_providers_config_download),
        )
        .route(
            "/api/model-providers/config/import",
            post(api_model_providers_config_import),
        )
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
        .route(
            "/api/cloud/status",
            get(api_cloud_status).put(api_cloud_config_put),
        )
        .route("/api/cloud/login", post(api_cloud_login))
        .route("/api/cloud/logout", post(api_cloud_logout))
        .route("/api/cloud/bootstrap", post(api_cloud_bootstrap))
        .route("/api/cloud/heartbeat", post(api_cloud_heartbeat))
        .route("/api/cloud/update-check", post(api_cloud_update_check))
        .route("/api/script/episode-plan", post(api_script_episode_plan))
        .route("/api/script/parse", post(api_script_parse))
        .route("/api/script/parse-stream", post(api_script_parse_stream))
        .route("/api/script/export-docx", post(api_script_export_docx))
        .route(
            "/api/import/video/upload",
            post(api_video_import_upload)
                .layer(DefaultBodyLimit::max(VIDEO_IMPORT_UPLOAD_BODY_LIMIT_BYTES)),
        )
        .route(
            "/api/import/video/upload-series",
            post(api_video_import_upload_series),
        )
        .route(
            "/api/import/video/preview-series",
            post(api_video_import_preview_series),
        )
        .route("/api/import/video/tasks", get(api_video_import_tasks))
        .route("/api/import/video/tasks/{id}", get(api_video_import_task))
        .route(
            "/api/import/video/tasks/{id}/subtitle",
            put(api_video_import_subtitle_put),
        )
        .route(
            "/api/import/video/tasks/{id}/script",
            put(api_video_import_script_put),
        )
        .route(
            "/api/import/video/tasks/{id}/generate-script",
            post(api_video_import_generate_script),
        )
        .route(
            "/api/import/video/tasks/{id}/import",
            post(api_video_import_import_project),
        )
        .route(
            "/api/import/video/tasks/{id}/retry",
            post(api_video_import_retry),
        )
        .route(
            "/api/import/video/tasks/{id}/cancel",
            post(api_video_import_cancel),
        )
        .route(
            "/api/import/video/tasks/{id}",
            delete(api_video_import_delete),
        )
        .route(
            "/api/import/video/tasks/batch-delete",
            post(api_video_import_delete_batch),
        )
        .route("/api/import/video/events", get(api_video_import_events))
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
            post(api_asset_upload_image)
                .layer(DefaultBodyLimit::max(ASSET_IMAGE_UPLOAD_BODY_LIMIT_BYTES)),
        )
        .route(
            "/api/ark-assets/virtual/groups",
            get(api_ark_virtual_asset_groups_list).post(api_ark_virtual_asset_group_create),
        )
        .route(
            "/api/ark-assets/virtual/groups/{groupId}",
            put(api_ark_virtual_asset_group_update).delete(api_ark_virtual_asset_group_delete),
        )
        .route(
            "/api/ark-assets/virtual/assets/upload",
            post(api_ark_virtual_asset_upload)
                .layer(DefaultBodyLimit::max(ASSET_IMAGE_UPLOAD_BODY_LIMIT_BYTES)),
        )
        .route(
            "/api/ark-assets/virtual/assets",
            post(api_ark_virtual_assets_list),
        )
        .route(
            "/api/ark-assets/virtual/assets/{assetId}",
            get(api_ark_virtual_asset_get)
                .put(api_ark_virtual_asset_update)
                .delete(api_ark_virtual_asset_delete),
        )
        .route(
            "/api/ark-assets/virtual/assets/{assetId}/poll",
            post(api_ark_virtual_asset_poll),
        )
        .route("/api/image/file/{*filename}", get(api_image_file))
        .route("/api/image/proxy", get(api_image_proxy))
        .route("/api/tos/files", get(api_tos_files))
        .route(
            "/api/tos/config",
            get(api_tos_config_get).put(api_tos_config_put),
        )
        .route("/api/tos/config/export", get(api_tos_config_export))
        .route("/api/tos/config/download", get(api_tos_config_download))
        .route("/api/tos/config/import", post(api_tos_config_import))
        .route(
            "/api/tools/short-video/parse",
            post(api_tools_short_video_parse),
        )
        .route(
            "/api/tools/short-video/download",
            post(api_tools_short_video_download),
        )
        .route(
            "/api/tools/short-video/preview",
            get(api_tools_short_video_preview),
        )
        .route(
            "/api/tools/short-video/history",
            get(api_tools_short_video_history_get),
        )
        .route(
            "/api/tools/short-video/history/{platform}/{id}",
            delete(api_tools_short_video_history_delete),
        )
        .route(
            "/api/tools/video-enhance",
            post(api_tools_video_enhance_submit),
        )
        .route(
            "/api/tools/video-enhance/tasks",
            get(api_tools_video_enhance_tasks),
        )
        .route(
            "/api/tools/video-enhance/upload-source",
            post(api_tools_video_enhance_upload_source)
                .layer(DefaultBodyLimit::max(VIDEO_ENHANCE_UPLOAD_LIMIT_BYTES)),
        )
        .route(
            "/api/tools/video-enhance/status/{id}",
            get(api_tools_video_enhance_status),
        )
        .route(
            "/api/tools/video-enhance/save",
            post(api_tools_video_enhance_save),
        )
        .route(
            "/api/tools/video-enhance/tasks/{id}/{asset}",
            delete(api_tools_video_enhance_delete_asset),
        )
        .route(
            "/api/tools/local-video-enhance",
            post(api_tools_local_video_enhance)
                .layer(DefaultBodyLimit::max(VIDEO_ENHANCE_UPLOAD_LIMIT_BYTES)),
        )
        .route(
            "/api/tools/image-enhance",
            post(api_tools_image_enhance_submit),
        )
        .route(
            "/api/tools/image-enhance/tasks",
            get(api_tools_image_enhance_tasks),
        )
        .route(
            "/api/tools/image-enhance/upload-source",
            post(api_tools_image_enhance_upload_source)
                .layer(DefaultBodyLimit::max(IMAGE_ENHANCE_UPLOAD_LIMIT_BYTES)),
        )
        .route(
            "/api/tools/image-enhance/status/{id}",
            get(api_tools_image_enhance_status),
        )
        .route(
            "/api/tools/image-enhance/save",
            post(api_tools_image_enhance_save),
        )
        .route(
            "/api/tools/image-enhance/tasks/{id}/{asset}",
            delete(api_tools_image_enhance_delete_asset),
        )
        .route(
            "/api/tools/local-image-enhance",
            post(api_tools_local_image_enhance)
                .layer(DefaultBodyLimit::max(IMAGE_ENHANCE_UPLOAD_LIMIT_BYTES)),
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
            "/api/debug/app-logs",
            get(api_app_logs_get)
                .post(api_app_logs_post)
                .delete(api_app_logs_delete),
        )
        .route(
            "/api/debug/model-logs",
            get(api_debug_logs_get).delete(api_debug_logs_delete),
        )
        .route("/api/{*path}", any(api_not_implemented))
        .route("/", get(frontend_index))
        .route("/{*path}", get(frontend_assets))
        .with_state(state)
        .layer(middleware::from_fn_with_state(
            observability_state,
            request_observability_middleware,
        ));

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
        "SELECT id, name, description, script_parse_mode, style_id, aspect_ratio, status, created_at, updated_at, owner_user_id, owner_account, owner_display_name FROM projects{} ORDER BY {}",
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
              "updatedAt": row.get::<_, String>(8)?,
              "ownerUserId": row.get::<_, Option<String>>(9)?,
              "ownerAccount": row.get::<_, Option<String>>(10)?,
              "ownerDisplayName": row.get::<_, Option<String>>(11)?
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
    if !matches!(
        script_parse_mode.as_str(),
        "premium_drama" | "short_drama" | "origin_explainer"
    ) {
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

    drop(conn);
    if let Err(error) = cloud_sync_project_by_id(&state, &id).await {
        eprintln!("[CloudSync] project create sync failed: {}", error.message);
    }

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
    remember_deleted_project_tombstone(&conn, id.as_str())?;

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
                        dramatic, setting, characters, props, duration, narration, shot_type, camera_movement,
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
                  "props": parse(row.get(10)?),
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
            if video_url.as_deref().map(str::trim).unwrap_or("").is_empty() {
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
            "SELECT id, parent_character_id, variant_name, name, role, appearance, personality, traits, background, motivation,
                    speaking_style, catchphrase, voice_tone, voice_asset, ark_asset, age, gender, base_image, expressions, views
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
            let base_image: Option<String> = row.get(17)?;
            Ok(json!({
              "id": row.get::<_, String>(0)?,
              "parentCharacterId": row.get::<_, Option<String>>(1)?,
              "variantName": row.get::<_, Option<String>>(2)?,
              "name": row.get::<_, String>(3)?,
              "role": row.get::<_, Option<String>>(4)?,
              "appearance": row.get::<_, String>(5)?,
              "personality": row.get::<_, Option<String>>(6)?,
              "traits": parse(row.get(7)?),
              "background": row.get::<_, Option<String>>(8)?,
              "motivation": row.get::<_, Option<String>>(9)?,
              "speakingStyle": row.get::<_, Option<String>>(10)?,
              "catchphrase": row.get::<_, Option<String>>(11)?,
              "voiceTone": row.get::<_, Option<String>>(12)?,
              "voiceAsset": parse(row.get(13)?),
              "arkAsset": parse(row.get(14)?),
              "age": row.get::<_, Option<i64>>(15)?,
              "gender": row.get::<_, Option<String>>(16)?,
              "imageUrl": base_image,
              "baseImage": base_image,
              "expressions": parse(row.get(18)?),
              "views": parse(row.get(19)?)
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

    if let Some(props) = scene.get("props").filter(|value| !value.is_null()) {
        let items = props
            .as_array()
            .ok_or_else(|| validation_error(format!("{path}.props"), "Expected array"))?;
        for (index, item) in items.iter().enumerate() {
            let item_path = format!("{path}.props.{index}");
            required_string(item, "name", &item_path)?;
            optional_string(item, "description", &item_path)?;
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

fn validate_ark_virtual_asset(
    value: Option<&Value>,
    path: &str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value
        .as_object()
        .ok_or_else(|| validation_error(path, "Expected object"))?;
    for key in [
        "provider",
        "libraryType",
        "projectName",
        "groupId",
        "assetId",
        "assetType",
        "sourceUrl",
        "name",
        "status",
        "errorMessage",
        "updatedAt",
    ] {
        if let Some(value) = object.get(key).filter(|value| !value.is_null()) {
            if !value.is_string() {
                return Err(validation_error(format!("{path}.{key}"), "Expected string"));
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
        Some("origin_explainer") => "origin_explainer",
        _ => "short_drama",
    }
}

#[derive(Default)]
struct ProjectPutOptions {
    skip_cloud_sync: bool,
    preserve_updated_at: Option<String>,
}

async fn api_project_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    api_project_put_inner(
        Path(id),
        State(state),
        Json(body),
        ProjectPutOptions::default(),
    )
    .await
}

async fn api_project_put_inner(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
    options: ProjectPutOptions,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let now = now_iso();
    let save_updated_at = options
        .preserve_updated_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(now.as_str())
        .to_string();

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
    if !matches!(
        script_parse_mode.as_str(),
        "premium_drama" | "short_drama" | "origin_explainer"
    ) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "scriptParseMode 无效",
        ));
    }

    conn.execute(
        "UPDATE projects SET name = ?1, description = ?2, status = ?3, style_id = ?4, aspect_ratio = ?5, script_parse_mode = ?6, updated_at = ?7 WHERE id = ?8",
        params![name, description, status, style_id, aspect_ratio, script_parse_mode, save_updated_at, id],
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
        params![script_payload, save_updated_at, script_id],
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
                props: encode("props"),
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
                  dramatic, setting, characters, props, duration, narration, shot_type, camera_movement,
                  camera_note, environment_capture_mode, transition_in, transition_out, transition_duration,
                  first_frame, last_frame, video_url, status, created_at, updated_at
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                  ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                  ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27
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
                    scene_row.props,
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
                    save_updated_at,
                    save_updated_at
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }

        conn.execute(
            "UPDATE scripts SET total_duration = ?1, updated_at = ?2 WHERE id = ?3",
            params![total_duration, save_updated_at, script_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }

    if let Some(characters) = body.get("characters").and_then(Value::as_array) {
        let mut existing_character_by_id: HashMap<String, (Option<String>, Option<String>)> =
            HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, voice_asset, ark_asset FROM characters WHERE project_id = ?1")
                .map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            let rows = stmt
                .query_map(params![id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            for row in rows {
                let (character_id, voice_asset, ark_asset) = row.map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
                existing_character_by_id.insert(character_id, (voice_asset, ark_asset));
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
                    .and_then(|(raw, _)| raw.as_ref())
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .and_then(|value| {
                        validate_voice_asset(Some(&value), &format!("{path}.voiceAsset"))
                            .ok()
                            .flatten()
                    })
            };
            let ark_asset = if character.get("arkAsset").is_some() {
                validate_ark_virtual_asset(character.get("arkAsset"), &format!("{path}.arkAsset"))?
            } else {
                existing_character_by_id
                    .get(&character_id)
                    .and_then(|(_, raw)| raw.as_ref())
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .and_then(|value| {
                        validate_ark_virtual_asset(Some(&value), &format!("{path}.arkAsset"))
                            .ok()
                            .flatten()
                    })
            };

            character_rows.push(ProjectCharacterRow {
                id: character_id,
                parent_character_id: optional_string(character, "parentCharacterId", &path)?
                    .map(|value| normalize_scoped_id("char", &id, value)),
                variant_name: optional_string(character, "variantName", &path)?.map(str::to_string),
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
                ark_asset,
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
                  id, project_id, parent_character_id, variant_name, name, role, appearance, personality, traits, background, motivation, speaking_style,
                  catchphrase, voice_tone, voice_asset, ark_asset, age, gender, base_image, expressions, views, created_at, updated_at
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
                )",
                params![
                    character_row.id,
                    id,
                    character_row.parent_character_id,
                    character_row.variant_name,
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
                    character_row.ark_asset,
                    character_row.age,
                    character_row.gender,
                    character_row.base_image,
                    character_row.expressions,
                    character_row.views,
                    save_updated_at,
                    save_updated_at
                ],
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
    }

    drop(conn);
    let mut cloud_sync = json!({
      "status": if options.skip_cloud_sync { "skipped" } else { "disabled" }
    });
    if !options.skip_cloud_sync {
        match cloud_sync_project_by_id(&state, &id).await {
            Ok(()) => {
                cloud_sync = json!({ "status": "synced" });
            }
            Err(error) => {
                eprintln!("[CloudSync] project sync failed: {}", error.message);
                cloud_sync = json!({
                  "status": "error",
                  "message": error.message
                });
            }
        }
    }

    Ok(Json(json!({
      "success": true,
      "cloudSync": cloud_sync
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
    let model_options = workflow_model_options(&conn)?;
    drop(conn);
    if let Err(error) = cloud_sync_model_preferences(&state).await {
        eprintln!(
            "[CloudSync] model preferences sync failed: {}",
            error.message
        );
    }
    Ok(Json(json!({
      "success": true,
      "data": {
        "step": response_step,
        "modelId": response_model_id,
        "updated": response_models,
        "currentSelections": current_selections,
        "modelOptions": model_options
      }
    })))
}

const SUPPORTED_MODEL_PROVIDERS: [&str; 6] = [
    "qwen",
    "volcengine",
    "kling",
    "gemini",
    "deepseek",
    "custom_openai",
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
    let custom_openai_raw = get_config_json(conn, CUSTOM_OPENAI_CONFIG_KEY)
        .ok()
        .flatten()
        .unwrap_or_else(default_custom_openai_config);
    let custom_openai =
        custom_openai_config_from_entries(custom_openai_provider_entries(&custom_openai_raw));
    if let Some(obj) = creds.as_object_mut() {
        obj.insert("custom_openai".to_string(), custom_openai);
    }
    overlay_cloud_provider_creds(conn, &mut creds);
    creds
}

/// 把单个 custom_openai 配置包装成合并凭证结构，供共享供应商助手读取。
fn wrap_custom_openai_creds(custom_openai: &Value) -> Value {
    json!({ "custom_openai": custom_openai_config_from_entries(vec![custom_openai.clone()]) })
}

/// 供无 `&Connection` 的深层助手按需加载合并凭证（依赖全局 DB 路径）。
fn current_provider_creds() -> Value {
    config_connection()
        .map(|conn| load_provider_creds(&conn))
        .unwrap_or_else(default_provider_credentials)
}

/// 读取某供应商凭证的指定字段（去空白、过滤空串）。
fn provider_credential_field(creds: &Value, provider: &str, field: &str) -> Option<String> {
    if provider == "custom_openai" {
        if let Some(value) = creds
            .get(provider)
            .and_then(|node| node.get(field))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        {
            return Some(value);
        }
        return creds
            .get("custom_openai")
            .and_then(|node| {
                custom_openai_provider_entries(node)
                    .into_iter()
                    .find(custom_openai_entry_is_configured)
            })
            .and_then(|entry| {
                entry
                    .get(field)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
    }

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

fn sanitize_custom_openai_provider_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 {
        return None;
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn custom_openai_provider_entry_from_value(input: &Value, fallback_id: &str) -> Value {
    let id = input
        .get("id")
        .and_then(Value::as_str)
        .and_then(sanitize_custom_openai_provider_id)
        .unwrap_or_else(|| fallback_id.to_string());
    let display_name = input
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("自定义 OpenAI")
        .chars()
        .take(60)
        .collect::<String>();
    json!({
      "id": id,
      "enabled": input.get("enabled").and_then(Value::as_bool).unwrap_or(false),
      "displayName": display_name,
      "baseUrl": input.get("baseUrl").and_then(Value::as_str).unwrap_or("").trim(),
      "apiKey": input.get("apiKey").and_then(Value::as_str).unwrap_or(""),
      "textModels": json_string_list(input.get("textModels")),
      "availableTextModels": json_string_list(input.get("availableTextModels")),
      "modelsSyncedAt": input.get("modelsSyncedAt").and_then(Value::as_str).map(|value| json!(value)).unwrap_or(Value::Null),
      "modelsSyncError": input.get("modelsSyncError").and_then(Value::as_str).map(|value| json!(value)).unwrap_or(Value::Null)
    })
}

fn custom_openai_provider_entries(config: &Value) -> Vec<Value> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    if let Some(items) = config.get("providers").and_then(Value::as_array) {
        for (index, item) in items.iter().enumerate() {
            if !item.is_object() {
                continue;
            }
            let fallback_id = format!("provider_{}", index + 1);
            let mut entry = custom_openai_provider_entry_from_value(item, &fallback_id);
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or(fallback_id.as_str())
                .to_string();
            let unique_id = if seen.insert(id.clone()) {
                id
            } else {
                let generated = format!("{}_{}", id, index + 1);
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("id".to_string(), json!(generated.clone()));
                }
                seen.insert(generated.clone());
                generated
            };
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("id".to_string(), json!(unique_id));
            }
            entries.push(entry);
        }
    } else if config.is_object() {
        entries.push(custom_openai_provider_entry_from_value(config, "default"));
    }

    if entries.is_empty() {
        entries.push(default_custom_openai_provider_entry());
    }
    entries
}

fn custom_openai_config_from_entries(entries: Vec<Value>) -> Value {
    json!({ "providers": entries })
}

fn custom_openai_public_entry(entry: &Value) -> Value {
    let has_key = entry
        .get("apiKey")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let mut public_entry = entry.clone();
    if let Some(obj) = public_entry.as_object_mut() {
        obj.remove("apiKey");
        obj.insert("hasApiKey".to_string(), json!(has_key));
    }
    public_entry
}

fn custom_openai_public_config(config: &Value) -> Value {
    json!({
      "providers": custom_openai_provider_entries(config)
        .iter()
        .map(custom_openai_public_entry)
        .collect::<Vec<_>>()
    })
}

fn custom_openai_entry_is_configured(entry: &Value) -> bool {
    entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && entry
            .get("apiKey")
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        && entry
            .get("baseUrl")
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
}

fn custom_openai_entry_has_model(entry: &Value, model_id: &str) -> bool {
    if !custom_openai_entry_is_configured(entry) {
        return false;
    }
    let target = model_id.trim();
    if target.is_empty() {
        return false;
    }
    ["textModels", "availableTextModels"]
        .iter()
        .filter_map(|key| entry.get(*key))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_str)
        .any(|candidate| candidate.trim() == target)
}

fn custom_openai_entry_for_model(model_id: &str, creds: &Value) -> Option<Value> {
    let custom = creds.get("custom_openai")?;
    let entries = custom_openai_provider_entries(custom);
    entries
        .iter()
        .find(|entry| custom_openai_entry_has_model(entry, model_id))
        .cloned()
        .or_else(|| {
            entries
                .into_iter()
                .find(|entry| custom_openai_entry_is_configured(entry))
        })
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

fn settings_import_payload(body: &Value) -> &Value {
    body.get("payload").unwrap_or(body)
}

fn settings_import_section<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| payload.get(*key))
}

fn settings_object_section<'a>(
    value: &'a Value,
    path: &str,
) -> Result<&'a serde_json::Map<String, Value>, ApiError> {
    value
        .as_object()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, format!("{path} 必须是对象")))
}

fn settings_optional_object_field<'a>(
    value: &'a Value,
    key: &str,
    path: &str,
) -> Result<Option<&'a Value>, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(item) if item.is_object() => Ok(Some(item)),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{path}.{key} 必须是对象"),
        )),
    }
}

fn settings_string_field(
    value: &Value,
    key: &str,
    path: &str,
    max_chars: usize,
) -> Result<String, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim().to_string();
            if trimmed.chars().count() > max_chars {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("{path}.{key} 最多 {max_chars} 个字符"),
                ));
            }
            Ok(trimmed)
        }
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{path}.{key} 必须是字符串"),
        )),
    }
}

fn settings_nullable_string_field(
    value: &Value,
    key: &str,
    path: &str,
    max_chars: usize,
) -> Result<Value, ApiError> {
    let text = settings_string_field(value, key, path, max_chars)?;
    if text.is_empty() {
        Ok(Value::Null)
    } else {
        Ok(json!(text))
    }
}

fn settings_bool_field(
    value: &Value,
    key: &str,
    path: &str,
    fallback: bool,
) -> Result<bool, ApiError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(fallback),
        Some(Value::Bool(raw)) => Ok(*raw),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{path}.{key} 必须是布尔值"),
        )),
    }
}

fn settings_string_list_field(
    value: &Value,
    key: &str,
    path: &str,
    max_items: usize,
    max_chars: usize,
) -> Result<Vec<String>, ApiError> {
    let Some(raw_items) = value.get(key) else {
        return Ok(Vec::new());
    };
    if raw_items.is_null() {
        return Ok(Vec::new());
    }
    let items = raw_items.as_array().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{path}.{key} 必须是字符串数组"),
        )
    })?;
    if items.len() > max_items {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{path}.{key} 最多 {max_items} 项"),
        ));
    }

    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let Some(raw) = item.as_str() else {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("{path}.{key}.{index} 必须是字符串"),
            ));
        };
        let normalized = raw.trim();
        if normalized.is_empty() {
            continue;
        }
        if normalized.chars().count() > max_chars {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("{path}.{key}.{index} 最多 {max_chars} 个字符"),
            ));
        }
        if seen.insert(normalized.to_string()) {
            output.push(normalized.to_string());
        }
    }

    Ok(output)
}

fn settings_has_any_key(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| keys.iter().any(|key| object.contains_key(*key)))
}

fn settings_provider_entries_have_any_key(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        SUPPORTED_MODEL_PROVIDERS.iter().any(|provider| {
            object
                .get(*provider)
                .and_then(Value::as_object)
                .is_some_and(|entry| keys.iter().any(|key| entry.contains_key(*key)))
        })
    })
}

fn settings_export_file_name(kind: &str) -> String {
    format!(
        "playlet-{}-{}.json",
        kind,
        Utc::now().format("%Y%m%d-%H%M%S")
    )
}

fn settings_json_attachment(file_name: &str, payload: &Value) -> Result<Response, ApiError> {
    let bytes = serde_json::to_vec_pretty(payload)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json; charset=utf-8"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file_name))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        bytes,
    )
        .into_response())
}

fn settings_config_encryption_key() -> Result<LessSafeKey, ApiError> {
    let digest = Sha256::digest(SETTINGS_CONFIG_ENCRYPTION_CONTEXT);
    let unbound = UnboundKey::new(&AES_256_GCM, digest.as_slice())
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "初始化配置导出加密失败"))?;
    Ok(LessSafeKey::new(unbound))
}

fn encrypt_settings_config_payload(payload: &Value) -> Result<Value, ApiError> {
    let mut bytes = serde_json::to_vec(payload)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut nonce_bytes = [0u8; SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN];
    SystemRandom::new().fill(&mut nonce_bytes).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "生成配置导出加密随机数失败",
        )
    })?;

    let key = settings_config_encryption_key()?;
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce_bytes),
        Aad::from(SETTINGS_CONFIG_ENCRYPTION_AAD),
        &mut bytes,
    )
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "加密配置导出失败"))?;

    let mut payload_bytes = Vec::with_capacity(nonce_bytes.len() + bytes.len());
    payload_bytes.extend_from_slice(&nonce_bytes);
    payload_bytes.extend_from_slice(&bytes);

    Ok(json!({
      "type": SETTINGS_CONFIG_ENCRYPTED_TYPE,
      "version": SETTINGS_CONFIG_EXPORT_VERSION,
      "exportedAt": now_iso(),
      "payload": BASE64_STANDARD.encode(payload_bytes)
    }))
}

fn decrypt_settings_config_payload(payload: &Value) -> Result<Option<Value>, ApiError> {
    if payload.get("type").and_then(Value::as_str) != Some(SETTINGS_CONFIG_ENCRYPTED_TYPE) {
        return Ok(None);
    }

    let encoded = payload
        .get("payload")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "加密配置文件缺少 payload"))?;
    let raw = BASE64_STANDARD
        .decode(normalize_base64_payload(encoded))
        .map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "加密配置文件 payload 不是有效 Base64",
            )
        })?;
    if raw.len() <= SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "加密配置文件 payload 不完整",
        ));
    }

    let mut nonce_bytes = [0u8; SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN];
    nonce_bytes.copy_from_slice(&raw[..SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN]);
    let mut ciphertext = raw[SETTINGS_CONFIG_ENCRYPTION_NONCE_LEN..].to_vec();
    let key = settings_config_encryption_key()?;
    let plaintext = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(SETTINGS_CONFIG_ENCRYPTION_AAD),
            &mut ciphertext,
        )
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "配置文件解密失败"))?;

    let value = serde_json::from_slice::<Value>(plaintext)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "配置文件内容无效"))?;
    Ok(Some(value))
}

fn settings_import_payload_owned(body: &Value) -> Result<Value, ApiError> {
    let payload = settings_import_payload(body);
    match decrypt_settings_config_payload(payload)? {
        Some(value) => Ok(value),
        None => Ok(payload.clone()),
    }
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

fn normalize_imported_api_key_provider_credentials(
    source: Option<&Value>,
    provider: &str,
) -> Result<Value, ApiError> {
    let path = format!("providerCredentials.{provider}");
    let api_key = match source {
        Some(value) => {
            settings_string_field(value, "apiKey", &path, SETTINGS_CONFIG_TEXT_MAX_CHARS)?
        }
        None => String::new(),
    };
    let base_url = match source {
        Some(value) => settings_string_field(value, "baseUrl", &path, 2048)?,
        None => String::new(),
    };
    let mediakit_api_key = if provider == "volcengine" {
        match source {
            Some(value) => settings_string_field(
                value,
                "mediakitApiKey",
                &path,
                SETTINGS_CONFIG_TEXT_MAX_CHARS,
            )?,
            None => String::new(),
        }
    } else {
        String::new()
    };
    Ok(json!({
      "apiKey": api_key,
      "mediakitApiKey": mediakit_api_key,
      "baseUrl": base_url
    }))
}

fn normalize_imported_kling_credentials(source: Option<&Value>) -> Result<Value, ApiError> {
    let path = "providerCredentials.kling";
    let access_key = match source {
        Some(value) => {
            settings_string_field(value, "accessKey", path, SETTINGS_CONFIG_TEXT_MAX_CHARS)?
        }
        None => String::new(),
    };
    let secret_key = match source {
        Some(value) => {
            settings_string_field(value, "secretKey", path, SETTINGS_CONFIG_TEXT_MAX_CHARS)?
        }
        None => String::new(),
    };
    let base_url = match source {
        Some(value) => settings_string_field(value, "baseUrl", path, 2048)?,
        None => String::new(),
    };
    Ok(json!({
      "accessKey": access_key,
      "secretKey": secret_key,
      "baseUrl": base_url
    }))
}

fn normalize_imported_provider_credentials(input: &Value) -> Result<Value, ApiError> {
    settings_object_section(input, "providerCredentials")?;

    let gemini = settings_optional_object_field(input, "gemini", "providerCredentials")?;
    let qwen = settings_optional_object_field(input, "qwen", "providerCredentials")?;
    let volcengine = settings_optional_object_field(input, "volcengine", "providerCredentials")?;
    let deepseek = settings_optional_object_field(input, "deepseek", "providerCredentials")?;
    let kling = settings_optional_object_field(input, "kling", "providerCredentials")?;

    Ok(json!({
      "gemini": normalize_imported_api_key_provider_credentials(gemini, "gemini")?,
      "qwen": normalize_imported_api_key_provider_credentials(qwen, "qwen")?,
      "volcengine": normalize_imported_api_key_provider_credentials(volcengine, "volcengine")?,
      "deepseek": normalize_imported_api_key_provider_credentials(deepseek, "deepseek")?,
      "kling": normalize_imported_kling_credentials(kling)?
    }))
}

fn normalize_imported_custom_openai_config(input: &Value) -> Result<Value, ApiError> {
    settings_object_section(input, "customOpenaiProvider")?;
    if let Some(items) = input.get("providers") {
        let providers = items.as_array().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "customOpenaiProvider.providers 必须是数组",
            )
        })?;
        if providers.len() > 20 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "customOpenaiProvider.providers 最多 20 项",
            ));
        }
        let mut output = Vec::new();
        let mut seen = HashSet::new();
        for (index, provider) in providers.iter().enumerate() {
            let path = format!("customOpenaiProvider.providers.{index}");
            settings_object_section(provider, &path)?;
            let raw_id = provider
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or(if index == 0 { "default" } else { "" });
            let id = sanitize_custom_openai_provider_id(raw_id)
                .unwrap_or_else(|| format!("provider_{}", index + 1));
            if !seen.insert(id.clone()) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("{path}.id 重复"),
                ));
            }
            let display_name = match provider.get("displayName") {
                None | Some(Value::Null) => "自定义 OpenAI".to_string(),
                Some(Value::String(raw)) => {
                    let trimmed = raw.trim();
                    if trimmed.is_empty() {
                        return Err(ApiError::new(
                            StatusCode::BAD_REQUEST,
                            format!("{path}.displayName 不能为空"),
                        ));
                    }
                    if trimmed.chars().count() > 60 {
                        return Err(ApiError::new(
                            StatusCode::BAD_REQUEST,
                            format!("{path}.displayName 不能超过 60 个字符"),
                        ));
                    }
                    trimmed.to_string()
                }
                _ => {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        format!("{path}.displayName 必须是字符串"),
                    ))
                }
            };
            output.push(json!({
              "id": id,
              "enabled": settings_bool_field(provider, "enabled", &path, false)?,
              "displayName": display_name,
              "baseUrl": settings_string_field(provider, "baseUrl", &path, 2048)?,
              "apiKey": settings_string_field(
                provider,
                "apiKey",
                &path,
                SETTINGS_CONFIG_TEXT_MAX_CHARS,
              )?,
              "textModels": settings_string_list_field(provider, "textModels", &path, 1000, 512)?,
              "availableTextModels": settings_string_list_field(
                provider,
                "availableTextModels",
                &path,
                2000,
                512,
              )?,
              "modelsSyncedAt": settings_nullable_string_field(provider, "modelsSyncedAt", &path, 128)?,
              "modelsSyncError": settings_nullable_string_field(provider, "modelsSyncError", &path, 2048)?
            }));
        }
        return Ok(custom_openai_config_from_entries(output));
    }

    let enabled = settings_bool_field(input, "enabled", "customOpenaiProvider", false)?;
    let display_name = match input.get("displayName") {
        None | Some(Value::Null) => "自定义 OpenAI".to_string(),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "customOpenaiProvider.displayName 不能为空",
                ));
            }
            if trimmed.chars().count() > 60 {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "customOpenaiProvider.displayName 不能超过 60 个字符",
                ));
            }
            trimmed.to_string()
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "customOpenaiProvider.displayName 必须是字符串",
            ))
        }
    };

    Ok(custom_openai_config_from_entries(vec![json!({
      "id": "default",
      "enabled": enabled,
      "displayName": display_name,
      "baseUrl": settings_string_field(input, "baseUrl", "customOpenaiProvider", 2048)?,
      "apiKey": settings_string_field(
        input,
        "apiKey",
        "customOpenaiProvider",
        SETTINGS_CONFIG_TEXT_MAX_CHARS,
      )?,
      "textModels": settings_string_list_field(
        input,
        "textModels",
        "customOpenaiProvider",
        1000,
        512,
      )?,
      "availableTextModels": settings_string_list_field(
        input,
        "availableTextModels",
        "customOpenaiProvider",
        2000,
        512,
      )?,
      "modelsSyncedAt": settings_nullable_string_field(
        input,
        "modelsSyncedAt",
        "customOpenaiProvider",
        128,
      )?,
      "modelsSyncError": settings_nullable_string_field(
        input,
        "modelsSyncError",
        "customOpenaiProvider",
        2048,
      )?
    })]))
}

fn normalize_imported_provider_model_catalog(input: &Value) -> Result<Value, ApiError> {
    settings_object_section(input, "providerModelCatalog")?;
    let mut catalog = serde_json::Map::new();

    for provider in SUPPORTED_MODEL_PROVIDERS {
        let Some(entry) = settings_optional_object_field(input, provider, "providerModelCatalog")?
        else {
            continue;
        };
        let models = settings_string_list_field(
            entry,
            "models",
            &format!("providerModelCatalog.{provider}"),
            2000,
            512,
        )?;
        let available_models = settings_string_list_field(
            entry,
            "availableModels",
            &format!("providerModelCatalog.{provider}"),
            3000,
            512,
        )?;
        let synced_at = settings_nullable_string_field(
            entry,
            "syncedAt",
            &format!("providerModelCatalog.{provider}"),
            128,
        )?;
        let sync_error = settings_nullable_string_field(
            entry,
            "syncError",
            &format!("providerModelCatalog.{provider}"),
            2048,
        )?;

        catalog.insert(
            provider.to_string(),
            json!({
              "models": models,
              "availableModels": available_models,
              "syncedAt": synced_at,
              "syncError": sync_error
            }),
        );
    }

    Ok(Value::Object(catalog))
}

fn normalize_imported_tos_config(input: &Value) -> Result<Value, ApiError> {
    settings_object_section(input, "tosStorageConfig")?;
    Ok(json!({
      "enabled": settings_bool_field(input, "enabled", "tosStorageConfig", false)?,
      "accessKeyId": settings_string_field(
        input,
        "accessKeyId",
        "tosStorageConfig",
        SETTINGS_CONFIG_TEXT_MAX_CHARS,
      )?,
      "secretKey": settings_string_field(
        input,
        "secretKey",
        "tosStorageConfig",
        SETTINGS_CONFIG_TEXT_MAX_CHARS,
      )?,
      "securityToken": settings_string_field(
        input,
        "securityToken",
        "tosStorageConfig",
        SETTINGS_CONFIG_TEXT_MAX_CHARS,
      )?,
      "region": settings_string_field(input, "region", "tosStorageConfig", 256)?,
      "endpoint": settings_string_field(input, "endpoint", "tosStorageConfig", 2048)?,
      "bucket": settings_string_field(input, "bucket", "tosStorageConfig", 512)?,
      "keyPrefix": settings_string_field(input, "keyPrefix", "tosStorageConfig", 2048)?,
      "publicBaseUrl": settings_string_field(input, "publicBaseUrl", "tosStorageConfig", 2048)?,
      "isCustomDomain": settings_bool_field(input, "isCustomDomain", "tosStorageConfig", false)?
    }))
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
    let configured = provider_credential_field(creds, provider, "baseUrl")
        .and_then(|value| normalize_provider_base_url(&value));
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

fn provider_sync_mediakit_api_key(creds: &Value) -> Option<String> {
    provider_credential_field(creds, "volcengine", "mediakitApiKey")
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
    let is_timeout_status = matches!(
        status,
        reqwest::StatusCode::REQUEST_TIMEOUT | reqwest::StatusCode::GATEWAY_TIMEOUT
    );
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
            if is_timeout_status || text.to_ascii_lowercase().contains("stream disconnected") {
                return format!("{}: 模型服务响应超时或流式响应提前断开 ({})", status, text);
            }
            return format!("{}: {}", status, text);
        }
    }

    let snippet = truncate_for_error(body_text, 240);
    if is_timeout_status || snippet.to_ascii_lowercase().contains("stream disconnected") {
        if snippet.is_empty() {
            return format!("{}: 模型服务响应超时或流式响应提前断开", status);
        }
        return format!(
            "{}: 模型服务响应超时或流式响应提前断开 ({})",
            status, snippet
        );
    }
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
    let base_url =
        provider_sync_base_url(provider, creds).ok_or_else(|| "未配置 Base URL".to_string())?;
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
        "custom_openai" => creds.get("custom_openai").is_some_and(|node| {
            custom_openai_provider_entries(node)
                .iter()
                .any(custom_openai_entry_is_configured)
        }),
        _ => false,
    }
}

fn resolve_provider_models(
    provider: &str,
    catalog_entry: Option<&Value>,
    creds: &Value,
) -> (Vec<String>, Vec<String>, Option<String>, Option<String>) {
    if provider == "custom_openai" {
        let entries = creds
            .get("custom_openai")
            .map(custom_openai_provider_entries)
            .unwrap_or_else(|| custom_openai_provider_entries(&default_custom_openai_config()));
        let mut models = Vec::new();
        let mut available = Vec::new();
        let mut seen_models = HashSet::new();
        let mut seen_available = HashSet::new();
        let mut synced_at = None::<String>;
        let mut sync_error = None::<String>;

        for entry in entries {
            if !entry
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                continue;
            }
            for model in json_string_list(entry.get("textModels")) {
                if seen_models.insert(model.clone()) {
                    models.push(model);
                }
            }
            let entry_available = {
                let synced = json_string_list(entry.get("availableTextModels"));
                if synced.is_empty() {
                    json_string_list(entry.get("textModels"))
                } else {
                    synced
                }
            };
            for model in entry_available {
                if seen_available.insert(model.clone()) {
                    available.push(model);
                }
            }
            if synced_at.is_none() {
                synced_at = entry
                    .get("modelsSyncedAt")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            if sync_error.is_none() {
                sync_error = entry
                    .get("modelsSyncError")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }

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
    let custom_provider_count = creds
        .get("custom_openai")
        .map(custom_openai_provider_entries)
        .map(|items| items.len())
        .unwrap_or(1);
    let custom_display_name = if custom_provider_count > 1 {
        format!("自定义 OpenAI ({custom_provider_count})")
    } else {
        creds
            .get("custom_openai")
            .map(custom_openai_provider_entries)
            .and_then(|items| items.first().cloned())
            .and_then(|node| {
                node.get("displayName")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "自定义 OpenAI".to_string())
    };

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
    let requested_models_was_empty = body.models.is_empty();
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
    if !requested_models_was_empty && next_models.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "models 未匹配到可用模型",
        ));
    }

    if provider == "custom_openai" {
        let mut custom_openai = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
            .unwrap_or_else(default_custom_openai_config);
        let requested_set: HashSet<String> = next_models.iter().cloned().collect();
        let entries = custom_openai_provider_entries(&custom_openai)
            .into_iter()
            .map(|mut entry| {
                let entry_available = {
                    let synced = json_string_list(entry.get("availableTextModels"));
                    if synced.is_empty() {
                        json_string_list(entry.get("textModels"))
                    } else {
                        synced
                    }
                };
                let selected = entry_available
                    .into_iter()
                    .filter(|model| requested_set.contains(model))
                    .collect::<Vec<_>>();
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("textModels".to_string(), json!(selected));
                }
                entry
            })
            .collect::<Vec<_>>();
        custom_openai = custom_openai_config_from_entries(entries);
        set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &custom_openai)?;

        let updated = provider_summary(&conn)?
            .into_iter()
            .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

        return Ok(Json(json!({
          "success": true,
          "data": updated
        })));
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

    if provider == "custom_openai" {
        let entries = custom_openai_provider_entries(&custom_openai);
        let mut next_entries = Vec::new();
        let mut last_error = None::<String>;
        let mut any_success = false;

        for mut entry in entries {
            let previous_selected_models = json_string_list(entry.get("textModels"));
            let sync_result = fetch_provider_models_from_remote(
                "custom_openai",
                &wrap_custom_openai_creds(&entry),
            )
            .await;
            let synced_at = now_iso();
            let sync_error = sync_result.as_ref().err().cloned();
            if let Some(error) = sync_error.as_ref() {
                last_error = Some(error.clone());
            }
            if sync_result.is_ok() {
                any_success = true;
            }
            let synced_models = sync_result.clone().unwrap_or_default();
            let next_selected_models = if let Ok(models) = sync_result.as_ref() {
                retain_enabled_models(&previous_selected_models, models)
            } else {
                previous_selected_models
            };

            if let Some(obj) = entry.as_object_mut() {
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
            next_entries.push(entry);
        }

        custom_openai = custom_openai_config_from_entries(next_entries);
        set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &custom_openai)?;
        set_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY, &catalog)?;

        if !any_success {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!(
                    "同步模型失败: {}",
                    last_error.unwrap_or_else(|| "同步模型失败".to_string())
                ),
            ));
        }

        let updated = provider_summary(&conn)?
            .into_iter()
            .find(|item| item.get("provider").and_then(Value::as_str) == Some(provider.as_str()))
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "供应商不存在"))?;

        return Ok(Json(json!({
          "success": true,
          "data": updated
        })));
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

    Ok(Json(json!({
      "success": true,
      "data": custom_openai_public_config(&config)
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
    let mut entries = custom_openai_provider_entries(&config);
    let Some(entry) = entries.first_mut() else {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "自定义供应商配置无效",
        ));
    };

    if let Some(obj) = entry.as_object_mut() {
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

    config = custom_openai_config_from_entries(entries);
    set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;
    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_create(
    State(state): State<BackendState>,
    Json(body): Json<CustomOpenAIPutBody>,
) -> Result<Json<Value>, ApiError> {
    validate_custom_openai_body(&body, false)?;
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let mut entries = custom_openai_provider_entries(&config);
    if entries.len() >= 20 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "自定义 OpenAI 兼容供应商最多 20 个",
        ));
    }

    let id = format!("custom_{}", Uuid::new_v4().simple());
    let mut entry = default_custom_openai_provider_entry();
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("id".to_string(), json!(id));
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
    }
    entries.push(entry);
    set_config_json(
        &conn,
        CUSTOM_OPENAI_CONFIG_KEY,
        &custom_openai_config_from_entries(entries),
    )?;
    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_provider_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<CustomOpenAIPutBody>,
) -> Result<Json<Value>, ApiError> {
    validate_custom_openai_body(&body, false)?;
    let id = sanitize_custom_openai_provider_id(&id)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "供应商 ID 无效"))?;
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let mut found = false;
    let entries = custom_openai_provider_entries(&config)
        .into_iter()
        .map(|mut entry| {
            if entry.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                return Ok(entry);
            }
            found = true;
            if let Some(obj) = entry.as_object_mut() {
                if let Some(enabled) = body.enabled {
                    obj.insert("enabled".to_string(), json!(enabled));
                }
                if let Some(display_name) = body.display_name.as_deref() {
                    obj.insert("displayName".to_string(), json!(display_name.trim()));
                }
                if let Some(base_url) = body.base_url.as_deref() {
                    obj.insert("baseUrl".to_string(), json!(base_url));
                }
                if let Some(api_key) = body.api_key.as_deref() {
                    obj.insert("apiKey".to_string(), json!(api_key));
                }
                if let Some(text_models) = body.text_models.clone() {
                    obj.insert(
                        "textModels".to_string(),
                        json!(normalize_non_empty_string_list(text_models, "textModels")?),
                    );
                }
                if let Some(available) = body.available_text_models.clone() {
                    obj.insert(
                        "availableTextModels".to_string(),
                        json!(normalize_non_empty_string_list(
                            available,
                            "availableTextModels"
                        )?),
                    );
                }
            }
            Ok(entry)
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    if !found {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "自定义供应商不存在"));
    }

    set_config_json(
        &conn,
        CUSTOM_OPENAI_CONFIG_KEY,
        &custom_openai_config_from_entries(entries),
    )?;
    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_provider_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let id = sanitize_custom_openai_provider_id(&id)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "供应商 ID 无效"))?;
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let entries = custom_openai_provider_entries(&config);
    if entries.len() <= 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "至少保留一个自定义供应商",
        ));
    }
    let next_entries = entries
        .into_iter()
        .filter(|entry| entry.get("id").and_then(Value::as_str) != Some(id.as_str()))
        .collect::<Vec<_>>();
    if next_entries.len() == custom_openai_provider_entries(&config).len() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "自定义供应商不存在"));
    }
    set_config_json(
        &conn,
        CUSTOM_OPENAI_CONFIG_KEY,
        &custom_openai_config_from_entries(next_entries),
    )?;
    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_sync(
    State(state): State<BackendState>,
    payload: Option<Json<CustomOpenAIPutBody>>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let mut entries = custom_openai_provider_entries(&config);

    if let Some(Json(body)) = payload {
        validate_custom_openai_body(&body, true)?;
        let Some(entry) = entries.first_mut() else {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "自定义供应商配置无效",
            ));
        };
        if let Some(obj) = entry.as_object_mut() {
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

    let mut last_error = None::<String>;
    let mut any_success = false;
    let mut next_entries = Vec::new();
    for mut entry in entries {
        let sync_result =
            fetch_provider_models_from_remote("custom_openai", &wrap_custom_openai_creds(&entry))
                .await;
        let synced_at = now_iso();
        let sync_error = sync_result.as_ref().err().cloned();
        if let Some(error) = sync_error.as_ref() {
            last_error = Some(error.clone());
        }
        if sync_result.is_ok() {
            any_success = true;
        }
        let synced_models = sync_result.clone().unwrap_or_default();
        let previous_selected_models = json_string_list(entry.get("textModels"));
        let next_selected_models = if let Ok(models) = sync_result.as_ref() {
            retain_enabled_models(&previous_selected_models, models)
        } else {
            previous_selected_models
        };

        if let Some(obj) = entry.as_object_mut() {
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
        next_entries.push(entry);
    }

    config = custom_openai_config_from_entries(next_entries);
    set_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;

    if !any_success {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "同步模型失败: {}",
                last_error.unwrap_or_else(|| "同步模型失败".to_string())
            ),
        ));
    }

    api_custom_openai_get(State(state)).await
}

async fn api_custom_openai_provider_sync(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let id = sanitize_custom_openai_provider_id(&id)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "供应商 ID 无效"))?;
    let conn = db_connection(&state)?;
    let config = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .unwrap_or_else(default_custom_openai_config);
    let mut found = false;
    let mut sync_error = None::<String>;
    let mut entries = Vec::new();
    for mut entry in custom_openai_provider_entries(&config) {
        if entry.get("id").and_then(Value::as_str) != Some(id.as_str()) {
            entries.push(entry);
            continue;
        }
        found = true;
        let previous_selected_models = json_string_list(entry.get("textModels"));
        let sync_result =
            fetch_provider_models_from_remote("custom_openai", &wrap_custom_openai_creds(&entry))
                .await;
        let synced_at = now_iso();
        let entry_sync_error = sync_result.as_ref().err().cloned();
        sync_error = entry_sync_error.clone();
        let synced_models = sync_result.clone().unwrap_or_default();
        let next_selected_models = if let Ok(models) = sync_result.as_ref() {
            retain_enabled_models(&previous_selected_models, models)
        } else {
            previous_selected_models
        };

        if let Some(obj) = entry.as_object_mut() {
            if sync_result.is_ok() {
                obj.insert("textModels".to_string(), json!(next_selected_models));
                obj.insert("availableTextModels".to_string(), json!(synced_models));
            }
            obj.insert("modelsSyncedAt".to_string(), json!(synced_at));
            obj.insert(
                "modelsSyncError".to_string(),
                entry_sync_error
                    .map(|value| json!(value))
                    .unwrap_or(Value::Null),
            );
        }
        entries.push(entry);
    }
    if !found {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "自定义供应商不存在"));
    }
    set_config_json(
        &conn,
        CUSTOM_OPENAI_CONFIG_KEY,
        &custom_openai_config_from_entries(entries),
    )?;
    if let Some(error) = sync_error {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("同步模型失败: {}", error),
        ));
    }
    api_custom_openai_get(State(state)).await
}

fn model_providers_config_export_payload(conn: &Connection) -> Result<Value, ApiError> {
    let provider_credentials = get_config_json(&conn, PROVIDER_CREDENTIALS_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(default_provider_credentials);
    let custom_openai_provider = get_config_json(&conn, CUSTOM_OPENAI_CONFIG_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(default_custom_openai_config);
    let provider_model_catalog = get_config_json(&conn, PROVIDER_MODEL_CATALOG_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));

    Ok(json!({
      "type": "playlet.model_providers",
      "version": SETTINGS_CONFIG_EXPORT_VERSION,
      "exportedAt": now_iso(),
      "includesSecrets": true,
      "providerCredentials": provider_credentials,
      "customOpenaiProvider": custom_openai_provider,
      "providerModelCatalog": provider_model_catalog
    }))
}

async fn api_model_providers_config_export(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let payload = model_providers_config_export_payload(&conn)?;
    let encrypted_payload = encrypt_settings_config_payload(&payload)?;

    Ok(Json(json!({
      "success": true,
      "data": encrypted_payload
    })))
}

async fn api_model_providers_config_download(
    State(state): State<BackendState>,
) -> Result<Response, ApiError> {
    let conn = db_connection(&state)?;
    let payload = model_providers_config_export_payload(&conn)?;
    let encrypted_payload = encrypt_settings_config_payload(&payload)?;
    settings_json_attachment(
        &settings_export_file_name("model-providers"),
        &encrypted_payload,
    )
}

fn import_model_providers_config_payload(
    conn: &Connection,
    payload: &Value,
) -> Result<Value, ApiError> {
    let credentials_section = settings_import_section(
        payload,
        &["providerCredentials", "credentials", "provider_credentials"],
    )
    .or_else(|| {
        if settings_provider_entries_have_any_key(
            payload,
            &["apiKey", "baseUrl", "accessKey", "secretKey"],
        ) {
            Some(payload)
        } else {
            None
        }
    });
    let custom_openai_section = settings_import_section(
        payload,
        &[
            "customOpenaiProvider",
            "customOpenAIProvider",
            "customOpenai",
            "custom_openai_provider",
        ],
    )
    .or_else(|| {
        if settings_has_any_key(
            payload,
            &[
                "enabled",
                "displayName",
                "baseUrl",
                "apiKey",
                "textModels",
                "availableTextModels",
            ],
        ) && !settings_provider_entries_have_any_key(
            payload,
            &["apiKey", "baseUrl", "accessKey", "secretKey", "models"],
        ) {
            Some(payload)
        } else {
            None
        }
    });
    let catalog_section = settings_import_section(
        payload,
        &[
            "providerModelCatalog",
            "modelCatalog",
            "provider_model_catalog",
        ],
    )
    .or_else(|| {
        if settings_provider_entries_have_any_key(
            payload,
            &["models", "availableModels", "syncedAt", "syncError"],
        ) {
            Some(payload)
        } else {
            None
        }
    });

    if credentials_section.is_none() && custom_openai_section.is_none() && catalog_section.is_none()
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "导入数据缺少供应商配置",
        ));
    }

    let mut imported = Vec::<String>::new();
    if let Some(section) = credentials_section {
        let config = normalize_imported_provider_credentials(section)?;
        set_config_json(conn, PROVIDER_CREDENTIALS_KEY, &config)?;
        imported.push("providerCredentials".to_string());
    }
    if let Some(section) = custom_openai_section {
        let config = normalize_imported_custom_openai_config(section)?;
        set_config_json(conn, CUSTOM_OPENAI_CONFIG_KEY, &config)?;
        imported.push("customOpenaiProvider".to_string());
    }
    if let Some(section) = catalog_section {
        let config = normalize_imported_provider_model_catalog(section)?;
        set_config_json(conn, PROVIDER_MODEL_CATALOG_KEY, &config)?;
        imported.push("providerModelCatalog".to_string());
    }

    Ok(json!({
      "imported": imported,
      "providers": provider_summary(conn)?
    }))
}

async fn api_model_providers_config_import(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let payload = settings_import_payload_owned(&body)?;
    let conn = db_connection(&state)?;
    let data = import_model_providers_config_payload(&conn, &payload)?;

    Ok(Json(json!({
      "success": true,
      "data": data
    })))
}

/// 构造脱敏后的供应商凭证视图（不回传密钥明文，仅返回是否已配置 + Base URL）。
fn provider_credentials_public(creds: &Value) -> Value {
    let mask =
        |provider: &str, field: &str| provider_credential_field(creds, provider, field).is_some();
    let base_url =
        |provider: &str| provider_credential_field(creds, provider, "baseUrl").unwrap_or_default();
    json!({
      "gemini":     { "hasApiKey": mask("gemini", "apiKey"), "baseUrl": base_url("gemini") },
      "qwen":       { "hasApiKey": mask("qwen", "apiKey"), "baseUrl": base_url("qwen") },
      "volcengine": {
        "hasApiKey": mask("volcengine", "apiKey"),
        "hasMediakitApiKey": mask("volcengine", "mediakitApiKey"),
        "hasArkAccessKey": mask("volcengine", "arkAccessKey"),
        "hasArkSecretKey": mask("volcengine", "arkSecretKey"),
        "arkProjectName": provider_credential_field(creds, "volcengine", "arkProjectName").unwrap_or_else(|| "default".to_string()),
        "arkOpenApiBaseUrl": provider_credential_field(creds, "volcengine", "arkOpenApiBaseUrl").unwrap_or_default(),
        "baseUrl": base_url("volcengine")
      },
      "deepseek":   { "hasApiKey": mask("deepseek", "apiKey"), "baseUrl": base_url("deepseek") },
      "kling": {
        "hasAccessKey": mask("kling", "accessKey"),
        "hasSecretKey": mask("kling", "secretKey"),
        "baseUrl": base_url("kling")
      }
    })
}

fn cloud_status_payload(conn: &Connection) -> Result<Value, ApiError> {
    let base_url = cloud_base_url(conn).unwrap_or_default();
    let session = cloud_session(conn);
    let raw_cloud_creds = get_cloud_runtime_credentials();
    let raw_cloud_tos_config = get_cloud_runtime_tos_config();
    let raw_cloud_wx_channels_config = get_cloud_runtime_wx_channels_config();
    Ok(json!({
      "configured": !base_url.is_empty(),
      "baseUrl": base_url,
      "authenticated": session
        .as_ref()
        .and_then(|value| value.get("token"))
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty()),
      "user": cloud_user_public(conn),
      "deviceId": get_or_create_cloud_device_id(conn)?,
      "lastBootstrapAt": session
        .as_ref()
        .and_then(|value| value.get("lastBootstrapAt"))
        .cloned()
        .unwrap_or(Value::Null),
      "lastDataSyncAt": session
        .as_ref()
        .and_then(|value| value.get("lastDataSyncAt"))
        .cloned()
        .unwrap_or(Value::Null),
      "dataSync": session
        .as_ref()
        .and_then(|value| value.get("dataSync"))
        .cloned()
        .unwrap_or(Value::Null),
      "credentials": cloud_provider_credentials_public(raw_cloud_creds),
      "tosStorage": cloud_tos_storage_public(raw_cloud_tos_config),
      "wxChannels": cloud_wx_channels_public(raw_cloud_wx_channels_config)
    }))
}

async fn cloud_refresh_runtime_credentials(state: &BackendState) -> Result<Value, ApiError> {
    let (base_url, token) = {
        let conn = db_connection(state)?;
        let base_url = cloud_base_url(&conn)
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先配置并登录后台"))?;
        let token = cloud_token(&conn)
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先登录后台"))?;
        (base_url, token)
    };

    let bootstrap = cloud_request_json(
        &base_url,
        reqwest::Method::GET,
        "/api/client/bootstrap",
        Some(&token),
        None,
    )
    .await?;
    let credentials = cloud_request_secure_json(
        &base_url,
        reqwest::Method::GET,
        "/api/client/provider-credentials",
        Some(&token),
        None,
    )
    .await?;
    let tos_storage_config = cloud_request_secure_json(
        &base_url,
        reqwest::Method::GET,
        "/api/client/tos-storage-config",
        Some(&token),
        None,
    )
    .await?;
    let wx_channels_config = match cloud_request_secure_json(
        &base_url,
        reqwest::Method::GET,
        "/api/client/wx-channels-config",
        Some(&token),
        None,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            eprintln!(
                "[CloudSync] wx channels config pull failed: {}",
                error.message
            );
            json!({ "data": {} })
        }
    };

    let credentials_data = credentials
        .get("data")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let local_credentials = cloud_provider_credentials_to_local(Some(credentials_data.clone()));
    let tos_storage_data = tos_storage_config
        .get("data")
        .cloned()
        .unwrap_or_else(default_tos_config);
    let wx_channels_data = wx_channels_config
        .get("data")
        .cloned()
        .map(normalize_cloud_wx_channels_config)
        .unwrap_or_else(|| json!({}));
    let conn = db_connection(state)?;
    set_cloud_runtime_credentials(local_credentials);
    set_cloud_runtime_tos_config(tos_storage_data.clone());
    set_cloud_runtime_wx_channels_config(wx_channels_data.clone());

    let mut session = cloud_session(&conn).unwrap_or_else(|| json!({}));
    if let Some(obj) = session.as_object_mut() {
        obj.insert("lastBootstrapAt".to_string(), json!(now_iso()));
        if let Some(user) = bootstrap
            .get("data")
            .and_then(|data| data.get("user"))
            .cloned()
        {
            obj.insert("user".to_string(), user);
        }
        obj.insert(
            "bootstrap".to_string(),
            bootstrap.get("data").cloned().unwrap_or(Value::Null),
        );
        obj.insert("tosStorageConfig".to_string(), tos_storage_data);
    }
    set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &session)?;
    drop(conn);

    let data_sync_result = match cloud_pull_account_data(state, &base_url, &token).await {
        Ok(result) => result,
        Err(error) => {
            eprintln!("[CloudSync] account data pull failed: {}", error.message);
            json!({
              "success": false,
              "message": error.message
            })
        }
    };
    let conn = db_connection(state)?;
    let mut session = cloud_session(&conn).unwrap_or_else(|| json!({}));
    if let Some(obj) = session.as_object_mut() {
        obj.insert("lastDataSyncAt".to_string(), json!(now_iso()));
        obj.insert("dataSync".to_string(), data_sync_result);
    }
    set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &session)?;
    cloud_status_payload(&conn)
}

async fn cloud_post_client_json(
    state: &BackendState,
    path: &str,
    body: Value,
) -> Result<Value, ApiError> {
    let (base_url, token) = {
        let conn = db_connection(state)?;
        let Some(base_url) = cloud_base_url(&conn) else {
            return Ok(json!({ "success": false, "skipped": "cloud_not_configured" }));
        };
        let Some(token) = cloud_token(&conn) else {
            return Ok(json!({ "success": false, "skipped": "cloud_not_authenticated" }));
        };
        (base_url, token)
    };
    cloud_request_json(
        &base_url,
        reqwest::Method::POST,
        path,
        Some(&token),
        Some(body),
    )
    .await
}

async fn cloud_upload_model_call_log(log_id: &str, body: Value) -> Result<(), ApiError> {
    let Some((base_url, token)) =
        config_connection().and_then(|conn| Some((cloud_base_url(&conn)?, cloud_token(&conn)?)))
    else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "后台未登录，模型日志等待同步",
        ));
    };

    let result = cloud_request_json(
        &base_url,
        reqwest::Method::POST,
        "/api/client/model-call-logs",
        Some(&token),
        Some(body),
    )
    .await;

    if let Some(conn) = config_connection() {
        match &result {
            Ok(_) => {
                let _ = conn.execute(
                    "UPDATE model_debug_logs
                     SET cloud_sync_status = 'synced', cloud_synced_at = ?1,
                         cloud_sync_error = NULL, cloud_sync_attempts = cloud_sync_attempts + 1
                     WHERE id = ?2",
                    params![now_iso(), log_id],
                );
            }
            Err(error) => {
                let _ = conn.execute(
                    "UPDATE model_debug_logs
                     SET cloud_sync_status = 'pending', cloud_sync_error = ?1,
                         cloud_sync_attempts = cloud_sync_attempts + 1
                     WHERE id = ?2",
                    params![truncate_log_text(&error.message, 1000), log_id],
                );
            }
        }
    }
    result.map(|_| ())
}

fn cloud_spawn_model_call_log_upload(log_id: String, body: Value) {
    tokio::spawn(async move {
        if let Err(error) = cloud_upload_model_call_log(&log_id, body).await {
            eprintln!(
                "[CloudSync] model call log upload failed: {}",
                error.message
            );
        }
    });
}

fn pending_model_call_logs(limit: i64) -> Vec<(String, Value)> {
    let Some(conn) = config_connection() else {
        return Vec::new();
    };
    let Ok(mut statement) = conn.prepare(
        "SELECT id, cloud_payload_json FROM model_debug_logs
         WHERE cloud_sync_status = 'pending' AND cloud_payload_json IS NOT NULL
         ORDER BY timestamp ASC LIMIT ?1",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map(params![limit], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else {
        return Vec::new();
    };
    rows.filter_map(Result::ok)
        .filter_map(|(id, raw)| {
            serde_json::from_str::<Value>(&raw)
                .ok()
                .map(|body| (id, body))
        })
        .collect()
}

fn spawn_model_call_log_sync_poller() {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            for (log_id, body) in pending_model_call_logs(100) {
                if let Err(error) = cloud_upload_model_call_log(&log_id, body).await {
                    eprintln!("[CloudSync] model call log retry failed: {}", error.message);
                    break;
                }
            }
        }
    });
}

async fn cloud_sync_project_by_id(state: &BackendState, project_id: &str) -> Result<(), ApiError> {
    let Json(project_response) =
        api_project_get(Path(project_id.to_string()), State(state.clone())).await?;
    let data = project_response
        .get("data")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let project = data.get("project").cloned().unwrap_or_else(|| json!({}));
    let owner_user_id = db_connection(state)?
        .query_row(
            "SELECT owner_user_id FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .flatten();
    let body = json!({
      "force": true,
      "localProjectId": project_id,
      "ownerUserId": owner_user_id,
      "name": project.get("name").and_then(Value::as_str).unwrap_or("未命名项目"),
      "description": project.get("description").cloned().unwrap_or(Value::Null),
      "scriptParseMode": project.get("scriptParseMode").cloned().unwrap_or(Value::Null),
      "styleId": project.get("styleId").cloned().unwrap_or(Value::Null),
      "aspectRatio": project.get("aspectRatio").cloned().unwrap_or(Value::Null),
      "status": project.get("status").cloned().unwrap_or(Value::Null),
      "createdAt": project.get("createdAt").cloned().unwrap_or(Value::Null),
      "updatedAt": project.get("updatedAt").cloned().unwrap_or(Value::Null),
      "localCreatedAt": project.get("createdAt").cloned().unwrap_or(Value::Null),
      "localUpdatedAt": project.get("updatedAt").cloned().unwrap_or(Value::Null),
      "summary": {
        "sceneCount": data.get("scenes").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "characterCount": data.get("characters").and_then(Value::as_array).map(Vec::len).unwrap_or(0)
      },
      "snapshot": data
    });
    let response = cloud_post_client_json(state, "/api/client/projects/sync", body).await?;
    ensure_cloud_project_sync_accepted(&response, project_id)
}

fn ensure_cloud_project_sync_accepted(response: &Value, project_id: &str) -> Result<(), ApiError> {
    if response
        .get("skipped")
        .and_then(Value::as_str)
        .is_some_and(|reason| {
            reason == "cloud_not_configured" || reason == "cloud_not_authenticated"
        })
    {
        return Ok(());
    }

    if response.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "云端项目同步失败"));
    }

    let Some(items) = response
        .get("data")
        .and_then(|data| data.get("synced"))
        .and_then(Value::as_array)
    else {
        return Ok(());
    };

    for item in items {
        let local_project_id = item
            .get("localProjectId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if local_project_id != project_id {
            continue;
        }
        let status = item.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "synced" {
            return Ok(());
        }
        let reason = item
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let message = match reason {
            "stale_local_update" => "云端已有更新版本，已保留云端数据".to_string(),
            "unknown" => "云端返回跳过同步，但未说明原因".to_string(),
            _ => reason.to_string(),
        };
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            format!("云端项目同步被跳过: {message}"),
        ));
    }

    Ok(())
}

async fn cloud_sync_prompt_state(state: &BackendState) -> Result<(), ApiError> {
    let Json(prompts) = api_prompts_get(State(state.clone())).await?;
    let data = prompts.get("data").cloned().unwrap_or_else(|| json!({}));
    let templates = data
        .get("templates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            json!({
              "id": item.get("id").cloned().unwrap_or(Value::Null),
              "templateKey": item.get("id").cloned().unwrap_or(Value::Null),
              "title": item.get("title").or_else(|| item.get("name")).cloned().unwrap_or(Value::Null),
              "content": item.get("content").cloned().unwrap_or(Value::Null),
              "source": if item.get("isCustomized").and_then(Value::as_bool).unwrap_or(false) { "user_custom" } else { "system_default" }
            })
        })
        .collect::<Vec<_>>();
    let profiles = data
        .get("profiles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let id = item.get("id").and_then(Value::as_str).unwrap_or("default");
            json!({
              "id": id,
              "localProfileId": id,
              "name": item.get("name").cloned().unwrap_or_else(|| json!(id)),
              "description": item.get("description").cloned().unwrap_or(Value::Null),
              "isActive": data.get("activeProfileId").and_then(Value::as_str) == Some(id)
            })
        })
        .collect::<Vec<_>>();
    cloud_post_client_json(
        state,
        "/api/client/prompts/sync",
        json!({
          "snapshot": data,
          "profiles": profiles,
          "templates": templates
        }),
    )
    .await
    .map(|_| ())
}

async fn cloud_sync_model_preferences(state: &BackendState) -> Result<(), ApiError> {
    let Json(workflow) = api_models_workflow_get(State(state.clone())).await?;
    let data = workflow.get("data").cloned().unwrap_or_else(|| json!({}));
    let selections = data
        .get("currentSelections")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let options = data
        .get("modelOptions")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut preferences = selections
        .into_iter()
        .filter_map(|(step, model_id)| {
            let model_id = model_id.as_str()?.trim().to_string();
            if model_id.is_empty() {
                return None;
            }
            Some(json!({
              "workflowStep": step,
              "modelId": model_id,
              "modelOptions": options.get(&step).cloned().unwrap_or_else(|| json!({}))
            }))
        })
        .collect::<Vec<_>>();
    for step in ["image_options", "completion_notification"] {
        if let Some(model_options) = options.get(step) {
            preferences.push(json!({
              "workflowStep": step,
              "modelId": CLOUD_MODEL_OPTIONS_MODEL_ID,
              "modelOptions": model_options
            }));
        }
    }
    cloud_post_client_json(
        state,
        "/api/client/model-preferences/sync",
        json!({ "preferences": preferences }),
    )
    .await
    .map(|_| ())
}

async fn apply_cloud_project_snapshot(
    state: &BackendState,
    project: &Value,
) -> Result<bool, ApiError> {
    let local_project_id = cloud_value_text(project, "localProjectId");
    if local_project_id.is_empty() {
        return Ok(false);
    }
    {
        let conn = db_connection(state)?;
        if is_deleted_project_tombstone(&conn, &local_project_id)? {
            return Ok(false);
        }
    }
    let Some(snapshot) = project.get("snapshot").filter(|value| value.is_object()) else {
        return Ok(false);
    };
    let remote_updated_at = cloud_project_remote_updated_at(project, snapshot);
    let local_updated_at = {
        let conn = db_connection(state)?;
        local_project_updated_at(&conn, &local_project_id)?
    };
    if !should_apply_cloud_update(local_updated_at, &remote_updated_at) {
        return Ok(false);
    }

    upsert_cloud_project_placeholder(
        state,
        &local_project_id,
        project,
        snapshot,
        &remote_updated_at,
    )?;
    let body = build_cloud_project_put_body(snapshot, project);
    let _ = api_project_put_inner(
        Path(local_project_id),
        State(state.clone()),
        Json(body),
        ProjectPutOptions {
            skip_cloud_sync: true,
            preserve_updated_at: (!remote_updated_at.trim().is_empty())
                .then(|| remote_updated_at.trim().to_string()),
        },
    )
    .await?;
    Ok(true)
}

async fn apply_cloud_projects(state: &BackendState, projects: &Value) -> Value {
    let Some(items) = projects.as_array() else {
        return json!({ "imported": 0, "skipped": 0, "failed": 0 });
    };
    let mut imported = 0;
    let mut skipped = 0;
    let mut failed = 0;
    for project in items {
        match apply_cloud_project_snapshot(state, project).await {
            Ok(true) => imported += 1,
            Ok(false) => skipped += 1,
            Err(error) => {
                failed += 1;
                eprintln!("[CloudSync] project pull failed: {}", error.message);
            }
        }
    }
    json!({ "imported": imported, "skipped": skipped, "failed": failed })
}

fn apply_cloud_model_call_logs(state: &BackendState, logs: &Value) -> Result<usize, ApiError> {
    let Some(items) = logs.as_array() else {
        return Ok(0);
    };
    let conn = db_connection(state)?;
    let mut imported = 0;
    for log in items {
        let id = cloud_value_text(log, "id");
        if id.is_empty() {
            continue;
        }
        let timestamp = cloud_value_text(log, "created_at");
        conn.execute(
            "INSERT OR REPLACE INTO model_debug_logs (
               id, timestamp, provider, model, operation, status, duration_ms, request_id,
               project_id, scene_id, request_json, request_raw_json, response_json,
               response_raw_json, error_json, created_at, cloud_sync_status, cloud_synced_at,
               owner_account, owner_display_name
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?12, ?13, ?2, 'synced', ?2, ?14, ?15)",
            params![
                id,
                if timestamp.is_empty() { now_iso() } else { timestamp },
                cloud_value_text(log, "provider"),
                cloud_value_text(log, "model_id"),
                cloud_value_text(log, "operation"),
                cloud_value_text(log, "status"),
                log.get("duration_ms").and_then(Value::as_i64).unwrap_or(0),
                cloud_value_text(log, "request_id"),
                cloud_value_text(log, "project_id"),
                cloud_value_text(log, "scene_id"),
                log.get("request_json").and_then(Value::as_str),
                log.get("response_json").and_then(Value::as_str),
                log.get("error_json").and_then(Value::as_str),
                cloud_value_text(log, "owner_account"),
                cloud_value_text(log, "owner_display_name")
            ],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        imported += 1;
    }
    Ok(imported)
}

fn apply_cloud_prompt_state(state: &BackendState, prompt_state: &Value) -> Result<bool, ApiError> {
    let Some(snapshot) = prompt_state
        .get("snapshot")
        .filter(|value| value.is_object())
    else {
        return Ok(false);
    };
    let remote_updated_at = cloud_value_text(prompt_state, "updatedAt");
    let conn = db_connection(state)?;
    let local_updated_at = local_config_updated_at(&conn, PROMPT_PROFILE_STATE_KEY)?;
    if !should_apply_cloud_update(local_updated_at, &remote_updated_at) {
        return Ok(false);
    }

    let templates = snapshot
        .get("templates")
        .cloned()
        .map(merge_prompt_templates_with_defaults)
        .unwrap_or_else(default_prompt_templates);
    let versions = snapshot
        .get("versions")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let profiles = snapshot
        .get("profiles")
        .and_then(Value::as_array)
        .cloned()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            default_prompt_profiles()
                .get("profiles")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        });
    let active_profile_id = snapshot
        .get("activeProfileId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string();
    let profiles_value = json!({
      "profiles": profiles,
      "activeProfileId": active_profile_id
    });

    let mut snapshots = serde_json::Map::new();
    snapshots.insert(
        "default".to_string(),
        json!({ "templates": default_prompt_templates(), "versions": [] }),
    );
    snapshots.insert(
        active_profile_id.clone(),
        json!({ "templates": templates.clone(), "versions": versions.clone() }),
    );
    if let Some(profile_items) = profiles_value.get("profiles").and_then(Value::as_array) {
        for profile in profile_items {
            let Some(profile_id) = profile.get("id").and_then(Value::as_str) else {
                continue;
            };
            snapshots.entry(profile_id.to_string()).or_insert_with(
                || json!({ "templates": default_prompt_templates(), "versions": [] }),
            );
        }
    }
    let profile_state = json!({
      "activeProfileId": active_profile_id,
      "profiles": profiles_value.get("profiles").cloned().unwrap_or_else(|| json!([])),
      "snapshots": Value::Object(snapshots)
    });

    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
    set_config_json(&conn, PROMPT_VERSIONS_KEY, &versions)?;
    set_config_json(&conn, PROMPT_PROFILES_KEY, &profiles_value)?;
    set_config_json(&conn, PROMPT_PROFILE_STATE_KEY, &profile_state)?;
    Ok(true)
}

fn apply_cloud_model_preferences(
    state: &BackendState,
    model_preferences: &Value,
) -> Result<bool, ApiError> {
    let Some(items) = model_preferences.as_array() else {
        return Ok(false);
    };
    if items.is_empty() {
        return Ok(false);
    }

    let remote_updated_at = items
        .iter()
        .filter_map(|item| item.get("updatedAt").and_then(Value::as_str))
        .max()
        .unwrap_or("");
    let conn = db_connection(state)?;
    let local_models_updated = local_config_updated_at(&conn, WORKFLOW_MODELS_KEY)?;
    let local_options_updated = local_config_updated_at(&conn, WORKFLOW_MODEL_OPTIONS_KEY)?;
    let local_updated_at = [local_models_updated, local_options_updated]
        .into_iter()
        .flatten()
        .max();
    if !should_apply_cloud_update(local_updated_at, remote_updated_at) {
        return Ok(false);
    }

    let mut models = serde_json::Map::new();
    let mut options = workflow_model_options(&conn)?
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut applied_options = false;
    for item in items {
        let step = cloud_value_text(item, "workflowStep");
        let model_id = cloud_value_text(item, "modelId");
        if is_cloud_model_options_step(&step) {
            let model_options = item
                .get("modelOptions")
                .cloned()
                .unwrap_or_else(|| json!({}));
            validate_workflow_model_options(&step, &model_options)?;
            let default_options = default_workflow_model_options();
            let merged = merge_json_object_defaults(
                model_options,
                default_options.get(&step).unwrap_or(&json!({})),
            );
            options.insert(step, merged);
            applied_options = true;
            continue;
        }
        if !is_workflow_step(&step) || model_id.is_empty() {
            continue;
        }
        models.insert(step.clone(), json!(model_id));
        options.insert(
            step,
            item.get("modelOptions")
                .cloned()
                .unwrap_or_else(|| json!({})),
        );
    }
    if models.is_empty() && !applied_options {
        return Ok(false);
    }
    if !models.is_empty() {
        set_config_json(&conn, WORKFLOW_MODELS_KEY, &Value::Object(models))?;
    }
    set_config_json(&conn, WORKFLOW_MODEL_OPTIONS_KEY, &Value::Object(options))?;
    Ok(true)
}

async fn cloud_pull_account_data(
    state: &BackendState,
    base_url: &str,
    token: &str,
) -> Result<Value, ApiError> {
    let response = cloud_request_json(
        base_url,
        reqwest::Method::GET,
        "/api/client/account-data",
        Some(token),
        None,
    )
    .await?;
    let data = response.get("data").cloned().unwrap_or_else(|| json!({}));
    let projects = apply_cloud_projects(state, data.get("projects").unwrap_or(&Value::Null)).await;
    let prompts_imported =
        apply_cloud_prompt_state(state, data.get("promptState").unwrap_or(&Value::Null))?;
    let model_preferences_imported =
        apply_cloud_model_preferences(state, data.get("modelPreferences").unwrap_or(&Value::Null))?;
    let model_call_logs_imported =
        apply_cloud_model_call_logs(state, data.get("modelCallLogs").unwrap_or(&Value::Null))?;

    Ok(json!({
      "success": true,
      "projects": projects,
      "promptsImported": prompts_imported,
      "modelPreferencesImported": model_preferences_imported,
      "modelCallLogsImported": model_call_logs_imported
    }))
}

async fn api_cloud_status(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    Ok(Json(json!({
      "success": true,
      "data": cloud_status_payload(&conn)?
    })))
}

async fn api_cloud_config_put(
    State(state): State<BackendState>,
    Json(body): Json<CloudConfigPutBody>,
) -> Result<Json<Value>, ApiError> {
    let base_url = normalize_cloud_base_url(&body.base_url)?;
    let conn = db_connection(&state)?;
    set_config_json(
        &conn,
        CLOUD_ADMIN_CONFIG_KEY,
        &json!({ "baseUrl": base_url }),
    )?;
    set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &json!({}))?;
    clear_cloud_runtime_config();
    Ok(Json(json!({
      "success": true,
      "data": cloud_status_payload(&conn)?
    })))
}

async fn api_cloud_login(
    State(state): State<BackendState>,
    Json(body): Json<CloudLoginBody>,
) -> Result<Json<Value>, ApiError> {
    let base_url = normalize_cloud_base_url(&body.base_url)?;
    let (device_id, login_body) = {
        let conn = db_connection(&state)?;
        let device_id = get_or_create_cloud_device_id(&conn)?;
        (
            device_id.clone(),
            json!({
              "account": body.account.trim(),
              "password": body.password,
              "deviceId": device_id,
              "deviceName": "Playlet Desktop",
              "os": std::env::consts::OS,
              "clientVersion": env!("CARGO_PKG_VERSION")
            }),
        )
    };
    let login_response = cloud_request_json(
        &base_url,
        reqwest::Method::POST,
        "/api/auth/login",
        None,
        Some(login_body),
    )
    .await?;
    let data = login_response
        .get("data")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let token = data
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "后台未返回登录 token"))?
        .to_string();
    {
        let conn = db_connection(&state)?;
        set_config_json(
            &conn,
            CLOUD_ADMIN_CONFIG_KEY,
            &json!({ "baseUrl": base_url }),
        )?;
        set_config_json(
            &conn,
            CLOUD_ADMIN_SESSION_KEY,
            &json!({
              "token": token,
              "user": data.get("user").cloned().unwrap_or(Value::Null),
              "expiresAt": data.get("expiresAt").cloned().unwrap_or(Value::Null),
              "deviceId": device_id,
              "loggedInAt": now_iso()
            }),
        )?;
    }
    let status = cloud_refresh_runtime_credentials(&state).await?;
    Ok(Json(json!({
      "success": true,
      "data": status
    })))
}

async fn api_cloud_logout(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let (base_url, token) = {
        let conn = db_connection(&state)?;
        (cloud_base_url(&conn), cloud_token(&conn))
    };
    if let (Some(base_url), Some(token)) = (base_url, token) {
        let _ = cloud_request_json(
            &base_url,
            reqwest::Method::POST,
            "/api/auth/logout",
            Some(&token),
            Some(json!({})),
        )
        .await;
    }
    let conn = db_connection(&state)?;
    set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &json!({}))?;
    clear_cloud_runtime_config();
    Ok(Json(json!({
      "success": true,
      "data": cloud_status_payload(&conn)?
    })))
}

async fn api_cloud_bootstrap(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let status = cloud_refresh_runtime_credentials(&state).await?;
    Ok(Json(json!({
      "success": true,
      "data": status
    })))
}

async fn api_cloud_heartbeat(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let (device_id, body) = {
        let conn = db_connection(&state)?;
        let device_id = get_or_create_cloud_device_id(&conn)?;
        (
            device_id.clone(),
            json!({
              "deviceId": device_id,
              "deviceName": "Playlet Desktop",
              "os": std::env::consts::OS,
              "clientVersion": env!("CARGO_PKG_VERSION")
            }),
        )
    };
    let result = cloud_post_client_json(&state, "/api/client/device/heartbeat", body).await?;
    Ok(Json(json!({
      "success": true,
      "data": {
        "deviceId": device_id,
        "remote": result
      }
    })))
}

async fn api_cloud_update_check(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let (device_id, body) = {
        let conn = db_connection(&state)?;
        let device_id = get_or_create_cloud_device_id(&conn)?;
        (
            device_id.clone(),
            json!({
              "appKey": "cartoon-desktop",
              "version": env!("CARGO_PKG_VERSION"),
              "platform": std::env::consts::OS,
              "arch": std::env::consts::ARCH,
              "channel": "stable",
              "deviceId": device_id,
              "deviceName": "Playlet Desktop"
            }),
        )
    };
    let result = cloud_post_client_json(&state, "/api/client/update-check", body).await?;
    Ok(Json(json!({
      "success": true,
      "data": {
        "deviceId": device_id,
        "remote": result
      }
    })))
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
        let root = config
            .as_object_mut()
            .expect("provider credentials must be object");
        let entry = root.entry(provider.clone()).or_insert_with(|| json!({}));
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
        if provider == "volcengine" {
            if let Some(mediakit_api_key) = body.mediakit_api_key {
                entry_obj.insert("mediakitApiKey".to_string(), json!(mediakit_api_key.trim()));
            }
            if let Some(ark_access_key) = body.ark_access_key {
                entry_obj.insert("arkAccessKey".to_string(), json!(ark_access_key.trim()));
            }
            if let Some(ark_secret_key) = body.ark_secret_key {
                entry_obj.insert("arkSecretKey".to_string(), json!(ark_secret_key.trim()));
            }
            if let Some(ark_project_name) = body.ark_project_name {
                let project_name = ark_project_name.trim();
                entry_obj.insert(
                    "arkProjectName".to_string(),
                    json!(if project_name.is_empty() {
                        "default"
                    } else {
                        project_name
                    }),
                );
            }
            if let Some(ark_open_api_base_url) = body.ark_open_api_base_url {
                entry_obj.insert(
                    "arkOpenApiBaseUrl".to_string(),
                    json!(ark_open_api_base_url.trim().trim_end_matches('/')),
                );
            }
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
    let cloud_config = get_cloud_runtime_tos_config();
    let config = cloud_config
        .or_else(|| {
            get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)
                .ok()
                .flatten()
        })
        .unwrap_or_else(default_tos_config);
    let mut public_config = config.clone();
    if let Some(obj) = public_config.as_object_mut() {
        obj.insert("keyPrefix".to_string(), json!(""));
    }
    Ok(Json(json!({
      "success": true,
      "data": tos_config_public(&public_config)
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

fn tos_config_export_payload(conn: &Connection) -> Result<Value, ApiError> {
    let config = get_config_json(&conn, TOS_STORAGE_CONFIG_KEY)?
        .filter(Value::is_object)
        .unwrap_or_else(default_tos_config);

    Ok(json!({
      "type": "playlet.tos_storage",
      "version": SETTINGS_CONFIG_EXPORT_VERSION,
      "exportedAt": now_iso(),
      "includesSecrets": true,
      "tosStorageConfig": config
    }))
}

async fn api_tos_config_export(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let payload = tos_config_export_payload(&conn)?;
    let encrypted_payload = encrypt_settings_config_payload(&payload)?;

    Ok(Json(json!({
      "success": true,
      "data": encrypted_payload
    })))
}

async fn api_tos_config_download(State(state): State<BackendState>) -> Result<Response, ApiError> {
    let conn = db_connection(&state)?;
    let payload = tos_config_export_payload(&conn)?;
    let encrypted_payload = encrypt_settings_config_payload(&payload)?;
    settings_json_attachment(
        &settings_export_file_name("tos-storage"),
        &encrypted_payload,
    )
}

fn import_tos_config_payload(conn: &Connection, payload: &Value) -> Result<Value, ApiError> {
    let config_section = settings_import_section(
        payload,
        &["tosStorageConfig", "tosConfig", "tos_storage_config"],
    )
    .unwrap_or(payload);

    if !settings_has_any_key(
        config_section,
        &[
            "enabled",
            "accessKeyId",
            "secretKey",
            "securityToken",
            "region",
            "endpoint",
            "bucket",
            "keyPrefix",
            "publicBaseUrl",
            "isCustomDomain",
        ],
    ) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "导入数据缺少 TOS 云存储配置",
        ));
    }

    let config = normalize_imported_tos_config(config_section)?;
    set_config_json(conn, TOS_STORAGE_CONFIG_KEY, &config)?;
    Ok(tos_config_public(&config))
}

async fn api_tos_config_import(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let payload = settings_import_payload_owned(&body)?;
    let conn = db_connection(&state)?;
    let data = import_tos_config_payload(&conn, &payload)?;

    Ok(Json(json!({
      "success": true,
      "data": data
    })))
}

async fn api_app_logs_get(
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
        None => 200,
    };
    let offset = match query.get("offset") {
        Some(raw) => {
            let parsed = raw
                .parse::<usize>()
                .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "offset 必须是整数"))?;
            if parsed > 1_000_000 {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "offset 必须小于等于 1000000",
                ));
            }
            parsed
        }
        None => 0,
    };
    let normalize_query = |key: &str| -> Result<Option<String>, ApiError> {
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
    let level_filter = normalize_query("level")?;
    let source_filter = normalize_query("source")?;
    let category_filter = normalize_query("category")?;
    let path_filter = normalize_query("path")?;
    let request_id_filter = match query.get("requestId").or_else(|| query.get("request_id")) {
        None => None,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "requestId 不能为空"));
            }
            Some(trimmed.to_ascii_lowercase())
        }
    };
    let status_filter = match query.get("status") {
        None => None,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "status 不能为空"));
            }
            Some(
                trimmed
                    .parse::<i64>()
                    .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "status 必须是整数"))?,
            )
        }
    };
    let keyword_filter = normalize_query("keyword")?;
    let model_only_filter = query
        .get("modelOnly")
        .or_else(|| query.get("model_only"))
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        });

    use rusqlite::types::Value as Bind;
    let mut where_parts: Vec<String> = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    if let Some(value) = &level_filter {
        where_parts.push("lower(level) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &source_filter {
        where_parts.push("lower(source) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &category_filter {
        where_parts.push("lower(category) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &path_filter {
        where_parts.push("lower(coalesce(path, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = &request_id_filter {
        where_parts.push("lower(coalesce(request_id, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = status_filter {
        where_parts.push("status = ?".to_string());
        binds.push(Bind::Integer(value));
    }
    if let Some(keyword) = &keyword_filter {
        where_parts.push(
            "(lower(level) LIKE ? OR lower(source) LIKE ? OR lower(category) LIKE ? \
              OR lower(message) LIKE ? OR lower(coalesce(path, '')) LIKE ? \
              OR lower(coalesce(request_id, '')) LIKE ? OR lower(coalesce(metadata_json, '')) LIKE ? \
              OR lower(coalesce(error_json, '')) LIKE ?)"
                .to_string(),
        );
        let pattern = format!("%{}%", keyword);
        for _ in 0..8 {
            binds.push(Bind::Text(pattern.clone()));
        }
    }
    if model_only_filter {
        where_parts.push(
            "(request_id IN (
                SELECT request_id FROM model_debug_logs
                WHERE request_id IS NOT NULL AND TRIM(request_id) != ''
              )
              OR path LIKE '/api/models%'
              OR path LIKE '/api/model-providers%'
              OR path LIKE '/api/script/%'
              OR path LIKE '/api/asset-workflow/%'
              OR path LIKE '/api/character/generate%')"
                .to_string(),
        );
    }
    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };
    let total = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM app_logs{}", where_clause),
            rusqlite::params_from_iter(binds.clone()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    binds.push(Bind::Integer(limit as i64));
    binds.push(Bind::Integer(offset as i64));

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, timestamp, level, source, category, message, request_id,
                    method, path, status, duration_ms, metadata_json, error_json
             FROM app_logs{} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            where_clause
        ))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let logs_raw = stmt
        .query_map(rusqlite::params_from_iter(binds), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<i64>>(10)?,
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
        level,
        source,
        category,
        message,
        request_id,
        method,
        path,
        status,
        duration_ms,
        metadata_json,
        error_json,
    ) in logs_raw
    {
        logs.push(json!({
          "id": id,
          "timestamp": timestamp,
          "level": level,
          "source": source,
          "category": category,
          "message": message,
          "requestId": request_id,
          "method": method,
          "path": path,
          "status": status,
          "durationMs": duration_ms,
          "metadata": parse_json(metadata_json),
          "error": parse_json(error_json)
        }));
    }
    Ok(Json(
        json!({ "success": true, "data": { "logs": logs, "total": total } }),
    ))
}

async fn api_app_logs_post(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let level = body.get("level").and_then(Value::as_str).unwrap_or("info");
    let source = sanitize_app_log_token(body.get("source").and_then(Value::as_str), "frontend");
    let category = sanitize_app_log_token(
        body.get("category").and_then(Value::as_str),
        "frontend_event",
    );
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("frontend log");
    let current_request_id = current_request_id();
    let request_id = body
        .get("requestId")
        .or_else(|| body.get("request_id"))
        .and_then(Value::as_str)
        .or(current_request_id.as_deref());
    let status = body
        .get("status")
        .and_then(|value| value.as_i64())
        .and_then(|value| u16::try_from(value).ok());
    let duration_ms = body.get("durationMs").and_then(Value::as_i64);
    let metadata = body.get("metadata");
    let error = body.get("error");

    insert_app_log(
        &state,
        level,
        &source,
        &category,
        message,
        request_id,
        body.get("method").and_then(Value::as_str),
        body.get("path").and_then(Value::as_str),
        status,
        duration_ms,
        metadata,
        error,
    )?;

    Ok(Json(json!({ "success": true })))
}

async fn api_app_logs_delete(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    conn.execute("DELETE FROM app_logs", [])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
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
    let offset = match query.get("offset") {
        Some(raw) => {
            let parsed = raw
                .parse::<usize>()
                .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "offset 必须是整数"))?;
            if parsed > 1_000_000 {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "offset 必须小于等于 1000000",
                ));
            }
            parsed
        }
        None => 0,
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
    let request_id_filter = match query.get("requestId").or_else(|| query.get("request_id")) {
        None => None,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "requestId 不能为空"));
            }
            Some(trimmed.to_ascii_lowercase())
        }
    };
    let require_non_empty_alias =
        |label: &str, keys: &[&str]| -> Result<Option<String>, ApiError> {
            for key in keys {
                let Some(value) = query.get(*key) else {
                    continue;
                };
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        format!("{} 不能为空", label),
                    ));
                }
                return Ok(Some(trimmed.to_ascii_lowercase()));
            }
            Ok(None)
        };
    let project_id_filter = require_non_empty_alias("projectId", &["projectId", "project_id"])?;
    let scene_id_filter = require_non_empty_alias("sceneId", &["sceneId", "scene_id"])?;
    let task_id_filter = require_non_empty_alias("taskId", &["taskId", "task_id"])?;

    use rusqlite::types::Value as Bind;
    let mut where_parts: Vec<String> = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    if let Some(value) = &provider_filter {
        where_parts.push("lower(provider) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &operation_filter {
        where_parts.push("lower(operation) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &status_filter {
        where_parts.push("lower(status) = ?".to_string());
        binds.push(Bind::Text(value.clone()));
    }
    if let Some(value) = &model_filter {
        where_parts.push("lower(model) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = &request_id_filter {
        where_parts.push("lower(coalesce(request_id, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = &project_id_filter {
        where_parts.push("lower(coalesce(project_id, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = &scene_id_filter {
        where_parts.push("lower(coalesce(scene_id, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(value) = &task_id_filter {
        where_parts.push("lower(coalesce(task_id, '')) LIKE ?".to_string());
        binds.push(Bind::Text(format!("%{}%", value)));
    }
    if let Some(keyword) = &keyword_filter {
        where_parts.push(
            "(lower(provider) LIKE ? OR lower(model) LIKE ? OR lower(operation) LIKE ? \
              OR lower(coalesce(request_id, '')) LIKE ? OR lower(coalesce(project_id, '')) LIKE ? \
              OR lower(coalesce(scene_id, '')) LIKE ? OR lower(coalesce(task_id, '')) LIKE ? \
              OR lower(coalesce(endpoint, '')) LIKE ? \
              OR lower(coalesce(request_json, '')) LIKE ? OR lower(coalesce(request_raw_json, '')) LIKE ? \
              OR lower(coalesce(response_json, '')) LIKE ? OR lower(coalesce(response_raw_json, '')) LIKE ? \
              OR lower(coalesce(error_json, '')) LIKE ?)"
                .to_string(),
        );
        let pattern = format!("%{}%", keyword);
        for _ in 0..13 {
            binds.push(Bind::Text(pattern.clone()));
        }
    }
    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };
    let total = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM model_debug_logs{}", where_clause),
            rusqlite::params_from_iter(binds.clone()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    binds.push(Bind::Integer(limit as i64));
    binds.push(Bind::Integer(offset as i64));

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, timestamp, provider, model, operation, status, duration_ms,
                    endpoint, request_id, project_id, scene_id, task_id, request_json, request_raw_json,
                    response_json, response_raw_json, media_refs_json, error_json,
                    owner_account, owner_display_name
             FROM model_debug_logs{} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            where_clause
        ))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let logs_raw = stmt
        .query_map(rusqlite::params_from_iter(binds), |row| {
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
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, Option<String>>(19)?,
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
        endpoint,
        request_id,
        project_id,
        scene_id,
        task_id,
        request_json,
        request_raw_json,
        response_json,
        response_raw_json,
        media_refs_json,
        error_json,
        owner_account,
        owner_display_name,
    ) in logs_raw
    {
        logs.push(json!({
          "id": id,
          "timestamp": timestamp,
          "provider": provider,
          "model": model,
          "operation": operation,
          "status": status,
          "durationMs": duration_ms,
          "endpoint": endpoint,
          "requestId": request_id,
          "projectId": project_id,
          "sceneId": scene_id,
          "taskId": task_id,
          "request": parse_json(request_json),
          "requestRaw": parse_json(request_raw_json),
          "response": parse_json(response_json),
          "responseRaw": parse_json(response_raw_json),
          "mediaRefs": parse_json(media_refs_json),
          "error": parse_json(error_json),
          "ownerAccount": owner_account,
          "ownerDisplayName": owner_display_name
        }))
    }
    Ok(Json(
        json!({ "success": true, "data": { "logs": logs, "total": total } }),
    ))
}

async fn api_debug_logs_delete(State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    conn.execute("DELETE FROM model_debug_logs", [])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let legacy_dir = state.data_dir.join("llm-debug-logs");
    if legacy_dir.exists() {
        fs::remove_dir_all(&legacy_dir)
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
