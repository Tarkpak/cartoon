use std::ffi::OsStr;
use std::process::Command;

const PROXY_ENV_KEYS: [&str; 10] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "TOS_PROXY",
    "tos_proxy",
];

/// Desktop network traffic must connect directly. Clear inherited proxy
/// variables before creating HTTP clients or spawning helper processes.
pub(crate) fn disable_process_proxies() {
    for key in PROXY_ENV_KEYS {
        std::env::remove_var(key);
    }
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(target_os = "windows"))]
    Command::new(program)
}

#[cfg(test)]
mod tests {
    use super::{disable_process_proxies, PROXY_ENV_KEYS};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn disable_process_proxies_removes_all_supported_proxy_variables() {
        let _guard = ENV_LOCK.lock().unwrap();
        const CONTROL_KEY: &str = "PLAYLET_PROXY_TEST_CONTROL";

        for key in PROXY_ENV_KEYS {
            std::env::set_var(key, "http://127.0.0.1:7890");
        }
        std::env::set_var(CONTROL_KEY, "preserved");

        disable_process_proxies();

        for key in PROXY_ENV_KEYS {
            assert!(std::env::var_os(key).is_none(), "{key} was not removed");
        }
        assert_eq!(std::env::var(CONTROL_KEY).as_deref(), Ok("preserved"));
        std::env::remove_var(CONTROL_KEY);
    }
}
