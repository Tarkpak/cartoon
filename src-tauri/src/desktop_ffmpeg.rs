use crate::process_util::hidden_command;
use serde::Serialize;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{self, Cursor};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::ZipArchive;

const WINDOWS_FFMPEG_ZIP_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const MACOS_FFMPEG_ZIP_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/zip";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    available: bool,
    install_supported: bool,
    source: String,
    version: Option<String>,
    path: Option<String>,
    platform: String,
    managed_path: Option<String>,
    message: Option<String>,
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "other"
    }
}

fn install_supported() -> bool {
    cfg!(target_os = "windows") || cfg!(target_os = "macos")
}

fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn ffprobe_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

fn managed_ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {}", error))
        .map(|dir| dir.join("tools").join("ffmpeg"))
}

fn managed_ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_ffmpeg_dir(app)?.join(ffmpeg_binary_name()))
}

fn managed_ffprobe_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_ffmpeg_dir(app)?.join(ffprobe_binary_name()))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// FFmpeg 常见安装目录。GUI 启动的应用（macOS 由 launchd、双击图标启动）
/// 只继承精简版 PATH，不含 Homebrew / MacPorts 等目录，导致系统 ffmpeg 不可见。
fn common_ffmpeg_dirs() -> Vec<PathBuf> {
    let raw: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/usr/bin",
        ]
    } else if cfg!(target_os = "linux") {
        &["/usr/bin", "/usr/local/bin", "/snap/bin"]
    } else {
        &[]
    };
    raw.iter().map(PathBuf::from).collect()
}

/// 把常见安装目录前置到进程 PATH，使打包后的应用里 `Command::new("ffmpeg")`
/// 也能解析到系统 ffmpeg。幂等：只补充真实存在且尚未在 PATH 中的目录。
fn ensure_common_paths_in_env() {
    let dirs = common_ffmpeg_dirs();
    if dirs.is_empty() {
        return;
    }

    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: Vec<PathBuf> = std::env::split_paths(&current).collect();

    let mut combined: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if dir.is_dir() && !existing.iter().any(|entry| entry == &dir) {
            combined.push(dir);
        }
    }

    if combined.is_empty() {
        return;
    }

    combined.extend(existing);
    if let Ok(joined) = std::env::join_paths(combined) {
        std::env::set_var("PATH", joined);
    }
}

/// 系统 ffmpeg 二进制的绝对候选路径（常见目录 + 二进制名）。
fn system_ffmpeg_candidates() -> Vec<PathBuf> {
    common_ffmpeg_dirs()
        .into_iter()
        .map(|dir| dir.join(ffmpeg_binary_name()))
        .collect()
}

fn probe_ffmpeg_version<S: AsRef<OsStr>>(program: S) -> Option<String> {
    let output = hidden_command(program).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn resolve_system_ffmpeg_path() -> Option<String> {
    let (command_name, args): (&str, &[&str]) = if cfg!(target_os = "windows") {
        ("where", &["ffmpeg"])
    } else {
        ("which", &["ffmpeg"])
    };

    let output = hidden_command(command_name).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn missing_status(app: &AppHandle, message: Option<String>) -> Result<FfmpegStatus, String> {
    Ok(FfmpegStatus {
        available: false,
        install_supported: install_supported(),
        source: "missing".to_string(),
        version: None,
        path: None,
        platform: current_platform().to_string(),
        managed_path: Some(path_to_string(&managed_ffmpeg_path(app)?)),
        message,
    })
}

pub fn configure_managed_ffmpeg(app: &AppHandle) -> Result<(), String> {
    ensure_common_paths_in_env();
    let ffmpeg_path = managed_ffmpeg_path(app)?;
    if ffmpeg_path.is_file() && probe_ffmpeg_version(&ffmpeg_path).is_some() {
        std::env::set_var("FFMPEG_PATH", &ffmpeg_path);
    }

    let ffprobe_path = managed_ffprobe_path(app)?;
    if ffprobe_path.is_file() {
        std::env::set_var("FFPROBE_PATH", &ffprobe_path);
    }

    Ok(())
}

fn detect_ffmpeg_status(app: &AppHandle) -> Result<FfmpegStatus, String> {
    configure_managed_ffmpeg(app)?;
    let managed_path = managed_ffmpeg_path(app)?;
    let managed_path_string = path_to_string(&managed_path);

    if let Ok(env_value) = std::env::var("FFMPEG_PATH") {
        let trimmed = env_value.trim();
        if !trimmed.is_empty() {
            let env_path = PathBuf::from(trimmed);
            if let Some(version) = probe_ffmpeg_version(&env_path) {
                let source = if env_path == managed_path {
                    "managed"
                } else {
                    "env"
                };
                return Ok(FfmpegStatus {
                    available: true,
                    install_supported: install_supported(),
                    source: source.to_string(),
                    version: Some(version),
                    path: Some(path_to_string(&env_path)),
                    platform: current_platform().to_string(),
                    managed_path: Some(managed_path_string),
                    message: None,
                });
            }
        }
    }

    if let Some(version) = probe_ffmpeg_version("ffmpeg") {
        return Ok(FfmpegStatus {
            available: true,
            install_supported: install_supported(),
            source: "system".to_string(),
            version: Some(version),
            path: resolve_system_ffmpeg_path().or(Some("ffmpeg".to_string())),
            platform: current_platform().to_string(),
            managed_path: Some(managed_path_string),
            message: None,
        });
    }

    // 兜底：直接探测常见安装位置。GUI 启动的应用拿不到登录 shell 的 PATH，
    // 命中后固定为绝对路径（写入 FFMPEG_PATH），使后续真正调用 ffmpeg 也不依赖 PATH。
    for candidate in system_ffmpeg_candidates() {
        if let Some(version) = probe_ffmpeg_version(&candidate) {
            std::env::set_var("FFMPEG_PATH", &candidate);
            let ffprobe = candidate.with_file_name(ffprobe_binary_name());
            if ffprobe.is_file() {
                std::env::set_var("FFPROBE_PATH", &ffprobe);
            }
            return Ok(FfmpegStatus {
                available: true,
                install_supported: install_supported(),
                source: "system".to_string(),
                version: Some(version),
                path: Some(path_to_string(&candidate)),
                platform: current_platform().to_string(),
                managed_path: Some(managed_path_string.clone()),
                message: None,
            });
        }
    }

    let message = if install_supported() {
        Some("未检测到可用的 FFmpeg，可由 Playlet 自动下载并安装到当前用户目录。".to_string())
    } else {
        Some("当前平台未提供内置安装流程，请手动安装 FFmpeg 并加入系统 PATH。".to_string())
    };

    missing_status(app, message)
}

fn ffmpeg_download_url() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        Ok(WINDOWS_FFMPEG_ZIP_URL)
    } else if cfg!(target_os = "macos") {
        Ok(MACOS_FFMPEG_ZIP_URL)
    } else {
        Err("当前平台暂不支持一键安装 FFmpeg。".to_string())
    }
}

