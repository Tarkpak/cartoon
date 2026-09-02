#[path = "../backend.rs"]
mod backend;
#[path = "../process_util.rs"]
mod process_util;

use backend::{start_server, BackendState};
use std::env;
use std::path::PathBuf;

fn resolve_project_root() -> Result<PathBuf, String> {
    env::current_dir().map_err(|error| format!("获取当前目录失败: {}", error))
}

fn resolve_web_dir(project_root: &PathBuf) -> PathBuf {
    if let Ok(value) = env::var("PLAYLET_WEB_DIR") {
        let custom = PathBuf::from(value);
        if custom.is_dir() {
            return custom;
        }
    }

    let output_public = project_root.join(".output").join("public");
    if output_public.is_dir() {
        return output_public;
    }

    project_root.join("public")
}

fn read_env_u16(key: &str, fallback: u16) -> u16 {
    env::var(key)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(fallback)
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    process_util::disable_process_proxies();

    let host = env::var("PLAYLET_BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = read_env_u16("PLAYLET_BACKEND_PORT", 43127);

    let project_root = match resolve_project_root() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[RustBackend] {}", error);
            std::process::exit(1);
        }
    };

    let data_dir = env::var("PLAYLET_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| project_root.join("data"));
    let public_dir = env::var("PLAYLET_PUBLIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| project_root.join("public"));
    let web_dir = resolve_web_dir(&project_root);
    let db_path = env::var("PLAYLET_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("playlet.db"));

    let state = BackendState {
        db_path,
        data_dir,
        public_dir,
        web_dir,
        xiaohongshu_dynamic_fetcher: None,
    };

    println!(
        "[RustBackend] starting at http://{}:{} (web_dir={})",
        host,
        port,
        state.web_dir.display()
    );

    if let Err(error) = start_server(state, &host, port).await {
        eprintln!("[RustBackend] {}", error);
        std::process::exit(1);
    }
}
