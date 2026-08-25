mod backend;
mod desktop_ffmpeg;
mod process_util;

use crate::process_util::hidden_command;
use serde_json::{json, Value};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::{RunEvent, WindowEvent};
use uuid::Uuid;

const DESKTOP_HOST: &str = "127.0.0.1";
const DESKTOP_PORT: u16 = 43127;
const FRONTEND_DEV_HOST: &str = "localhost";
const FRONTEND_DEV_PORT: u16 = 3000;
const STARTUP_TIMEOUT_SECS: u64 = 90;
const XIAOHONGSHU_SESSION_REQUIRED: &str = "__PLAYLET_XHS_SESSION_REQUIRED__";
const XIAOHONGSHU_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (!location.hostname.endsWith('xiaohongshu.com') || window.__PLAYLET_XHS_CAPTURE_READY__) return;
  window.__PLAYLET_XHS_CAPTURE_READY__ = true;

  const capture = async (url, response) => {
    if (!String(url).includes('/api/sns/web/v1/feed')) return;
    try {
      const payload = await response.clone().json();
      window.__PLAYLET_XHS_LAST_FEED__ = {
        ok: response.ok,
        httpStatus: response.status,
        payload
      };
      if (payload?.data?.items?.length) {
        window.__PLAYLET_XHS_CAPTURED_RESULT__ = payload;
      }
    } catch {}
  };

  const nativeFetch = window.fetch;
  window.fetch = async function(...args) {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const response = await nativeFetch.apply(this, args);
    void capture(requestUrl, response);
    return response;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this.__PLAYLET_XHS_URL__ = String(url);
    this.__PLAYLET_XHS_HEADERS__ = [];
    return nativeOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    this.__PLAYLET_XHS_HEADERS__?.push([String(name).toLowerCase(), String(value).length]);
    if (String(name).toLowerCase() === 'x-rap-param') {
      window.__PLAYLET_XHS_RAP_PARAM__ = String(value);
    }
    return nativeSetRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__PLAYLET_XHS_URL__?.includes('/api/sns/web/v1/feed')) {
      this.addEventListener('load', () => {
        try {
          const payload = JSON.parse(this.responseText);
          window.__PLAYLET_XHS_LAST_FEED__ = {
            ok: this.status >= 200 && this.status < 300,
            httpStatus: this.status,
            payload
          };
          if (payload?.data?.items?.length) {
            window.__PLAYLET_XHS_CAPTURED_RESULT__ = payload;
          }
        } catch {}
      }, { once: true });
    }
    return nativeSend.apply(this, args);
  };
})();
"#;

fn desktop_base_url() -> String {
    format!("http://{}:{}", DESKTOP_HOST, DESKTOP_PORT)
}

fn frontend_dev_base_url() -> String {
    format!("http://{}:{}", FRONTEND_DEV_HOST, FRONTEND_DEV_PORT)
}

fn desktop_window_base_url() -> String {
    if cfg!(debug_assertions) {
        frontend_dev_base_url()
    } else {
        desktop_base_url()
    }
}

fn wait_for_tcp(host: &str, port: u16, timeout: Duration, label: &str) -> Result<(), String> {
    let address = format!("{}:{}", host, port);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if TcpStream::connect(&address).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }

    Err(format!(
        "{}启动超时（{} 秒）：{}",
        label,
        timeout.as_secs(),
        address,
    ))
}

fn wait_for_backend(timeout: Duration) -> Result<(), String> {
    wait_for_tcp(DESKTOP_HOST, DESKTOP_PORT, timeout, "本地 Rust 服务")
}

fn wait_for_frontend_dev_server(timeout: Duration) -> Result<(), String> {
    wait_for_tcp(
        FRONTEND_DEV_HOST,
        FRONTEND_DEV_PORT,
        timeout,
        "Vite 开发服务",
    )
}

