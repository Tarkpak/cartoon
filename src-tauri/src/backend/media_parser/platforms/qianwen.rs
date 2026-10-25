//! 通义千问 / 夸克AI (shared upstream parser).

use super::super::core::*;
use std::sync::Arc;

fn media_path(url: &str) -> Option<String> {
    if !url.starts_with("http") {
        return None;
    }
    Some(unquote(&UrlParts::parse(&url.replace("\\u0026", "&")).path).to_lowercase())
}

pub fn is_video_url(url: &str) -> bool {
    media_path(url).is_some_and(|p| {
        [".mp4", ".mov", ".m4v", ".webm"].iter().any(|e| p.ends_with(e)) || p.contains("/video/") || p.contains(".mp4")
    })
}

pub fn is_image_url(url: &str) -> bool {
    media_path(url).is_some_and(|p| {
        [".jpg", ".jpeg", ".png", ".webp", ".gif"].iter().any(|e| p.ends_with(e)) || p.contains(".jpg") || p.contains(".png")
    })
}

fn deep_media(value: &Value, seen: &mut Vec<String>, videos: &mut Vec<String>, images: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let url = child.as_str().filter(|v| v.starts_with("http"));
                match (matches!(key.as_str(), "url" | "downloadUrl" | "playUrl"), url) {
                    (true, Some(url)) => {
                        let clean = url.replace("\\u0026", "&");
                        if !seen.contains(&clean) {
                            seen.push(clean.clone());
                            if is_video_url(&clean) {
                                videos.push(clean);
                            } else if is_image_url(&clean) {
                                images.push(clean);
                            }
                        }
                    }
                    _ => deep_media(child, seen, videos, images),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|i| deep_media(i, seen, videos, images)),
        _ => {}
    }
}

fn extract(data: &Value, out: &mut Fields) {
    if !data.is_object() {
        return;
    }
    out.title = first_str([data.g("title"), data.g("shareSubtitle"), data.g("shareTitle")]);
    let session = if data.g("session").is_object() { data.g("session") } else { &NULL };
    if out.title.is_none() && session.truthy() {
        out.title = session.g("title").s();
        let record = session.g("record_list").i(0);
        if out.title.is_none() && record.is_object() {
            let query = record.g("query");
            out.title = match query {
                Value::String(q) => Some(q.clone()),
                Value::Object(_) => first_str([query.g("content"), query.g("text")]),
                _ => record.g("request_messages").i(0).g("content").s(),
            };
        }
    }
    let creator = data.g("creator").or(data.at("content.creator"));
    if creator.is_object() && creator.truthy() {
        let id = first([creator.g("authorId"), creator.g("uid")]);
        out.author = Some(author(
            creator.g("nick").str_or_empty(),
            if id.truthy() { id.str_or_empty() } else { String::new() },
            creator.g("avatar").str_or_empty(),
        ));
    }
    let mut raw_images = data.g("images").arr().to_vec();
    if raw_images.is_empty() && data.g("image").truthy() {
        raw_images = vec![data.g("image").clone()];
    }
    let mut images: Vec<String> = raw_images
        .iter()
        .filter_map(|img| match img {
            Value::Object(_) => first_str([img.g("url"), img.g("downloadUrl")]),
            Value::String(s) => Some(s.clone()),
            _ => None,
        })
        .collect();
    let mut videos: Vec<String> = first_str([data.at("playInfo.url"), data.at("playInfo.downloadUrl")]).into_iter().collect();
    let (mut seen, mut deep_videos, mut deep_images) = (Vec::new(), Vec::new(), Vec::new());
    deep_media(data, &mut seen, &mut deep_videos, &mut deep_images);
    if videos.is_empty() {
        videos = deep_videos;
    }
    if images.is_empty() {
        images = deep_images;
    }
    out.images = dedupe(images).into_iter().map(Value::String).collect();
    out.videos = dedupe(videos);
}

pub fn qianwen(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields::default();
    let session = Session::new(ctx);
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    let share_id = query
        .any(&["share_id", "shareId"])
        .or_else(|| re!(r"/share/chat/([a-zA-Z0-9_-]+)").captures(&parts.path).map(|c| c[1].to_string()));
    let biz_id = query.any(&["biz_id", "bizId"]).unwrap_or_else(|| "ai_qwen".into());
    if let Some(share_id) = share_id {
        let headers = headers! {"User-Agent" => ua_m_at(0), "Content-Type" => "application/json"};
        if let Ok(response) = session
            .post("https://chat2-api.qianwen.com/api/v1/share/info?pr=qwen&fr=mac")
            .json(&json!({"share_id": share_id, "biz_id": biz_id}))
            .headers(&headers)
            .send()
        {
            if let Some(api) = response.json().filter(|_| response.status == 200) {
                let data = api.g("data");
                if api.g("code").as_i64() == Some(0) && data.is_object() && (data.g("session").truthy() || data.g("title").truthy()) {
                    extract(data, &mut out);
                    if !out.images.is_empty() || !out.videos.is_empty() {
                        out.title = Some(out.title.unwrap_or_default());
                        return out;
                    }
                }
            }
        }
    }
    let headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    if let Some(html) = session.get(real_url).headers(&headers).text() {
        let marker = "window.__INITIAL_PROPS__";
        match html.find(marker) {
            None => {
                if let Some(c) = re!(r#"<meta property="og:title" content="([^"]+)""#).captures(&html) {
                    out.title = Some(c[1].to_string());
                }
                if let Some(c) = re!(r#"<meta property="og:image" content="([^"]+)""#).captures(&html) {
                    out.cover = Some(c[1].to_string());
                }
            }
            Some(position) => {
                let mut sub = html[position + marker.len()..].trim_start_matches([' ', '=']).to_string();
                if let Some(end) = sub.find("</script>") {
                    sub = sub[..end].trim_end().trim_end_matches(';').to_string();
                }
                if let Some(data) = parse_json(&sub) {
                    let mut initial = data.g("initialData").clone();
                    if let Value::String(raw) = &initial {
                        let raw = if raw.starts_with('%') { unquote(raw) } else { raw.clone() };
                        initial = parse_json(&raw).unwrap_or(Value::String(raw));
                    }
                    let initial = if initial.is_object() {
                        if initial.g("data").is_object() { initial.g("data").clone() } else { initial }
                    } else {
                        json!({})
                    };
                    extract(&initial, &mut out);
                }
            }
        }
    }
    out.title = Some(out.title.unwrap_or_default());
    out
}
