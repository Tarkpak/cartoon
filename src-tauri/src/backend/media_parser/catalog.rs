//! Supported-platform catalog for the download page.

use super::core::{json, platform_cookie, Value};
use super::urls;

/// Login credential a platform reads from `.env`.
struct Credential {
    platform: &'static str,
    key: &'static str,
    env: &'static str,
    /// Upstream fails without it (vs. only improving success rate).
    required: bool,
}

const CREDENTIALS: &[Credential] = &[
    Credential { platform: "小红书", key: "xhs", env: "XHS_COOKIE", required: true },
    Credential { platform: "视频号", key: "yuanbao", env: "YUANBAO_COOKIE", required: true },
    Credential { platform: "拼多多", key: "pinduoduo", env: "PINDUODUO_COOKIE", required: true },
    Credential { platform: "抖音", key: "douyin", env: "DOUYIN_COOKIE", required: false },
    Credential { platform: "快手", key: "kuaishou", env: "KUAISHOU_COOKIE", required: false },
    Credential { platform: "微博", key: "weibo", env: "WEIBO_COOKIE", required: false },
    Credential { platform: "豆包", key: "doubao", env: "DOUBAO_COOKIE", required: false },
    Credential { platform: "即梦AI", key: "jimeng", env: "JIMENG_COOKIE", required: false },
    Credential { platform: "腾讯元宝", key: "yuanbao", env: "YUANBAO_COOKIE", required: false },
];

pub const GROUPS: &[(&str, &str, &[&str])] = &[
    ("video", "短视频", &[
        "抖音", "快手", "视频号", "哔哩哔哩", "西瓜视频", "微视", "好看视频", "梨视频", "AcFun", "美拍",
        "虎牙", "绿洲", "皮皮虾", "皮皮搞笑", "最右", "新片场", "央视频", "央视",
    ]),
    ("social", "图文社区", &["小红书", "微博", "知乎", "今日头条", "微信公众号", "网易LOFTER", "Soul", "腾讯频道", "得物"]),
    ("music", "音乐音频", &["网易云音乐", "QQ音乐", "酷狗音乐", "汽水音乐", "全民K歌", "配音秀"]),
    ("ai", "AI 创作", &["豆包", "即梦AI", "可灵AI", "海螺AI", "通义千问", "夸克AI", "腾讯元宝", "星绘AI", "小云雀AI", "松果时刻"]),
    ("template", "剪辑模板", &["剪映", "快影"]),
    ("drama", "短剧小说", &["红果短剧", "红果漫剧", "番茄小说"]),
    ("commerce", "电商", &["闲鱼", "拼多多"]),
];

fn platform_entry(name: &str) -> Value {
    match CREDENTIALS.iter().find(|c| c.platform == name) {
        Some(credential) => json!({
            "name": name,
            "credential": {
                "env": credential.env,
                "required": credential.required,
                "configured": !platform_cookie(credential.key, None).is_empty(),
            }
        }),
        None => json!({ "name": name }),
    }
}

pub fn catalog() -> Value {
    let groups: Vec<Value> = GROUPS
        .iter()
        .map(|(key, label, names)| {
            json!({
                "key": key,
                "label": label,
                "platforms": names.iter().map(|n| platform_entry(n)).collect::<Vec<_>>(),
            })
        })
        .collect();
    let total: usize = GROUPS.iter().map(|(_, _, names)| names.len()).sum();
    json!({ "total": total, "groups": groups })
}

/// Recognise the share link in pasted text with the engine's own rules.
pub fn detect(text: &str) -> Value {
    let Some(url) = urls::get_url(text) else {
        return json!({ "url": null, "platform": null });
    };
    match urls::get_platform(&url) {
        Some(name) => json!({ "url": url, "platform": platform_entry(name) }),
        None => json!({ "url": url, "platform": null }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_lists_every_registered_platform_once() {
        let mut names: Vec<&str> = GROUPS.iter().flat_map(|(_, _, n)| n.iter().copied()).collect();
        names.sort_unstable();
        let mut registered = super::super::platforms::PLATFORMS.to_vec();
        registered.sort_unstable();
        assert_eq!(names, registered);
        assert_eq!(catalog()["total"], 50);
        assert!(CREDENTIALS.iter().all(|c| names.contains(&c.platform)));
    }

    #[test]
    fn detects_platform_from_share_text() {
        let found = detect("3.05 复制打开抖音，看看 https://v.douyin.com/iAbc12/ 作品");
        assert_eq!(found["url"], "https://v.douyin.com/iAbc12/");
        assert_eq!(found["platform"]["name"], "抖音");
        assert_eq!(found["platform"]["credential"]["required"], false);
        assert!(detect("https://example.com/a")["platform"].is_null());
        assert!(detect("没有链接")["url"].is_null());
    }
}
