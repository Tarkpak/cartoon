mod backend;
mod desktop_ffmpeg;

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::{RunEvent, WindowEvent};

const DESKTOP_HOST: &str = "127.0.0.1";
const DESKTOP_PORT: u16 = 43127;
const FRONTEND_DEV_HOST: &str = "localhost";
const FRONTEND_DEV_PORT: u16 = 3000;
const STARTUP_TIMEOUT_SECS: u64 = 90;

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
        let mut command = Command::new("open");
        command.arg(target);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(target);
        command
    } else {
        let mut command = Command::new("xdg-open");
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
