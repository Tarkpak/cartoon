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
const XIAOHONGSHU_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (!location.hostname.endsWith('xiaohongshu.com') || window.__PLAYLET_XHS_CAPTURE_READY__) return;
  window.__PLAYLET_XHS_CAPTURE_READY__ = true;

  const capture = async (url, response) => {
    if (!String(url).includes('/api/sns/web/v1/feed')) return;
    try {
      const payload = await response.clone().json();
      window.__PLAYLET_XHS_LAST_FEED__ = payload;
      if (payload?.data?.items?.length) {
        window.__PLAYLET_XHS_CAPTURED_RESULT__ = payload;
      }
    } catch {}
  };

  const nativeFetch = window.fetch;
  window.fetch = async function(...args) {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (String(requestUrl).includes('/api/sns/web/v1/')) {
      const headers = new Headers(args[1]?.headers || (typeof args[0] === 'object' ? args[0]?.headers : undefined));
      window.__PLAYLET_XHS_OBSERVED_HEADERS__ = {
        url: String(requestUrl),
        headers: Array.from(headers.entries()).map(([name, value]) => [name, value.length])
      };
    }
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
    if (this.__PLAYLET_XHS_URL__?.includes('/api/sns/web/v1/')) {
      window.__PLAYLET_XHS_OBSERVED_HEADERS__ = {
        url: this.__PLAYLET_XHS_URL__,
        headers: this.__PLAYLET_XHS_HEADERS__ || []
      };
    }
    if (this.__PLAYLET_XHS_URL__?.includes('/api/sns/web/v1/feed')) {
      this.addEventListener('load', () => {
        try {
          const payload = JSON.parse(this.responseText);
          window.__PLAYLET_XHS_LAST_FEED__ = payload;
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
        .position(-10_000.0, -10_000.0)
        .visible(true)
        .focused(false)
        .skip_taskbar(true)
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
    let result = run_xiaohongshu_dynamic_request(&window, &dynamic_page_url, note_id).await;
    let _ = window.destroy();
    result
}

async fn run_xiaohongshu_dynamic_request(
    window: &WebviewWindow,
    page_url: &str,
    note_id: &str,
) -> Result<Value, String> {
    tokio::time::sleep(Duration::from_millis(800)).await;
    let capture_deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < capture_deadline {
        let payload = eval_webview_json(
            window,
            "window.__PLAYLET_XHS_CAPTURED_RESULT__ ? JSON.stringify(window.__PLAYLET_XHS_CAPTURED_RESULT__) : null",
        )
        .await?;
        if payload
            .get("data")
            .and_then(|value| value.get("items"))
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
        {
            return Ok(payload);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let page_url_json = serde_json::to_string(page_url).map_err(|error| error.to_string())?;
    let note_id_json = serde_json::to_string(note_id).map_err(|error| error.to_string())?;
    let script = format!(
        r#"
        (() => {{
          if (window.__PLAYLET_XHS_REQUEST_STARTED__) return;
          window.__PLAYLET_XHS_REQUEST_STARTED__ = true;
          window.__PLAYLET_XHS_RESULT__ = {{ status: 'pending' }};
          (async () => {{
            try {{
              const deadline = Date.now() + 20000;
              while (typeof window._webmsxyw !== 'function' && Date.now() < deadline) {{
                await new Promise(resolve => setTimeout(resolve, 100));
              }}
              if (typeof window._webmsxyw !== 'function') {{
                throw new Error('页面签名函数未就绪');
              }}
              const fingerprintDeadline = Date.now() + 12000;
              while (!localStorage.getItem('b1') && Date.now() < fingerprintDeadline) {{
                await new Promise(resolve => setTimeout(resolve, 100));
              }}

              const sharedUrl = new URL({page_url_json});
              const body = {{
                source_note_id: {note_id_json},
                image_formats: ['jpg', 'webp', 'avif'],
                extra: {{ need_body_topic: 1 }},
                xsec_source: sharedUrl.searchParams.get('xsec_source') || 'pc_feed',
                xsec_token: sharedUrl.searchParams.get('xsec_token') || ''
              }};
              const path = '/api/sns/web/v1/feed';
              const signed = await window._webmsxyw(path, body);
              const crc32 = input => {{
                const table = Array.from({{ length: 256 }}, (_, index) => {{
                  let value = index;
                  for (let bit = 0; bit < 8; bit += 1) {{
                    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
                  }}
                  return value >>> 0;
                }});
                let value = -1;
                for (let index = 0; index < Math.min(57, input.length); index += 1) {{
                  value = table[(value & 255) ^ input.charCodeAt(index)] ^ (value >>> 8);
                }}
                return (value ^ -1 ^ 3988292384) >>> 0;
              }};
              const customBase64 = bytes => {{
                const alphabet = 'ZmserbBoHQtNP+wOcz a/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5'.replace(' ', '');
                let output = '';
                for (let index = 0; index < bytes.length; index += 3) {{
                  const first = bytes[index];
                  const second = bytes[index + 1];
                  const third = bytes[index + 2];
                  const triplet = (first << 16) | ((second || 0) << 8) | (third || 0);
                  output += alphabet[(triplet >>> 18) & 63];
                  output += alphabet[(triplet >>> 12) & 63];
                  output += second === undefined ? '=' : alphabet[(triplet >>> 6) & 63];
                  output += third === undefined ? '=' : alphabet[triplet & 63];
                }}
                return output;
              }};
              const cookieValue = name => document.cookie
                .split(';')
                .map(item => item.trim())
                .find(item => item.startsWith(`${{name}}=`))
                ?.slice(name.length + 1) || '';
              const xS = signed['X-s'] || signed['x-s'];
              const xT = String(signed['X-t'] || signed['x-t'] || '');
              const common = {{
                s0: 5,
                s1: '',
                x0: localStorage.getItem('b1b1') || '1',
                x1: '3.2.0',
                x2: 'Windows',
                x3: 'xhs-pc-web',
                x4: '2.3.1',
                x5: cookieValue('a1'),
                x6: xT,
                x7: xS,
                x8: localStorage.getItem('b1') || '',
                x9: crc32(xT + xS),
                x10: 1
              }};
              const headers = {{ 'Content-Type': 'application/json;charset=UTF-8' }};
              for (const name of ['X-s', 'X-t', 'X-s-common']) {{
                const value = signed[name] || signed[name.toLowerCase()];
                if (value) headers[name] = value;
              }}
              if (!headers['X-s-common']) {{
                headers['X-s-common'] = customBase64(new TextEncoder().encode(JSON.stringify(common)));
              }}
              if (window.__PLAYLET_XHS_RAP_PARAM__) {{
                headers['X-Rap-Param'] = window.__PLAYLET_XHS_RAP_PARAM__;
              }}
              if (!headers['X-s'] || !headers['X-t']) {{
                throw new Error('页面未生成完整签名');
              }}

              const response = await fetch(`https://edith.xiaohongshu.com${{path}}`, {{
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify(body)
              }});
              const responseText = await response.text();
              let payload;
              try {{
                payload = JSON.parse(responseText);
              }} catch {{
                throw new Error(`动态接口返回非 JSON 数据: ${{responseText.slice(0, 160)}}`);
              }}
              window.__PLAYLET_XHS_RESULT__ = {{
                status: 'done',
                ok: response.ok,
                httpStatus: response.status,
                payload,
                diagnostics: {{
                  href: location.href,
                  title: document.title,
                  visibility: document.visibilityState,
                  cookieNames: document.cookie.split(';').map(item => item.split('=')[0].trim()).filter(Boolean),
                  detailTitle: document.querySelector('#detail-title')?.textContent?.trim() || '',
                  bodyText: document.body?.innerText?.slice(0, 200) || '',
                  lastFeed: window.__PLAYLET_XHS_LAST_FEED__ || null,
                  signedKeys: Object.keys(signed),
                  responsePayload: payload,
                  hasB1: Boolean(localStorage.getItem('b1') || localStorage.getItem('b1b1')),
                  observedHeaders: window.__PLAYLET_XHS_OBSERVED_HEADERS__ || null
                }}
              }};
            }} catch (error) {{
              window.__PLAYLET_XHS_RESULT__ = {{
                status: 'error',
                message: error instanceof Error ? error.message : String(error)
              }};
            }}
          }})();
        }})();
        "#
    );
    window
        .eval(script)
        .map_err(|error| format!("启动小红书动态请求失败: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(35);
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let state = eval_webview_json(
            window,
            "window.__PLAYLET_XHS_RESULT__ ? JSON.stringify(window.__PLAYLET_XHS_RESULT__) : null",
        )
        .await?;
        match state.get("status").and_then(Value::as_str) {
            Some("done") => {
                if !state.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                    let status = state.get("httpStatus").and_then(Value::as_u64).unwrap_or(0);
                    let diagnostics = state
                        .get("diagnostics")
                        .map(Value::to_string)
                        .unwrap_or_default();
                    eprintln!("[Xiaohongshu] dynamic feed returned HTTP {status}: {diagnostics}");
                    return Err(format!(
                        "动态接口返回 HTTP {status}，当前匿名会话被小红书限制"
                    ));
                }
                let payload = state.get("payload").cloned().unwrap_or(Value::Null);
                if payload.get("success").and_then(Value::as_bool) == Some(false) {
                    let message = payload
                        .get("msg")
                        .or_else(|| payload.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("动态接口返回失败");
                    return Err(message.to_string());
                }
                return Ok(payload);
            }
            Some("error") => {
                return Err(state
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("动态请求执行失败")
                    .to_string());
            }
            _ => {}
        }
    }
    Err("等待小红书动态接口超时".to_string())
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
