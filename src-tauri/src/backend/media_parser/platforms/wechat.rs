//! 视频号 and 微信公众号.

use super::super::core::*;
use std::sync::Arc;

const CHANNELS_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const FEED_INFO_API: &str = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";
const FEED_PAGE: &str = "https://channels.weixin.qq.com/finder-preview/pages/feed";
const SPH_PAGE: &str = "https://channels.weixin.qq.com/finder-preview/pages/sph";

fn feed_info(session: &Session, payload: &Value, referer: &str, page_url: &str) -> Option<Value> {
    let rid = format!("{:08x}", rand::random::<u32>());
    let headers = headers! {
        "Accept" => "application/json, text/plain, */*",
        "Accept-Language" => "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type" => "application/json",
        "Origin" => "https://channels.weixin.qq.com",
        "Referer" => referer,
        "User-Agent" => CHANNELS_UA,
    };
    let result = session
        .post(format!("{FEED_INFO_API}?_rid={rid}&_pageUrl={}", quote(page_url, "")))
        .json(payload)
        .headers(&headers)
        .timeout(20.0)
        .json_value()?;
    let code = result.g("errCode");
    (code.is_null() || code.as_i64() == Some(0)).then_some(result)
}

fn normalize_feed(result: &Value) -> Fields {
    let feed = result.at("data.feedInfo");
    let info = result.at("data.authorInfo");
    let video = first_str([feed.g("videoUrl"), feed.at("h264VideoInfo.videoUrl"), feed.at("h265VideoInfo.videoUrl")]);
    Fields {
        title: feed.g("title").s(),
        desc: feed.g("description").s(),
        videos: video.clone().into_iter().collect(),
        video,
        cover: feed.g("coverUrl").s(),
        author: Some(json!({
            "nickname": info.g("nickname").str_or_empty(),
            "avatar": info.g("headImgUrl").str_or_empty(),
            "author_id": info.g("id").or(&json!("")).clone(),
        })),
        images: feed.g("picInfo").arr().iter().filter_map(|i| i.g("url").s().map(Value::String)).collect(),
        audio: feed.at("bgmInfo.bgmUrl").s(),
        ..Fields::default()
    }
}

fn channels_yuanbao(session: &Session, real_url: &str, cookie: &str) -> Option<Fields> {
    let headers = headers! {
        "Accept" => "application/json, text/plain, */*",
        "Content-Type" => "application/json",
        "Origin" => "https://yuanbao.tencent.com",
        "Referer" => "https://yuanbao.tencent.com/chat",
        "User-Agent" => CHANNELS_UA,
        "Cookie" => cookie,
        "x-source" => "web",
    };
    let response = session
        .post("https://yuanbao.tencent.com/api/weixin/get_parse_result")
        .json(&json!({"type": "video_channel_url", "url": real_url, "scene": 1}))
        .headers(&headers)
        .timeout(20.0)
        .json_value()?;
    let playable = response.at("data.playable_url").s()?;
    let query = query_of(&playable);
    let token = query.get("token")?;
    let export_id = query.get("eid")?;
    let referer = format!(
        "{FEED_PAGE}?{}",
        urlencode(&[
            ("entry_card_type", "48"),
            ("comment_scene", "39"),
            ("appid", "0"),
            ("token", token.as_str()),
            ("entry_scene", "0"),
            ("eid", export_id.as_str()),
        ])
    );
    let payload = json!({"baseReq": {"generalToken": token}, "exportId": export_id});
    feed_info(session, &payload, &referer, FEED_PAGE).map(|r| normalize_feed(&r))
}

fn channels_public(session: &Session, real_url: &str) -> Option<Fields> {
    let parts = UrlParts::parse(real_url);
    let short = re!(r"(?:^|/)sph/([A-Za-z0-9]+)")
        .captures(&parts.path)
        .map(|c| c[1].to_string())
        .or_else(|| parts.qs().get("id"))
        .or_else(|| {
            let response = session.get(real_url).header("User-Agent", CHANNELS_UA).timeout(15.0).ok().ok()?;
            query_of(&response.url).get("id")
        })?;
    let payload = json!({"baseReq": {"generalToken": ""}, "shortUri": short});
    let referer = format!("{SPH_PAGE}?id={}", quote(&short, ""));
    feed_info(session, &payload, &referer, SPH_PAGE).map(|r| normalize_feed(&r))
}

