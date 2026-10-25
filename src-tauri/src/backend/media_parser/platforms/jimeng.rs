//! 即梦AI (upstream `jimeng_parser.py`).

use super::super::core::*;
use std::sync::Arc;

const API_URL: &str = "https://jimeng.jianying.com/mweb/v1/get_item_info";
const CAMPAIGN_API_URL: &str = "https://jimeng.jianying.com/luckycat/cn/jianying/campaign/v1/dreamina/share/landing_page";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

pub fn sanitize_video_url(url: &str) -> String {
    let url = re!(r"&lr=[^&]+").replace_all(url, "");
    let url = re!(r"\?lr=[^&]+&").replace_all(&url, "?");
    let url = re!(r"\?lr=[^&]+$").replace_all(&url, "");
    re!(r"cd=0(%7C|\|)0(%7C|\|)1(%7C|\|)(\d+)")
        .replace_all(&url, "cd=0${1}0${2}0${3}${4}")
        .into_owned()
}

fn best_transcoded(transcoded: &Value) -> Option<String> {
    let mut best: Option<((i64, i64), String)> = None;
    for item in transcoded.obj()?.values() {
        let Some(url) = item.g("video_url").s() else { continue };
        let score = (
            item.g("width").int() * item.g("height").int(),
            item.g("br").or(item.g("bitrate")).int(),
        );
        if best.as_ref().map_or(true, |(s, _)| score > *s) {
            best = Some((score, url));
        }
    }
    best.map(|(_, url)| url)
}

fn primary_video(transcoded: &Value, origin: &Value) -> Option<String> {
    transcoded
        .at("origin.video_url")
        .s()
        .or_else(|| origin.g("video_url").s())
        .or_else(|| best_transcoded(transcoded))
}

fn video_list(primary: &Option<String>, transcoded: &Value) -> Vec<String> {
    let mut list: Vec<String> = primary.clone().into_iter().collect();
    if let Some(map) = transcoded.obj() {
        for item in map.values() {
            if let Some(url) = item.g("video_url").s().map(|u| sanitize_video_url(&u)) {
                if !url.is_empty() && !list.contains(&url) {
                    list.push(url);
                }
            }
        }
    }
    list
}

fn pick_quality(map: &Value, qualities: &[&str]) -> Option<String> {
    map.obj()?;
    qualities
        .iter()
        .find_map(|q| map.g(q).s())
        .or_else(|| map.obj()?.values().find(|v| v.truthy()).and_then(|v| v.s()))
}

fn author_of(user: &Value, name_keys: &[&str], id_keys: &[&str], avatar_keys: &[&str]) -> Value {
    let pick = |keys: &[&str]| first(keys.iter().map(|k| user.g(k))).clone();
    let id = pick(id_keys);
    author(pick(name_keys).str_or_empty(), if id.truthy() { id.str_or_empty() } else { String::new() }, pick(avatar_keys).str_or_empty())
}

fn format_detail(detail: &Value) -> Fields {
    let common = detail.g("common_attr");
    let video = detail.g("video");
    let transcoded = video.g("transcoded_video");
    let mut primary = primary_video(transcoded, video.g("origin_video"));
    let mut cover = pick_quality(common.g("cover_url_map"), &["4096", "2400", "1080", "720", "480", "360", "original"]);
    if cover.is_none() {
        cover = first_str([common.g("cover_url"), video.g("cover_url")]);
    }
    let raw = first([detail.g("image_infos"), detail.g("image_list"), detail.g("images")]);
    let mut images: Vec<String> = Vec::new();
    for img in raw.arr() {
        match img {
            Value::String(s) if s.starts_with("http") => images.push(s.clone()),
            Value::Object(_) => {
                let map = img.g("image_url_map").or(img.g("cover_url_map"));
                let url = pick_quality(map, &["original", "4096", "2400", "1080", "720"]).or_else(|| {
                    first_str([img.g("image_url"), img.g("url"), img.g("origin_url"), img.g("main_url")])
                });
                images.extend(url);
            }
            _ => {}
        }
    }
    let mut images = dedupe(images);
    if primary.is_none() && images.is_empty() {
        images.extend(cover.clone());
    }
    primary = primary.map(|u| sanitize_video_url(&u));
    Fields {
        title: common.g("title").s(),
        desc: common.g("description").s(),
        videos: video_list(&primary, transcoded),
        video: primary,
        cover,
        author: Some(author_of(detail.g("author"), &["name"], &["uid", "sec_uid"], &["avatar_url"])),
        images: images.into_iter().map(Value::String).collect(),
        ..Fields::default()
    }
}

fn format_campaign(data: &Value) -> Fields {
    let page = data.g("page_info");
    let creation = page.g("creation");
    let meta = creation.g("metadata");
    let user = page.g("user_info").or(creation.g("author"));
    let raw_video = meta.g("video_url").or(creation.g("video_url"));
    let download = meta.g("download_info");
    let mut videos: Vec<String> = Vec::new();
    for candidate in [download.g("watermark_ending_url"), raw_video, download.g("url")] {
        if let Some(url) = candidate.as_str().filter(|u| u.starts_with("http")) {
            let cleaned = sanitize_video_url(url);
            if !videos.contains(&cleaned) {
                videos.push(cleaned);
            }
        }
    }
    let primary = videos.first().cloned();
    let cover = first_str([meta.g("cover_url"), creation.g("cover_url"), page.g("cover_url")]);
    let mut images = Vec::new();
    for img in first([creation.g("image_list"), meta.g("image_list"), creation.g("images")]).arr() {
        match img {
            Value::String(s) if s.starts_with("http") => images.push(s.clone()),
            Value::Object(_) => images.extend(first_str([img.g("image_url"), img.g("url"), img.g("origin_url")])),
            _ => {}
        }
    }
    let mut images = dedupe(images);
    if primary.is_none() && images.is_empty() {
        images.extend(cover.clone());
    }
    Fields {
        title: first_str([meta.g("title"), creation.g("prompt"), page.g("title")]),
        desc: first_str([meta.g("description"), creation.g("desc"), page.g("desc")]),
        video: primary.map(|u| sanitize_video_url(&u)),
        videos,
        cover,
        author: Some(author_of(user, &["name", "nickname"], &["uid", "sec_uid", "author_id"], &["avatar_url", "avatar"])),
        images: images.into_iter().map(Value::String).collect(),
        ..Fields::default()
    }
}

