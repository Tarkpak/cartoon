//! Platform parsers registered by upstream platform name.

use super::core::{Ctx, Parser};
use std::sync::Arc;

mod aigc;
mod bilibili;
mod bytedance;
mod doubao;
mod douyin;
mod editors;
mod jimeng;
mod misc;
mod music;
mod kuaishou;
mod pages;
mod qianwen;
mod small;
mod social;
mod wechat;
mod weibo;
mod xiaohongshu;
mod yangshipin;
mod yuanbao;

/// Every platform registered upstream (`@register_parser`).
#[cfg(test)]
pub const PLATFORMS: &[&str] = &[
    "抖音", "小红书", "快手", "哔哩哔哩", "微博", "虎牙", "全民K歌", "绿洲", "微视", "AcFun", "可灵AI", "星绘AI",
    "得物", "央视", "海螺AI", "番茄小说", "红果短剧", "红果漫剧", "好看视频", "豆包", "即梦AI", "剪映", "快影",
    "酷狗音乐", "网易云音乐", "QQ音乐", "汽水音乐", "梨视频", "网易LOFTER", "美拍", "配音秀", "拼多多", "松果时刻",
    "皮皮搞笑", "皮皮虾", "Soul", "腾讯频道", "闲鱼", "通义千问", "夸克AI", "今日头条", "西瓜视频", "视频号",
    "微信公众号", "小云雀AI", "新片场", "知乎", "最右", "央视频", "腾讯元宝",
];

