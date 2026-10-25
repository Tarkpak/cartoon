//! 海螺AI, 番茄小说/红果短剧/红果漫剧, 好看视频.

use super::super::core::*;
use std::sync::Arc;

fn find_key(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if k == key && v.is_object() {
                    return Some(v.clone());
                }
                if let Some(found) = find_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_key(item, key)),
        _ => None,
    }
}

pub fn hailuo(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields::default();
    let headers = headers! {
        "User-Agent" => ua_pc_at(0),
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language" => "zh-CN,zh;q=0.9,en;q=0.8",
    };
    let Some(html) = Session::new(ctx).get(real_url).headers(&headers).timeout(5.0).text() else { return out };
    if let Some(asset) = flight_asset(&html) {
        out.title = asset.g("title").s();
        out.desc = asset.g("desc").s();
        let urls = asset.g("videoURLs");
        out.video = first_str([urls.g("downloadURLWithAIWatermark"), asset.g("downloadURL"), asset.g("videoURL"), urls.g("downloadURLWithHailuoWatermark")]);
        out.videos = out.video.clone().into_iter().collect();
        out.cover = first_str([asset.g("coverURL"), asset.g("promptImgURL")]);
        if let Some(user) = asset.g("userIDStr").or(asset.g("userID")).text().filter(|_| asset.g("userIDStr").or(asset.g("userID")).truthy()) {
            out.author = Some(json!({"nickname": "", "author_id": user, "avatar": "", "description": ""}));
        }
        for item in asset.g("originFiles").arr() {
            out.push_image(first_str([item.g("url"), item.g("coverUrl")]));
        }
        return out;
    }
    if let Some(video) = ld_video(&html) {
        out.title = video.g("name").s();
        out.desc = video.g("description").s();
        out.video = video.g("contentUrl").s();
        out.videos = out.video.clone().into_iter().collect();
        out.cover = video.g("thumbnailUrl").s();
        if video.g("author").is_object() {
            let name = video.at("author.name").as_str().unwrap_or("").trim().to_string();
            out.author = Some(json!({"nickname": name, "author_id": "", "avatar": "", "description": ""}));
        }
    }
    out
}

