mod backend;
mod desktop_ffmpeg;

use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DESKTOP_HOST: &str = "127.0.0.1";
const DESKTOP_PORT: u16 = 43127;
const STARTUP_TIMEOUT_SECS: u64 = 90;
const SETTINGS_CONFIG_EXPORT_MAX_BYTES: usize = 2 * 1024 * 1024;

fn desktop_base_url() -> String {
    format!("http://{}:{}", DESKTOP_HOST, DESKTOP_PORT)
}

fn wait_for_server(timeout: Duration) -> Result<(), String> {
    let address = format!("{}:{}", DESKTOP_HOST, DESKTOP_PORT);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if TcpStream::connect(&address).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }

    Err(format!(
        "本地 Rust 服务启动超时（{} 秒）：{}",
        timeout.as_secs(),
        address
    ))
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

fn load_desktop_env_files(app: &tauri::App) {
    if let Ok(custom_path) = std::env::var("PLAYLET_ENV_FILE") {
        let custom_path = std::path::PathBuf::from(custom_path.trim());
        load_env_from_file(&custom_path);
    }

    if let Ok(app_local_data_dir) = app.path().app_local_data_dir() {
        load_env_from_file(&app_local_data_dir.join(".env"));
    }

    if let Ok(app_config_dir) = app.path().app_config_dir() {
        load_env_from_file(&app_config_dir.join(".env"));
    }
}

fn start_embedded_backend(app: &tauri::App) -> Result<(), String> {
    ensure_backend_port_available()?;

    let app_data_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取本地数据目录失败: {}", error))?;
    let data_dir = app_data_root.join("data");
    let public_dir = app_data_root.join("public");
    let web_dir = resolve_web_dir(app)?;
    let db_path = data_dir.join("playlet.db");

    let state = backend::BackendState {
        db_path,
        data_dir,
        public_dir,
        web_dir,
    };

    tauri::async_runtime::spawn(async move {
        if let Err(error) = backend::start_server(state, DESKTOP_HOST, DESKTOP_PORT).await {
            eprintln!("[RustBackend] 服务退出: {}", error);
        }
    });

    Ok(())
}

fn create_main_window(app: &tauri::App) -> Result<(), String> {
    let base_url = desktop_base_url();
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
async fn save_settings_config_export(path: String, content: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("保存路径不能为空".to_string());
    }
    if content.len() > SETTINGS_CONFIG_EXPORT_MAX_BYTES {
        return Err("导出配置内容过大".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|_| "导出配置内容不是有效 JSON".to_string())?;

    let target = std::path::PathBuf::from(path);
    if target
        .extension()
        .and_then(|value| value.to_str())
        .map_or(true, |value| !value.eq_ignore_ascii_case("json"))
    {
        return Err("导出文件必须使用 .json 后缀".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || std::fs::write(target, content))
        .await
        .map_err(|error| format!("写入导出文件失败: {}", error))?
        .map_err(|error| format!("写入导出文件失败: {}", error))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            desktop_ffmpeg::check_ffmpeg_status,
            desktop_ffmpeg::install_ffmpeg,
            save_settings_config_export
        ])
        .setup(|app| {
            load_desktop_env_files(app);
            desktop_ffmpeg::configure_managed_ffmpeg(&app.handle())
                .map_err(std::io::Error::other)?;
            start_embedded_backend(app).map_err(std::io::Error::other)?;
            wait_for_server(Duration::from_secs(STARTUP_TIMEOUT_SECS))
                .map_err(std::io::Error::other)?;
            create_main_window(app).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_, _| {});
}