fn item_id(url: &str) -> Option<String> {
    let parts = UrlParts::parse(url);
    let query = parts.qs();
    for key in ["published_item_id", "item_id", "id", "work_id", "feed_id", "projectId"] {
        if let Some(value) = query.get(key).filter(|v| v.chars().all(|c| c.is_ascii_digit())) {
            return Some(value);
        }
    }
    parts
        .path
        .split('/')
        .filter(|p| !p.is_empty())
        .rev()
        .find(|p| p.len() >= 10 && p.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

fn item_id_from_html(html: &str) -> Option<String> {
    let patterns = [
        re!(r#"["']published_item_id["']\s*:\s*["']?(\d{10,25})"#),
        re!(r#"["']item_id["']\s*:\s*["']?(\d{10,25})"#),
        re!(r#"["']itemId["']\s*:\s*["']?(\d{10,25})"#),
        re!(r#"["']work_id["']\s*:\s*["']?(\d{10,25})"#),
        re!(r#"["']feed_id["']\s*:\s*["']?(\d{10,25})"#),
        re!(r#"["']id["']\s*:\s*["']?(\d{15,25})"#),
    ];
    patterns.iter().find_map(|p| p.captures(html).map(|c| c[1].to_string()))
}

fn campaign(session: &Session, headers: &Headers, url: &str, item: Option<&str>) -> Option<Fields> {
    let query: Map<String, Value> = Query::parse(&UrlParts::parse(url).query)
        .0
        .into_iter()
        .fold(Map::new(), |mut map, (k, v)| {
            map.entry(k).or_insert(Value::String(v));
            map
        });
    let sec_uid = query.get("share_sec_uid").or(query.get("author_id")).cloned();
    let headers = headers.with("appid", "581595");
    let mut payload = json!({"query_params": query});
    if let Some(item) = item {
        payload["item_id"] = json!(item);
    }
    if let Some(sec) = sec_uid {
        payload["sec_uid"] = json!(sec.str_or_empty());
    }
    let post = |payload: &Value| session.post(CAMPAIGN_API_URL).headers(&headers).json(payload).timeout(30.0).json_value();
    let mut result = post(&payload)?;
    if result.g("err_no").as_i64() != Some(0) || !result.g("data").truthy() {
        if payload.has("item_id") && !query.is_empty() {
            payload.as_object_mut().unwrap().remove("item_id");
            result = post(&payload)?;
        }
    }
    if result.g("err_no").as_i64() == Some(0) && result.g("data").truthy() {
        let formatted = format_campaign(result.g("data"));
        if formatted.video.is_some() || !formatted.images.is_empty() {
            return Some(formatted);
        }
    }
    None
}

pub fn jimeng(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let mut headers = headers! {
        "Accept" => "application/json, text/plain, */*",
        "Content-Type" => "application/json",
        "User-Agent" => USER_AGENT,
    };
    let cookie = platform_cookie("jimeng", None);
    if !cookie.is_empty() {
        headers.set("Cookie", cookie);
        headers.set("appid", "581595");
        headers.set("device-platform", "web");
    }
    let empty = || Fields { title: Some(String::new()), ..Fields::default() };
    let mut target = real_url.to_string();
    let mut item = item_id(&target);
    if item.is_none() || target.contains("/s/") {
        let Ok(response) = session.get(&target).header("User-Agent", USER_AGENT).timeout(15.0).ok() else {
            return empty();
        };
        target = response.url.clone();
        if item.is_none() {
            item = item_id(&target);
        }
        if item.is_none() {
            item = item_id_from_html(&response.text());
        }
    }
    if let Some(id) = &item {
        if let Some(payload) = session
            .post(API_URL)
            .headers(&headers)
            .json(&json!({"published_item_id": id}))
            .timeout(30.0)
            .json_value()
        {
            let ret = payload.g("ret").str_or_empty();
            if ret == "0" {
                return format_detail(payload.g("data"));
            }
            let message = payload.g("errmsg").str_or_empty();
            if message.contains("itemId not exist") || ret == "2032" || ret == "1000" {
                if let Some(found) = campaign(&session, &headers, &target, Some(id)) {
                    return found;
                }
            }
        }
    }
    if target.contains("reflux") || target.contains("mproject") || target.contains("share_token") {
        if let Some(found) = campaign(&session, &headers, &target, item.as_deref()) {
            return found;
        }
    }
    empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_watermark_parameters() {
        assert_eq!(
            sanitize_video_url("https://v/x.mp4?lr=dreamina&a=1&cd=0%7C0%7C1%7C3&lr=x"),
            "https://v/x.mp4?a=1&cd=0%7C0%7C0%7C3"
        );
        assert_eq!(item_id("https://jimeng.jianying.com/ai-tool/work-detail/7500000000000000001").as_deref(), Some("7500000000000000001"));
    }
}