pub fn channels(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let cookie = platform_cookie("yuanbao", None);
    if !cookie.is_empty() {
        if let Some(fields) = channels_yuanbao(&session, real_url, &cookie) {
            return fields;
        }
    }
    channels_public(&session, real_url).unwrap_or_else(|| Fields { title: Some(String::new()), ..Fields::default() })
}

fn amp(text: &str) -> String {
    text.replace("\\x26amp;", "&").replace("&amp;", "&")
}

fn joined_text(element: scraper::ElementRef<'_>, out: &mut Vec<String>) {
    if matches!(element.value().name(), "script" | "style" | "template") {
        return;
    }
    for child in element.children() {
        match child.value() {
            scraper::Node::Text(text) => {
                let text = text.trim();
                if !text.is_empty() {
                    out.push(text.to_string());
                }
            }
            scraper::Node::Element(_) => {
                if let Some(child) = scraper::ElementRef::wrap(child) {
                    joined_text(child, out);
                }
            }
            _ => {}
        }
    }
}

struct MpVideo {
    url: String,
    key: (i64, i64, i64),
}

fn best(items: &[MpVideo]) -> Option<&MpVideo> {
    items.iter().fold(None, |best: Option<&MpVideo>, item| match best {
        Some(b) if b.key >= item.key => Some(b),
        _ => Some(item),
    })
}