fn ensure_backend_port_available() -> Result<(), String> {
    let address = format!("{}:{}", DESKTOP_HOST, DESKTOP_PORT);
    if TcpStream::connect(&address).is_ok() {
        return Err(format!(
            "检测到端口已被占用：{}。请先关闭旧的 Playlet 进程后再启动。",
            address
        ));
    }
    Ok(())
}

fn resolve_web_dir(app: &tauri::App) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
        let candidate = cwd.join(".output").join("public");
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }

    app.path()
        .resolve("web/public", BaseDirectory::Resource)
        .map_err(|error| format!("解析前端资源目录失败: {}", error))
}

fn load_env_from_file(path: &std::path::Path) {
    if !path.is_file() {
        return;
    }

    match dotenvy::from_path(path) {
        Ok(_) => {
            eprintln!("[RustBackend] Loaded env file: {}", path.display());
        }
        Err(error) => {
            eprintln!(
                "[RustBackend] Failed to load env file {}: {}",
                path.display(),
                error
            );
        }
    }
}

fn desktop_app_data_root(app: &tauri::App) -> Result<std::path::PathBuf, String> {
    if let Ok(custom_path) = std::env::var("PLAYLET_APP_DATA_DIR") {
        let custom_path = std::path::PathBuf::from(custom_path.trim());
        if !custom_path.as_os_str().is_empty() {
            return Ok(custom_path);
        }
    }

    let app_data_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取本地数据目录失败: {}", error))?;

    if cfg!(debug_assertions) {
        let Some(dir_name) = app_data_root.file_name().and_then(|value| value.to_str()) else {
            return Ok(app_data_root.join("dev"));
        };
        return Ok(app_data_root.with_file_name(format!("{dir_name}-dev")));
    }

    Ok(app_data_root)
}

fn load_desktop_env_files(app: &tauri::App) {
    if let Ok(custom_path) = std::env::var("PLAYLET_ENV_FILE") {
        let custom_path = std::path::PathBuf::from(custom_path.trim());
        load_env_from_file(&custom_path);
    }

    if let Ok(app_local_data_dir) = desktop_app_data_root(app) {
        load_env_from_file(&app_local_data_dir.join(".env"));
    }

    if let Ok(app_config_dir) = app.path().app_config_dir() {
        load_env_from_file(&app_config_dir.join(".env"));
    }
}

fn xiaohongshu_dynamic_fetcher(app: AppHandle) -> backend::XiaohongshuDynamicFetcher {
    Arc::new(move |url, note_id| {
        let app = app.clone();
        Box::pin(async move { fetch_xiaohongshu_dynamic(&app, &url, &note_id).await })
    })
}

async fn fetch_xiaohongshu_dynamic(
    app: &AppHandle,
    page_url: &str,
    note_id: &str,
) -> Result<Value, String> {
    let mut dynamic_page_url: tauri::Url = page_url
        .parse()
        .map_err(|error| format!("解析笔记地址失败: {error}"))?;
    dynamic_page_url.set_path(&format!("/explore/{note_id}"));
    let dynamic_page_url = dynamic_page_url.to_string();
    let external_url = "https://www.xiaohongshu.com/"
        .parse()
        .map_err(|error| format!("解析小红书地址失败: {error}"))?;
    let parser_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取小红书解析数据目录失败: {error}"))?
        .join("xiaohongshu-webview");
    let label = format!("xiaohongshu-parser-{}", Uuid::new_v4().simple());
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(external_url))
        .title("小红书解析")
        .inner_size(900.0, 720.0)
        .visible(false)
        .focused(false)
        .skip_taskbar(false)
        .data_directory(parser_data_dir)
        .initialization_script(XIAOHONGSHU_CAPTURE_SCRIPT)
        .on_navigation(|url| {
            url.host_str()
                .is_some_and(|host| host == "xiaohongshu.com" || host.ends_with(".xiaohongshu.com"))
        })
        .build()
        .map_err(|error| format!("创建小红书解析环境失败: {error}"))?;

    tokio::time::sleep(Duration::from_secs(3)).await;
    window
        .eval("window.location.reload()")
        .map_err(|error| format!("初始化小红书匿名会话失败: {error}"))?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let navigation_script = format!(
        "window.location.replace({})",
        serde_json::to_string(&dynamic_page_url).map_err(|error| error.to_string())?
    );
    window
        .eval(navigation_script)
        .map_err(|error| format!("打开小红书笔记页面失败: {error}"))?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let result = run_xiaohongshu_dynamic_request(&window).await;
    match result {
        Err(error) if error.starts_with(XIAOHONGSHU_SESSION_REQUIRED) => Err(error
            .trim_start_matches(XIAOHONGSHU_SESSION_REQUIRED)
            .to_string()),
        result => {
            let _ = window.destroy();
            result
        }
    }
}