fn mark_executable_if_needed(path: &Path) -> Result<(), String> {
    #[cfg(not(unix))]
    let _ = path;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path)
            .map_err(|error| format!("读取文件权限失败: {}", error))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("写入可执行权限失败: {}", error))?;
    }

    Ok(())
}

fn extract_ffmpeg_archive(bytes: &[u8], target_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(target_dir).map_err(|error| format!("创建临时目录失败: {}", error))?;

    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("解析 FFmpeg 压缩包失败: {}", error))?;

    let mut extracted_ffmpeg = false;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取压缩包条目失败: {}", error))?;
        if file.is_dir() {
            continue;
        }

        let entry_name = file.name().replace('\\', "/");
        let Some(base_name) = entry_name.rsplit('/').next() else {
            continue;
        };

        let should_extract = base_name.eq_ignore_ascii_case(ffmpeg_binary_name())
            || base_name.eq_ignore_ascii_case(ffprobe_binary_name());
        if !should_extract {
            continue;
        }

        let output_path = target_dir.join(base_name);
        let mut output = File::create(&output_path)
            .map_err(|error| format!("写入 {} 失败: {}", base_name, error))?;
        io::copy(&mut file, &mut output)
            .map_err(|error| format!("解压 {} 失败: {}", base_name, error))?;
        mark_executable_if_needed(&output_path)?;

        if base_name.eq_ignore_ascii_case(ffmpeg_binary_name()) {
            extracted_ffmpeg = true;
        }
    }

    if !extracted_ffmpeg {
        return Err("压缩包中未找到 FFmpeg 可执行文件。".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn check_ffmpeg_status(app: AppHandle) -> Result<FfmpegStatus, String> {
    detect_ffmpeg_status(&app)
}

#[tauri::command]
pub async fn install_ffmpeg(app: AppHandle) -> Result<FfmpegStatus, String> {
    if !install_supported() {
        return Err("当前平台暂不支持一键安装 FFmpeg。".to_string());
    }

    let download_url = ffmpeg_download_url()?;
    let install_dir = managed_ffmpeg_dir(&app)?;
    let parent_dir = install_dir
        .parent()
        .ok_or_else(|| "解析 FFmpeg 安装目录失败。".to_string())?
        .to_path_buf();
    fs::create_dir_all(&parent_dir).map_err(|error| format!("创建工具目录失败: {}", error))?;

    let staging_dir = parent_dir.join(format!("ffmpeg-install-{}", Uuid::new_v4()));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|error| format!("清理旧临时目录失败: {}", error))?;
    }

    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|error| format!("创建下载客户端失败: {error}"))?
        .get(download_url)
        .send()
        .await
        .map_err(|error| format!("下载 FFmpeg 失败: {}", error))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("下载 FFmpeg 失败: {}", error))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取 FFmpeg 下载内容失败: {}", error))?;

    extract_ffmpeg_archive(bytes.as_ref(), &staging_dir)?;

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("替换旧 FFmpeg 目录失败: {}", error))?;
    }
    fs::rename(&staging_dir, &install_dir)
        .map_err(|error| format!("完成 FFmpeg 安装失败: {}", error))?;

    let ffmpeg_path = install_dir.join(ffmpeg_binary_name());
    std::env::set_var("FFMPEG_PATH", &ffmpeg_path);

    let ffprobe_path = install_dir.join(ffprobe_binary_name());
    if ffprobe_path.is_file() {
        std::env::set_var("FFPROBE_PATH", &ffprobe_path);
    }

    detect_ffmpeg_status(&app)
}
