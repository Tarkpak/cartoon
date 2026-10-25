//! 豆包 (upstream `doubao_parser.py`).

use super::super::core::*;
use std::sync::Arc;

const VIDEO_API: &str = "https://www.doubao.com/creativity/share/get_video_share_info";
const PLAY_INFO_API: &str = "https://www.doubao.com/samantha/media/get_play_info";
const GET_VIDEO_MODEL_API: &str = "https://www.doubao.com/alice/resource/get_video_model";
const FPLAY_KDF_SALT: &str = "TdTC5rgxYgkOUrPHpnM7pByyRiuCmrWKGWs521cXdST0m69/COjWjSanLjfBqVovHwWlGJKu8pSXMrYqOKrdWA==";
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const PARAMS: &[(&str, &str)] = &[
    ("version_code", "20800"),
    ("language", "zh-CN"),
    ("device_platform", "web"),
    ("aid", "497858"),
    ("real_aid", "497858"),
    ("pkg_type", "release_version"),
    ("samantha_web", "1"),
    ("use-olympus-account", "1"),
];

pub struct Doubao {
    session: Session,
    headers: Headers,
    real_url: String,
}

pub fn decipher_fplay(raw: &str, seed: &str) -> Option<String> {
    let encrypted = b64_any(raw)?;
    let seed = b64_any(seed)?;
    if encrypted.len() < 4 {
        return None;
    }
    let mut material = sha512(&seed);
    material.extend(b64_decode(FPLAY_KDF_SALT)?);
    let derived = sha512(&material);
    let plain = aes_cbc_decrypt(&derived[..16], &derived[16..32], &encrypted[4..])?;
    opt(String::from_utf8(plain).ok().map(|s| s.trim().to_string()))
}

pub fn sanitize_video_url(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    let parts = UrlParts::parse(url);
    if parts.scheme.is_empty() || parts.netloc.is_empty() {
        return url.to_string();
    }
    let query: Vec<_> = parse_qs_multi(&parts.query, true)
        .into_iter()
        .filter(|(k, _)| !matches!(k.as_str(), "lr" | "logo_type" | "download"))
        .collect();
    with_query(url, &urlencode_multi(&query))
}

pub fn is_watermarked(url: &str) -> bool {
    let lower = url.to_lowercase();
    ["video_gen_watermark", "watermark_dyn", "logo_type=video_gen_watermark"]
        .iter()
        .any(|m| lower.contains(m))
}

fn expand_json_strings(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, expand_json_strings(v))).collect()),
        Value::Array(items) => Value::Array(items.into_iter().map(expand_json_strings).collect()),
        Value::String(text) => {
            let stripped = unescape_html(&text).trim().to_string();
            if stripped.starts_with('{') || stripped.starts_with('[') {
                if let Some(parsed) = parse_json(&stripped) {
                    return expand_json_strings(parsed);
                }
            }
            Value::String(text)
        }
        other => other,
    }
}

fn load_payloads(html: &str) -> Vec<Value> {
    let mut roots = Vec::new();
    let doc = Html::parse(html);
    for script in doc.select("script[data-fn-args]") {
        if let Some(raw) = script.value().attr("data-fn-args").filter(|r| !r.is_empty()) {
            if let Some(value) = parse_json(&unescape_html(raw)) {
                roots.push(expand_json_strings(value));
            }
        }
    }
    for c in re!(r#"(?s)<script\b[^>]*\bdata-fn-name="r"[^>]*\bdata-fn-args="(?P<args>.*?)"\s+nonce="#).captures_iter(html) {
        if let Some(value) = parse_json(&unescape_html(&c["args"])) {
            roots.push(expand_json_strings(value));
        }
    }
    roots
}

fn image_url(item: &Value) -> Option<String> {
    if !item.is_object() {
        return None;
    }
    first_str([
        item.at("image_ori_raw.url"),
        item.at("image_raw.url"),
        item.at("image_ori.url"),
        item.at("image_origin.url"),
        item.g("raw_url"),
        item.g("origin_url"),
        item.g("url"),
    ])
}

fn collect_creations(node: &Value, out: &mut Vec<Value>) {
    match node {
        Value::Object(map) => {
            let block = node.g("creation_block");
            if block.is_object() {
                out.extend(block.g("creations").arr().iter().filter(|c| c.is_object()).cloned());
            }
            out.extend(node.g("creations").arr().iter().filter(|c| c.is_object()).cloned());
            map.values().for_each(|v| collect_creations(v, out));
        }
        Value::Array(items) => items.iter().for_each(|v| collect_creations(v, out)),
        _ => {}
    }
}