async fn run_xiaohongshu_dynamic_request(window: &WebviewWindow) -> Result<Value, String> {
    let capture_deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < capture_deadline {
        let capture = eval_webview_json(
            window,
            "window.__PLAYLET_XHS_LAST_FEED__ ? JSON.stringify(window.__PLAYLET_XHS_LAST_FEED__) : null",
        )
        .await?;
        let payload = capture.get("payload").unwrap_or(&Value::Null);
        if payload
            .get("data")
            .and_then(|value| value.get("items"))
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
        {
            return Ok(payload.clone());
        }
        let http_status = capture
            .get("httpStatus")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if http_status == 461 {
            window
                .set_title("小红书登录或安全验证")
                .map_err(|error| format!("设置小红书验证窗口失败: {error}"))?;
            window
                .show()
                .map_err(|error| format!("显示小红书验证窗口失败: {error}"))?;
            let _ = window.center();
            let _ = window.set_focus();
            return Err(format!(
                "{XIAOHONGSHU_SESSION_REQUIRED}小红书浏览器会话需要登录或安全验证，请在弹出的窗口中完成后关闭窗口并重新解析"
            ));
        }
        if http_status != 0 && !capture.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            return Err(format!("小红书页面请求返回 HTTP {http_status}"));
        }
        if payload.get("success").and_then(Value::as_bool) == Some(false) {
            let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
            let message = payload
                .get("msg")
                .or_else(|| payload.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("小红书页面请求失败");
            return Err(format!("{message}（错误码 {code}）"));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let page = eval_webview_json(
        window,
        "JSON.stringify({ href: location.href, bodyText: document.body?.innerText?.slice(0, 300) || '' })",
    )
    .await?;
    let body_text = page.get("bodyText").and_then(Value::as_str).unwrap_or("");
    if body_text.contains("当前内容无法展示") || body_text.contains("该内容暂时无法查看")
    {
        return Err("当前内容无法展示，笔记可能已失效、被隐藏或需要登录权限".to_string());
    }
    Err("小红书页面未返回笔记数据，请确认分享链接仍然有效".to_string())
}

async fn eval_webview_json(window: &WebviewWindow, script: &str) -> Result<Value, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    window
        .eval_with_callback(script, move |raw| {
            if let Some(sender) = sender.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(raw);
            }
        })
        .map_err(|error| format!("读取小红书解析结果失败: {error}"))?;
    let raw = tokio::time::timeout(Duration::from_secs(3), receiver)
        .await
        .map_err(|_| "读取小红书解析结果超时".to_string())?
        .map_err(|_| "小红书解析窗口已关闭".to_string())?;
    let outer: Value =
        serde_json::from_str(&raw).map_err(|error| format!("解析 WebView 返回值失败: {error}"))?;
    match outer {
        Value::String(value) => {
            serde_json::from_str(&value).map_err(|error| format!("解析小红书动态数据失败: {error}"))
        }
        Value::Null => Ok(json!({ "status": "pending" })),
        value => Ok(value),
    }
}