pub fn create(platform: &str, real_url: &str, ctx: &Arc<Ctx>) -> Option<Box<dyn Parser>> {
    Some(match platform {
        "抖音" => Box::new(douyin::Douyin::new(real_url, ctx)),
        "小红书" => Box::new(xiaohongshu::Xiaohongshu::new(real_url, ctx)),
        "快手" => Box::new(kuaishou::Kuaishou::new(real_url, ctx)),
        "哔哩哔哩" => Box::new(bilibili::Bilibili::new(real_url, ctx)),
        "微博" => Box::new(weibo::Weibo::new(real_url, ctx)),
        "虎牙" => Box::new(small::huya(real_url, ctx)),
        "全民K歌" => Box::new(small::quanminkge(real_url, ctx)),
        "绿洲" => Box::new(small::Lvzhou::new(real_url, ctx)),
        "微视" => Box::new(small::Weishi::new(real_url, ctx)),
        "AcFun" => Box::new(small::Acfun::new(real_url, ctx)),
        "可灵AI" => Box::new(small::Kling::new(real_url, ctx)),
        "星绘AI" => Box::new(aigc::butterflyai(real_url, ctx)),
        "得物" => Box::new(aigc::dewu(real_url, ctx)),
        "央视" => Box::new(aigc::cctv(real_url, ctx)),
        "海螺AI" => Box::new(pages::hailuo(real_url, ctx)),
        "番茄小说" | "红果短剧" | "红果漫剧" => Box::new(pages::fanqie(real_url, ctx)),
        "好看视频" => Box::new(pages::Haokan::new(real_url, ctx)),
        "豆包" => Box::new(doubao::doubao(real_url, ctx)),
        "即梦AI" => Box::new(jimeng::jimeng(real_url, ctx)),
        "剪映" => Box::new(editors::jianying(real_url, ctx)),
        "快影" => Box::new(editors::kwaiying(real_url, ctx)),
        "酷狗音乐" => Box::new(music::kugou(real_url, ctx)),
        "网易云音乐" => Box::new(music::netease(real_url, ctx)),
        "QQ音乐" => Box::new(music::qqmusic(real_url, ctx)),
        "汽水音乐" => Box::new(music::qsmusic(real_url, ctx)),
        "梨视频" => Box::new(misc::lishipin(real_url, ctx)),
        "网易LOFTER" => Box::new(misc::lofter(real_url, ctx)),
        "美拍" => Box::new(misc::meipai(real_url, ctx)),
        "配音秀" => Box::new(misc::peiyinxiu(real_url, ctx)),
        "拼多多" => Box::new(social::pinduoduo(real_url, ctx)),
        "松果时刻" => Box::new(social::pinecone(real_url, ctx)),
        "皮皮搞笑" => Box::new(social::pipigaoxiao(real_url, ctx)),
        "皮皮虾" => Box::new(social::pipixia(real_url, ctx)),
        "Soul" => Box::new(social::soul(real_url, ctx)?),
        "腾讯频道" => Box::new(social::tencent_channel(real_url, ctx)),
        "闲鱼" => Box::new(social::xianyu(real_url, ctx)),
        "通义千问" | "夸克AI" => Box::new(qianwen::qianwen(real_url, ctx)),
        "今日头条" => Box::new(bytedance::toutiao(real_url, ctx)),
        "西瓜视频" => Box::new(bytedance::xigua(real_url, ctx)),
        "视频号" => Box::new(wechat::channels(real_url, ctx)),
        "微信公众号" => Box::new(wechat::wechat_mp(real_url, ctx)),
        "小云雀AI" => Box::new(aigc::xiaoyunque(real_url, ctx)),
        "新片场" => Box::new(aigc::xinpianchang(real_url, ctx)),
        "知乎" => Box::new(misc::zhihu(real_url, ctx)),
        "最右" => Box::new(misc::zuiyou(real_url, ctx)),
        "央视频" => Box::new(yangshipin::yangshipin(real_url, ctx)),
        "腾讯元宝" => Box::new(yuanbao::yuanbao(real_url, ctx)),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::core::Ctx;
    use super::super::urls;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    /// Sources scanned for `re!`/`fre!` literals, which only compile on first use.
    const SOURCES: &[&str] = &[
        include_str!("../core.rs"),
        include_str!("../urls.rs"),
        include_str!("aigc.rs"),
        include_str!("bilibili.rs"),
        include_str!("bytedance.rs"),
        include_str!("doubao.rs"),
        include_str!("douyin.rs"),
        include_str!("editors.rs"),
        include_str!("jimeng.rs"),
        include_str!("kuaishou.rs"),
        include_str!("misc.rs"),
        include_str!("music.rs"),
        include_str!("pages.rs"),
        include_str!("qianwen.rs"),
        include_str!("small.rs"),
        include_str!("social.rs"),
        include_str!("wechat.rs"),
        include_str!("weibo.rs"),
        include_str!("xiaohongshu.rs"),
        include_str!("yangshipin.rs"),
        include_str!("yuanbao.rs"),
    ];

    fn literals(source: &str, macro_name: &str) -> Vec<String> {
        let mut found = Vec::new();
        let needle = format!("{macro_name}!(");
        let mut rest = source;
        while let Some(index) = rest.find(&needle) {
            let after = &rest[index + needle.len()..];
            let hashes = after.strip_prefix('r').map(|r| r.chars().take_while(|c| *c == '#').count());
            if let Some(hashes) = hashes {
                let open = format!("r{}\"", "#".repeat(hashes));
                let close = format!("\"{}", "#".repeat(hashes));
                if let Some(body) = after.strip_prefix(&open) {
                    if let Some(end) = body.find(&close) {
                        found.push(body[..end].to_string());
                    }
                }
            }
            rest = &rest[index + needle.len()..];
        }
        found
    }

    #[test]
    fn every_regex_literal_compiles() {
        let mut total = 0;
        for source in SOURCES {
            for pattern in literals(source, "re") {
                regex::Regex::new(&pattern).unwrap_or_else(|e| panic!("{pattern}: {e}"));
                total += 1;
            }
            for pattern in literals(source, "fre") {
                fancy_regex::Regex::new(&pattern).unwrap_or_else(|e| panic!("{pattern}: {e}"));
                total += 1;
            }
        }
        assert!(total >= 140, "only {total} patterns found");
    }

    #[test]
    fn registers_every_upstream_platform_without_network() {
        // A cancelled budget makes every request fail before it leaves the process.
        let ctx = Ctx::new(std::time::Duration::from_secs(5), Arc::new(AtomicBool::new(true)));
        for platform in super::PLATFORMS {
            let url = if *platform == "Soul" {
                "https://w13.soulsmile.cn/x#/post?postIdEcpt=a&sign=b&signVersion=1"
            } else {
                "https://example.com/item?id=123&feed_id=1"
            };
            assert!(super::create(platform, url, &ctx).is_some(), "{platform} not registered");
        }
        assert_eq!(super::PLATFORMS.len(), 50);
        assert!(super::create("未知平台", "https://example.com", &ctx).is_none());
        assert!(super::create("Soul", "https://w13.soulsmile.cn/x", &ctx).is_none());
    }

    #[test]
    fn every_configured_domain_has_a_parser() {
        for host in ["www.douyin.com", "www.xiaohongshu.com", "v.kuaishou.com", "b23.tv", "weibo.com", "channels.weixin.qq.com"] {
            let platform = urls::get_platform(&format!("https://{host}/x")).unwrap();
            assert!(super::PLATFORMS.contains(&platform), "{host} -> {platform}");
        }
        let raw: serde_json::Value = serde_json::from_str(include_str!("../assets/business_config.json")).unwrap();
        for platform in raw["DOMAIN_TO_NAME"].as_object().unwrap().values() {
            let platform = platform.as_str().unwrap();
            assert!(super::PLATFORMS.contains(&platform), "{platform} has no parser");
        }
    }
}