fn collect_images(node: &Value, out: &mut Vec<String>) {
    match node {
        Value::Object(map) => {
            out.extend(node.g("ref_images").arr().iter().filter_map(image_url));
            out.extend(node.g("ref_resources").arr().iter().filter_map(|i| image_url(i.g("image"))));
            if node.g("image").is_object() {
                out.extend(image_url(node.g("image")));
            }
            map.values().for_each(|v| collect_images(v, out));
        }
        Value::Array(items) => items.iter().for_each(|v| collect_images(v, out)),
        _ => {}
    }
}

fn thread_video_urls(video: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    let mut fallback = Vec::new();
    let mut push = |url: String| {
        if url.is_empty() {
            return;
        }
        if is_watermarked(&url) { fallback.push(url) } else { urls.push(url) }
    };
    if let Some(direct) = video.g("download_url").s() {
        push(sanitize_video_url(&direct));
    }
    let model = match video.g("video_model") {
        Value::String(raw) => parse_json(raw).unwrap_or(Value::Null),
        other => other.clone(),
    };
    for item in all_objects(&model) {
        for key in ["main_url", "backup_url_1"] {
            let Some(encoded) = item.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) else { continue };
            let Some(decoded) = b64_decode(encoded).and_then(|b| String::from_utf8(b).ok()) else { continue };
            push(sanitize_video_url(&decoded));
        }
    }
    let urls = dedupe(urls);
    if urls.is_empty() { dedupe(fallback) } else { urls }
}

fn find_title(roots: &Value) -> String {
    for key in ["title", "prompt", "description"] {
        for item in all_objects(roots) {
            if let Some(text) = item.get(key).and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() && !trimmed.starts_with('{') && !trimmed.starts_with('[') {
                    return trimmed.to_string();
                }
            }
        }
    }
    String::new()
}