fn start_embedded_backend(app: &tauri::App) -> Result<(), String> {
    ensure_backend_port_available()?;

    let app_data_root = desktop_app_data_root(app)?;
    let data_dir = app_data_root.join("data");
    let public_dir = app_data_root.join("public");
    let web_dir = resolve_web_dir(app)?;
    let db_path = data_dir.join("playlet.db");

    let state = backend::BackendState {
        db_path,
        data_dir,
        public_dir,
        web_dir,
        xiaohongshu_dynamic_fetcher: Some(xiaohongshu_dynamic_fetcher(app.handle().clone())),
    };

    tauri::async_runtime::spawn(async move {
        if let Err(error) = backend::start_server(state, DESKTOP_HOST, DESKTOP_PORT).await {
            eprintln!("[RustBackend] 服务退出: {}", error);
        }
    });

    Ok(())
}

fn create_main_window(app: &tauri::App) -> Result<(), String> {
    let base_url = desktop_window_base_url();
    let url = base_url
        .parse()
        .map_err(|error| format!("解析服务地址失败: {}", error))?;

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Playlet")
        .inner_size(1280.0, 860.0)
        .min_inner_size(1024.0, 720.0)
        .resizable(true)
        .build()
        .map_err(|error| format!("创建主窗口失败: {}", error))?;

    Ok(())
}

#[tauri::command]
async fn open_local_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = normalize_open_target(&path, false)?;
    open_path_with_fallback(&app, &target).map_err(|error| format!("打开文件失败: {}", error))
}

#[tauri::command]
async fn open_local_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = normalize_open_target(&path, true)?;
    open_path_with_fallback(&app, &target).map_err(|error| format!("打开目录失败: {}", error))
}

#[tauri::command]
async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let target = url
        .trim()
        .parse::<tauri::Url>()
        .map_err(|error| format!("外部链接无效: {}", error))?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("仅允许打开 HTTP 或 HTTPS 链接".to_string());
    }

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(target.as_str(), None::<&str>)
        .map_err(|error| format!("打开外部链接失败: {}", error))
}

fn open_path_with_fallback(app: &tauri::AppHandle, target: &PathBuf) -> Result<(), String> {
    let path = target.to_string_lossy().to_string();
    if tauri_plugin_opener::OpenerExt::opener(app)
        .open_path(path.clone(), None::<&str>)
        .is_ok()
    {
        return Ok(());
    }

    open_path_with_system_command(target)
}

fn open_path_with_system_command(target: &PathBuf) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = hidden_command("open");
        command.arg(target);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = hidden_command("explorer");
        command.arg(target);
        command
    } else {
        let mut command = hidden_command("xdg-open");
        command.arg(target);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn normalize_open_target(path: &str, directory: bool) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }

    let target = PathBuf::from(trimmed);
    if directory {
        if target.is_dir() {
            return Ok(target);
        }
        if target.is_file() {
            return target
                .parent()
                .map(PathBuf::from)
                .ok_or_else(|| "无法定位文件所在目录".to_string());
        }
        return Err(format!("目录不存在: {}", trimmed));
    }

    if target.exists() {
        return Ok(target);
    }
    Err(format!("路径不存在: {}", trimmed))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    if cfg!(debug_assertions) {
        builder = builder.plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        );
    }

    let app = builder
        .invoke_handler(tauri::generate_handler![
            open_local_path,
            open_local_directory,
            open_external_url,
            desktop_ffmpeg::check_ffmpeg_status,
            desktop_ffmpeg::install_ffmpeg
        ])
        .setup(|app| {
            load_desktop_env_files(app);
            desktop_ffmpeg::configure_managed_ffmpeg(&app.handle())
                .map_err(std::io::Error::other)?;
            start_embedded_backend(app).map_err(std::io::Error::other)?;
            wait_for_backend(Duration::from_secs(STARTUP_TIMEOUT_SECS))
                .map_err(std::io::Error::other)?;
            if cfg!(debug_assertions) {
                wait_for_frontend_dev_server(Duration::from_secs(STARTUP_TIMEOUT_SECS))
                    .map_err(std::io::Error::other)?;
            }
            create_main_window(app).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } = event
        {
            if label == "main" {
                app_handle.exit(0);
            }
        }
    });
}