fn flight_asset(html: &str) -> Option<Value> {
    for c in re!(r#"(?s)self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)"#).captures_iter(html) {
        let Ok(decoded) = serde_json::from_str::<String>(&format!("\"{}\"", &c[1])) else { continue };
        if !decoded.contains("videoAsset") {
            continue;
        }
        if let Some(index) = decoded.find(':') {
            if let Some(asset) = parse_json(&decoded[index + 1..]).and_then(|d| find_key(&d, "videoAsset")) {
                return Some(asset);
            }
        }
    }
    re!(r#""videoAsset":\s*(\{.+?\})(?:,\s*"[a-zA-Z0-9_-]+":|\]|\})"#)
        .captures(html)
        .and_then(|c| parse_json(&unicode_unescape(&c[1])))
}

fn ld_video(html: &str) -> Option<Value> {
    for c in re!(r#"(?s)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>"#).captures_iter(html) {
        let mut raw = c[1].trim().to_string();
        if raw.contains("children") {
            if let Some(inner) = re!(r#""children":\s*(".*?")\s*\}\]\)"#)
                .captures(&raw)
                .and_then(|m| serde_json::from_str::<String>(&m[1]).ok())
            {
                raw = inner;
            }
        }
        let Some(data) = parse_json(&raw) else { continue };
        let graph = if data.is_object() {
            if data.has("@graph") { data.g("@graph").arr().to_vec() } else { vec![data.clone()] }
        } else {
            vec![data.clone()]
        };
        if let Some(item) = graph.into_iter().find(|i| i.g("@type").as_str() == Some("VideoObject")) {
            return Some(item);
        }
    }
    None
}

pub fn fanqie(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let headers = headers! {"content-type" => "application/json; charset=UTF-8", "User-Agent" => ua_m()};
    let html = session.get(real_url).headers(&headers).timeout(5.0).text().unwrap_or_default();
    let mut page = parse_page_media(&html);
    if let Some(full) = page
        .video_url
        .as_deref()
        .filter(|u| re!(r"[?&]end=\d+").is_match(u))
        .and_then(|_| fanqie_full_url(&session, &headers, &html))
    {
        page.video_url = Some(full);
    }
    Fields {
        title: Some(page.title.unwrap_or_default()),
        video: page.video_url,
        cover: Some(page.cover_url.unwrap_or_default()),
        author: Some(match page.author {
            Some(name) => json!({"nickname": name}),
            None => json!({}),
        }),
        ..Fields::default()
    }
}

fn fanqie_full_url(session: &Session, headers: &Headers, html: &str) -> Option<String> {
    let series = re!(r#"(?s)"schemeParams"\s*:\s*(\{.*?\})"#)
        .captures(html)
        .and_then(|c| parse_json(&c[1]))
        .and_then(|v| v.g("video_id").text())
        .or_else(|| re!(r#""video_id"\s*:\s*"?(\d+)"?"#).captures(html).map(|c| c[1].to_string()))?;
    let chapter = re!(r#""used_chapter_id"\s*:\s*"?(\d+)"?"#).captures(html)?[1].to_string();
    let page = session
        .get(format!("https://hongguoduanju.com/player/{series}/{chapter}"))
        .headers(headers)
        .timeout(5.0)
        .text()?;
    let url = re!(r#""contentUrl"\s*:\s*"(https[^"]+)""#).captures(&page)?[1].to_string();
    clean_page_url(&url).or_else(|| Some(url.replace("\\u002F", "/")))
}

pub struct Haokan {
    data: Value,
}

fn haokan_url(raw: &str) -> String {
    let url = unquote(raw).replace("\\/", "/");
    if url.starts_with("//") { format!("https:{url}") } else { url }
}

impl Haokan {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Haokan {
        let headers = headers! {
            "content-type" => "application/json; charset=UTF-8",
            "User-Agent" => ua_m(),
            "referer" => "https://haokan.baidu.com/v",
        };
        let html = Session::new(ctx)
            .get(real_url)
            .headers(&headers)
            .send()
            .ok()
            .filter(|r| r.status == 200)
            .map(|r| r.text())
            .unwrap_or_default();
        Haokan { data: Self::extract(&html).unwrap_or(Value::Null) }
    }

    fn extract(html: &str) -> Option<Value> {
        if html.is_empty() {
            return None;
        }
        let captured = re!(r"(?s)window\.jsonData\s*=\s*(\{.*?\});\s*(?:window\.|\n|<)")
            .captures(html)
            .or_else(|| re!(r"(?s)window\.jsonData\s*=\s*(\{.*)").captures(html));
        if let Some(c) = captured {
            let mut raw = c[1].trim().to_string();
            if raw.ends_with(';') {
                raw = raw[..raw.len() - 1].trim().to_string();
            }
            if let Some((head, _)) = raw.split_once("</script>") {
                raw = head.trim().trim_end_matches(';').to_string();
            }
            if let Some(data) = parse_json(&raw) {
                return Some(data);
            }
        }
        if let Some(data) = script_json(html, re!(r"(?s)window\.__PRELOADED_STATE__\s*=\s*(\{.*\};)")).and_then(|r| parse_json(&r)) {
            return Some(data);
        }
        for c in re!(r"(?s)<script[^>]*>(.*?)</script>").captures_iter(html) {
            let text = c[1].trim();
            if text.starts_with('{') && text.ends_with('}') && (text.contains("\"url\"") || text.contains("\"play_url\"") || text.contains("\"vid\"")) {
                if let Some(parsed) = parse_json(text).filter(Value::is_object) {
                    let inner = if parsed.g("data").is_object() { parsed.g("data") } else { &parsed };
                    if inner.g("url").truthy() || inner.g("play_url").truthy() || inner.g("videoInfo").truthy() {
                        return Some(parsed);
                    }
                }
            }
        }
        None
    }

    fn inner(&self) -> &Value {
        if self.data.g("data").is_object() { self.data.g("data") } else { &self.data }
    }

    fn video_info(&self) -> &Value {
        self.inner().g("videoInfo").or(self.inner().g("response"))
    }

    fn meta(&self) -> &Value {
        self.data.g("curVideoMeta").or(self.inner().g("curVideoMeta"))
    }
}

impl Parser for Haokan {
    fn video_url(&mut self) -> Option<String> {
        if !self.data.truthy() {
            return None;
        }
        let info = self.video_info();
        if info.is_object() {
            let clarity = info.g("clarityArr").or(info.g("clarity_arr")).arr();
            let mut sorted: Vec<&Value> = clarity.iter().filter(|c| c.g("url").truthy()).collect();
            sorted.sort_by_key(|c| std::cmp::Reverse(c.g("rank").int()));
            if let Some(best) = sorted.first().and_then(|c| c.g("url").s()) {
                return Some(haokan_url(&best));
            }
            if let Some(url) = first_str([info.g("play_url"), info.g("playurl"), info.g("url")]) {
                return Some(haokan_url(&url));
            }
        }
        let meta = self.meta();
        if let Some(url) = meta.g("clarityUrl").arr().last().and_then(|c| c.g("url").s()) {
            return Some(haokan_url(&url));
        }
        if let Some(url) = meta.g("playurl").s() {
            return Some(haokan_url(&url));
        }
        self.inner()
            .g("url")
            .s()
            .filter(|u| u.contains(".mp4") || u.contains("bdstatic"))
            .map(|u| haokan_url(&u))
    }

    fn title(&mut self) -> Option<String> {
        if !self.data.truthy() {
            return Some(String::new());
        }
        let info = self.video_info();
        if let Some(title) = info.g("title").s() {
            return Some(title);
        }
        if let Some(title) = self.inner().g("title").s() {
            return Some(title);
        }
        Some(self.meta().g("title").str_or_empty())
    }

    fn cover_url(&mut self) -> Option<String> {
        if !self.data.truthy() {
            return Some(String::new());
        }
        let info = self.video_info();
        if let Some(cover) = first_str([info.g("posterImage"), info.g("poster"), info.g("cover")]) {
            return Some(cover.replace("\\/", "/"));
        }
        if let Some(cover) = self.inner().g("poster").s() {
            return Some(cover.replace("\\/", "/"));
        }
        Some(self.meta().g("poster").str_or_empty().replace("\\/", "/"))
    }

    fn author(&mut self) -> Option<Value> {
        if !self.data.truthy() {
            return Some(json!({}));
        }
        let node = self.inner().g("author");
        if node.is_object() && (node.g("name").truthy() || node.g("author_name").truthy()) {
            return Some(author(
                node.g("name").or(node.g("author_name")).str_or_empty(),
                first([node.g("uk"), node.g("mthid"), node.g("id")]).str_or_empty(),
                first([node.g("icon"), node.g("author_photo"), node.g("avatar")]).str_or_empty().replace("\\/", "/"),
            ));
        }
        let mth = self.meta().g("mth");
        if mth.is_object() || !self.meta().has("mth") {
            return Some(author(
                mth.g("author_name").str_or_empty(),
                mth.g("mthid").str_or_empty(),
                mth.g("author_photo").str_or_empty().replace("\\/", "/"),
            ));
        }
        Some(json!({}))
    }
}