fn messages_text(roots: &Value) -> String {
    let mut texts: Vec<String> = Vec::new();
    for item in all_objects(roots) {
        match item.get("content") {
            Some(Value::String(content)) if !content.trim().is_empty() => {
                let s = content.trim();
                let wrapped = (s.starts_with('{') && s.ends_with('}')) || (s.starts_with('[') && s.ends_with(']'));
                if !wrapped && s.chars().count() > 1 && !texts.iter().any(|t| t == s) {
                    texts.push(s.to_string());
                }
            }
            Some(content @ Value::Object(_)) => {
                if let Some(text) = content.g("text").or(content.g("message")).as_str() {
                    let text = text.trim();
                    if !text.is_empty() && !texts.iter().any(|t| t == text) {
                        texts.push(text.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    texts.join("\n\n")
}

fn find_author(roots: &Value) -> Option<Value> {
    for item in all_objects(roots) {
        let item = Value::Object(item.clone());
        let Some(nickname) = item.g("nickname").or(item.g("user_name")).as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string) else { continue };
        let id = first([item.g("user_id"), item.g("uid"), item.g("id")]);
        let avatar = item.g("avatar").or(item.g("avatar_url"));
        return Some(author(nickname, id.str_or_empty(), avatar.as_str().unwrap_or("")));
    }
    None
}

impl Doubao {
    fn api_headers(&self) -> Headers {
        let mut headers = self.headers.clone();
        headers.set("Content-Type", "application/json");
        headers.set("Origin", "https://www.doubao.com");
        headers.set("Referer", self.real_url.clone());
        headers
    }

    fn fallback_videos(&self, api: &str) -> Vec<String> {
        let parts = UrlParts::parse(api);
        let qs = parse_qs_multi(&parts.query, false);
        if !qs.iter().any(|(k, _)| k == "key_seed") {
            return Vec::new();
        }
        let headers = headers! {"User-Agent" => USER_AGENT, "Referer" => "https://www.doubao.com/"};
        let candidates: [Vec<(&str, &str)>; 2] = [
            vec![("force_fids", "b3JpZ2luYWw="), ("codec_type", "5")],
            vec![("codec_type", "1")],
        ];
        for candidate in candidates {
            let mut query: Vec<(String, Vec<String>)> = qs
                .iter()
                .filter(|(k, _)| k != "logo_type" && k != "force_fids")
                .cloned()
                .collect();
            for (key, value) in candidate {
                match query.iter_mut().find(|(k, _)| k == key) {
                    Some(slot) => slot.1 = vec![value.to_string()],
                    None => query.push((key.to_string(), vec![value.to_string()])),
                }
            }
            let url = with_query(api, &urlencode_multi(&query));
            let Ok(response) = self.session.get(&url).headers(&headers).send() else { continue };
            if response.status != 200 {
                continue;
            }
            let info = response.json().map(|j| j.at("video_info.data").clone()).unwrap_or_default();
            let Some(seed) = info.g("key_seed").s() else { continue };
            let mut urls: Vec<String> = Vec::new();
            if let Some(list) = info.g("video_list").obj() {
                for video in list.values() {
                    for key in ["main_url", "backup_url_1"] {
                        if let Some(decoded) = video.g(key).s().and_then(|raw| decipher_fplay(&raw, &seed)) {
                            if !urls.contains(&decoded) {
                                urls.push(decoded);
                            }
                        }
                    }
                }
            }
            if !urls.is_empty() {
                return urls;
            }
        }
        Vec::new()
    }

    fn unwatermarked(&self, vid: &str) -> (Vec<String>, Option<String>) {
        if vid.is_empty() {
            return (Vec::new(), None);
        }
        let Ok(response) = self
            .session
            .post(GET_VIDEO_MODEL_API)
            .json(&json!({"params": [{"uri": vid}]}))
            .headers(&self.api_headers())
            .send()
        else {
            return (Vec::new(), None);
        };
        if response.status != 200 {
            return (Vec::new(), None);
        }
        let Some(data) = response.json() else { return (Vec::new(), None) };
        if data.g("code").as_i64() != Some(0) || !data.at("data.results").truthy() {
            return (Vec::new(), None);
        }
        let first_result = data.at("data.results.0");
        let mut poster = first_result.at("video_url_result.poster_url").s();
        let Some(model) = first_result.at("video_model_result.video_model").s().and_then(|r| parse_json(&r)) else {
            return (Vec::new(), None);
        };
        poster = poster.or_else(|| model.g("poster_url").s());
        if let Some(api) = model.g("fallback_api").s() {
            let urls = self.fallback_videos(&api);
            if !urls.is_empty() {
                return (urls, poster);
            }
        }
        (Vec::new(), None)
    }

    fn play_info(&self, vid: &str) -> Option<Value> {
        let response = self
            .session
            .post(PLAY_INFO_API)
            .query(PARAMS)
            .headers(&self.api_headers())
            .json(&json!({"key": vid}))
            .send()
            .ok()?;
        if response.status != 200 {
            return None;
        }
        let data = response.json()?;
        (data.g("code").as_i64() == Some(0) && data.g("data").truthy()).then(|| data.g("data").clone())
    }

    fn thread(&self, out: &mut Fields) -> Option<()> {
        let html = self.session.get(&self.real_url).headers(&self.headers).timeout(15.0).ok().ok()?.text();
        let roots = Value::Array(load_payloads(&html));
        let mut creations = Vec::new();
        let mut images = Vec::new();
        collect_creations(&roots, &mut creations);
        collect_images(&roots, &mut images);
        let creations = dedupe_values(creations);
        let mut videos = Vec::new();
        let mut covers = Vec::new();
        for creation in &creations {
            if let Some(url) = image_url(creation.g("image")) {
                images.push(url.clone());
                covers.push(url);
            }
            let video = creation.g("video");
            if !video.truthy() {
                continue;
            }
            let mut clean = Vec::new();
            if let Some(vid) = video.g("vid").or(video.g("video_id")).text() {
                let (urls, poster) = self.unwatermarked(&vid);
                clean = urls;
                videos.extend(clean.iter().cloned());
                covers.extend(poster);
                if clean.is_empty() {
                    if let Some(info) = self.play_info(&vid) {
                        if let Some(raw) = info.at("original_media_info.main_url").s() {
                            videos.push(sanitize_video_url(&raw));
                        }
                        covers.extend(info.g("poster_url").s());
                    }
                }
            }
            if clean.is_empty() {
                videos.extend(thread_video_urls(video));
            }
            covers.extend(first_str([video.g("poster_url"), video.at("cover.url"), video.at("poster.url")]));
        }
        covers.extend(images.iter().cloned());
        let images = dedupe(images);
        let mut videos = dedupe(videos);
        let covers = dedupe(covers);
        let clean: Vec<String> = videos.iter().filter(|u| !is_watermarked(u)).cloned().collect();
        if !clean.is_empty() {
            videos = clean;
        }
        if videos.is_empty() && images.is_empty() {
            out.flags.no_media_in_content = true;
        }
        let title = find_title(&roots);
        out.title = Some(if title.is_empty() { "豆包对话分享".into() } else { title });
        out.desc = opt(Some(messages_text(&roots)));
        out.video = videos.first().cloned();
        out.videos = videos;
        out.cover = covers.into_iter().next();
        out.author = find_author(&roots);
        out.images = images.into_iter().map(Value::String).collect();
        Some(())
    }

    fn video_sharing(&self, out: &mut Fields) -> Option<()> {
        let query = query_of(&self.real_url);
        let share_id = query.get("share_id")?;
        let video_id = query.get("video_id")?;
        let (clean, clean_poster) = self.unwatermarked(&video_id);
        let mut original = clean.first().cloned();
        let mut poster = clean_poster;
        if original.is_none() {
            if let Some(info) = self.play_info(&video_id) {
                if let Some(raw) = info.at("original_media_info.main_url").s() {
                    original = Some(sanitize_video_url(&raw));
                }
                if let Some(p) = info.g("poster_url").s() {
                    poster = Some(p);
                }
            }
        }
        let payload = self
            .session
            .post(VIDEO_API)
            .query(PARAMS)
            .headers(&self.api_headers())
            .json(&json!({"share_id": share_id, "vid": video_id, "creation_id": ""}))
            .timeout(15.0)
            .ok()
            .ok()?
            .json()?;
        if payload.g("code").as_i64() != Some(0) && original.is_none() {
            return None;
        }
        let detail = payload.g("data");
        let play = detail.g("play_info");
        let share_url = play.g("main").or(play.g("backup")).s().map(|u| sanitize_video_url(&u));
        let user = detail.g("user_info");
        let final_url = original.or(share_url);
        out.title = Some(detail.g("prompt").s().unwrap_or_else(|| "豆包 AI 视频".into()));
        out.videos = if clean.is_empty() { final_url.clone().into_iter().collect() } else { clean };
        out.video = final_url;
        out.cover = poster.or_else(|| play.g("poster_url").s());
        out.author = Some(author(
            user.g("nickname").or(user.g("user_name")).str_or_empty(),
            if user.g("user_id").is_null() { String::new() } else { user.g("user_id").str_or_empty() },
            user.g("avatar").or(user.g("avatar_url")).str_or_empty(),
        ));
        out.images = Vec::new();
        Some(())
    }

    fn music_sharing(&self, out: &mut Fields) {
        let query = query_of(&self.real_url);
        let vid = query.any(&["vid", "video_id"]);
        let mut audio = Vec::new();
        let mut videos = Vec::new();
        let mut cover = None;
        if let Some(vid) = vid {
            let (urls, poster) = self.unwatermarked(&vid);
            videos.extend(urls);
            cover = poster;
            if let Some(info) = self.play_info(&vid) {
                if let Some(raw) = info.at("original_media_info.main_url").s() {
                    let url = sanitize_video_url(&raw);
                    if info.g("media_type").as_str() == Some("audio") { audio.push(url) } else { videos.push(url) }
                }
                if cover.is_none() {
                    cover = info.g("poster_url").s();
                }
            }
        }
        out.title = Some("豆包AI音乐分享".into());
        out.video = videos.first().cloned();
        out.audio = audio.first().cloned().or_else(|| out.video.clone());
        out.videos = videos;
        out.cover = cover;
        out.author = None;
    }
}

pub fn doubao(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut headers = headers! {"Accept" => "application/json, text/plain, */*", "User-Agent" => USER_AGENT};
    let cookie = platform_cookie("doubao", None);
    if !cookie.is_empty() {
        headers.set("Cookie", cookie);
    }
    let parser = Doubao { session: Session::new(ctx), headers, real_url: real_url.to_string() };
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let path = UrlParts::parse(real_url).path.trim_end_matches('/').to_string();
    if path.starts_with("/thread/") || path.starts_with("/chat/") {
        let mut attempt = Fields { title: Some(String::new()), ..Fields::default() };
        if parser.thread(&mut attempt).is_some() {
            out = attempt;
        }
    } else if path == "/video-sharing" {
        let mut attempt = Fields { title: Some(String::new()), ..Fields::default() };
        if parser.video_sharing(&mut attempt).is_some() {
            out = attempt;
        }
    } else if path == "/music-sharing" {
        parser.music_sharing(&mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_and_decrypts() {
        assert_eq!(
            sanitize_video_url("https://v.doubao.com/a.mp4?sig=1&lr=x&logo_type=video_gen_watermark&e="),
            "https://v.doubao.com/a.mp4?sig=1&e="
        );
        let seed = b64(b"seed-bytes");
        let mut material = sha512(b"seed-bytes");
        material.extend(b64_decode(FPLAY_KDF_SALT).unwrap());
        let derived = sha512(&material);
        let cipher = aes_cbc_encrypt(&derived[..16], &derived[16..32], b"https://cdn/clean.mp4").unwrap();
        let mut payload = b"abcd".to_vec();
        payload.extend(cipher);
        let raw = b64(&payload).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string();
        assert_eq!(decipher_fplay(&raw, &seed).as_deref(), Some("https://cdn/clean.mp4"));
    }
}