pub fn wechat_mp(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let headers = headers! {
        "User-Agent" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let Some(html) = Session::new(ctx).get(real_url).headers(&headers).timeout(12.0).text() else {
        return Fields { title: Some("微信公众号文章".into()), author: Some(author("", "", "")), ..Fields::default() };
    };
    let doc = Html::parse(&html);
    let meta = |property: &str| {
        doc.select("meta")
            .into_iter()
            .find(|m| m.value().attr("property") == Some(property))
            .and_then(|m| m.value().attr("content").map(str::to_string))
    };
    let capture = |pattern: &regex::Regex| pattern.captures(&html).map(|c| c[1].to_string());
    let mut title = capture(re!(r#"(?:var msg_title\s*=\s*|msg_title\s*:\s*|title\s*:\s*(?:xml\s*\?\s*getXmlValue\([^)]*\)\s*:\s*)?)['"](.*?)['"]"#))
        .map(|t| unescape_html(&amp(&t)))
        .unwrap_or_default();
    if title.is_empty() {
        title = meta("og:title").unwrap_or_default();
    }
    if title.is_empty() {
        title = doc.one("h1#activity-name").map(|h| h.text().collect::<String>().trim().to_string()).unwrap_or_else(|| "微信公众号文章".into());
    }
    let mut author_name = capture(re!(r#"(?:var nickname\s*=\s*|nick_name\s*:\s*)['"](.*?)['"]"#)).map(|a| unescape_html(&a)).unwrap_or_default();
    if author_name.is_empty() {
        author_name = meta("og:article:author")
            .or_else(|| doc.select("meta").into_iter().find(|m| m.value().attr("name") == Some("author")).and_then(|m| m.value().attr("content").map(str::to_string)))
            .unwrap_or_default();
    }
    if author_name.is_empty() {
        author_name = doc.one("a#js_name").map(|a| a.text().collect::<String>().trim().to_string()).unwrap_or_default();
    }
    let author_id = capture(re!(r#"(?:var user_name\s*=\s*|user_name\s*:\s*)['"](.*?)['"]"#)).unwrap_or_default();
    let avatar = capture(re!(r#"(?:round_head_img|ori_head_img_url)\s*:\s*['"](.*?)['"]"#)).map(|a| amp(&a)).unwrap_or_default();
    let mut cover = capture(re!(r#"(?:var msg_cdn_url\s*=\s*|cdn_url\s*:\s*)['"](.*?)['"]"#)).map(|c| amp(&c)).unwrap_or_default();
    if cover.is_empty() {
        cover = meta("og:image").unwrap_or_default();
    }
    let content = doc.one("div#js_content").unwrap_or_else(|| doc.one("html").expect("html root"));
    let mut lines = Vec::new();
    joined_text(content, &mut lines);
    let mut images: Vec<String> = Vec::new();
    if let Ok(selector) = scraper::Selector::parse("img") {
        for img in content.select(&selector) {
            let src = img.value().attr("data-src").filter(|s| !s.is_empty()).or_else(|| img.value().attr("src"));
            if let Some(src) = src.filter(|s| s.starts_with("http") && s.contains("qpic.cn")) {
                let full = re!(r"/(?:640|300|0)\?").replace_all(src, "/0?").into_owned();
                if !images.contains(&full) {
                    images.push(full);
                }
            }
        }
    }
    if images.is_empty() && !cover.is_empty() {
        images.push(cover.clone());
    }
    let audio = doc
        .attr("mpvoice", "voice_encode_fileid")
        .filter(|id| !id.is_empty())
        .map(|id| format!("https://res.wx.qq.com/voice/getvoice?mediaid={id}"));
    let mut groups: Vec<(String, Vec<MpVideo>)> = Vec::new();
    for c in re!(r#"(?s)\{[^{}]*?url\s*:\s*['"`](https?://mpvideo\.qpic\.cn/[^'"`]+)['"`][^{}]*?\}"#).captures_iter(&html) {
        let block = &c[0];
        let url = amp(&c[1]);
        let num = |pattern: &regex::Regex| pattern.captures(block).and_then(|m| m[1].parse::<i64>().ok()).unwrap_or(0);
        let width = num(re!(r#"width\s*:\s*['"`]?(\d+)"#));
        let height = num(re!(r#"height\s*:\s*['"`]?(\d+)"#));
        let size = num(re!(r#"filesize\s*:\s*['"`]?(\d+)"#));
        let quality = num(re!(r#"video_quality_level\s*:\s*['"`]?(\d+)"#));
        let key = re!(r"mpvideo\.qpic\.cn/([a-zA-Z0-9_-]+)\.f\d+")
            .captures(&url)
            .or_else(|| re!(r"mpvideo\.qpic\.cn/([a-zA-Z0-9_-]+)").captures(&url))
            .map(|m| m[1].to_string())
            .unwrap_or_else(|| url.split('?').next().unwrap_or("").to_string());
        let item = MpVideo { url, key: (quality, width * height, size) };
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, items)) => items.push(item),
            None => groups.push((key, vec![item])),
        }
    }
    let mut videos: Vec<String> = Vec::new();
    if html.contains("video_page_info") && !html.contains("video_page_infos") && !html.contains("videoPageInfos") {
        let all: Vec<MpVideo> = groups.into_iter().flat_map(|(_, items)| items).collect();
        videos.extend(best(&all).map(|v| v.url.clone()));
    } else if !groups.is_empty() {
        for (_, items) in &groups {
            if let Some(v) = best(items) {
                if !videos.contains(&v.url) {
                    videos.push(v.url.clone());
                }
            }
        }
    } else {
        let mut seen = Vec::new();
        for m in re!(r#"https?://mpvideo\.qpic\.cn/[^\s'"`]+"#).find_iter(&html) {
            let url = amp(m.as_str());
            let key = re!(r"mpvideo\.qpic\.cn/([a-zA-Z0-9_-]+)")
                .captures(&url)
                .map(|c| c[1].to_string())
                .unwrap_or_else(|| url.split('?').next().unwrap_or("").to_string());
            if !seen.contains(&key) {
                seen.push(key);
                videos.push(url);
            }
        }
    }
    Fields {
        title: Some(if title.is_empty() { "微信公众号文章".into() } else { title }),
        desc: opt(Some(lines.join("\n"))),
        author: Some(author(author_name, author_id, avatar)),
        cover: opt(Some(cover)),
        images: images.into_iter().map(Value::String).collect(),
        audio,
        video: videos.first().cloned(),
        videos,
        ..Fields::default()
    }
}
