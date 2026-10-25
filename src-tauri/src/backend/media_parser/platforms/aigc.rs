//! 星绘AI, 得物, 央视 (eager single-request parsers).

use super::super::core::*;
use std::sync::Arc;

fn image_of(img: &Value) -> Option<String> {
    first_str([img.g("no_wm_download_url"), img.g("download_url"), img.g("image_url")])
}

pub fn butterflyai(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    if real_url.is_empty() {
        return out;
    }
    let session = Session::new(ctx);
    let headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Referer" => "https://www.butterflyai.cn/",
        "Accept" => "application/json, text/plain, */*",
    };
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    let mut token = query.any(&["share_code", "share_token"]);
    let mut record = query.any(&["share_id", "share_record_id"]);
    if token.is_none() && re!(r"/s/([a-zA-Z0-9_\-]+)").is_match(&parts.path) {
        if let Ok(response) = session.get(real_url).headers(&headers).timeout(5.0).send() {
            let final_query = query_of(&response.url);
            token = final_query.any(&["share_code", "share_token"]);
            record = final_query.any(&["share_id", "share_record_id"]);
        }
    }
    if token.is_none() && record.is_none() {
        return out;
    }
    let payload = json!({
        "share_record_id": record.unwrap_or_default(),
        "from_h5": true,
        "share_token": token.unwrap_or_default(),
        "extra_params": {"aid": "564650", "app_name": "星绘"},
    });
    let Some(data) = session
        .post("https://www.butterflyai.cn/butterfly/community/v1/share/record/get?aid=564650")
        .json(&payload)
        .headers(&headers)
        .timeout(5.0)
        .json_value()
    else {
        return out;
    };
    let status = data.g("status_info");
    let code = if status.has("status_code") { status.g("status_code") } else { data.g("status_code") };
    if code.int() != 0 {
        return out;
    }
    let record = data.g("share_record");
    let artwork = record.g("artwork");
    let creator = record.g("creator");
    let mut title = first([artwork.g("title"), record.at("show_info.effect_title")]).as_str().unwrap_or("").trim().to_string();
    out.desc = trimmed(first([artwork.g("description"), record.g("prompt")]));
    if title.is_empty() && record.g("effect_list").truthy() {
        let effect = record.g("effect_list").i(0);
        title = first([effect.g("name"), effect.at("show_info.effect_title")]).as_str().unwrap_or("").trim().to_string();
    }
    out.title = Some(title);
    let name = first_str([creator.g("screen_name"), creator.g("nickname"), creator.g("name")]);
    let avatar_obj = creator.g("avatar").or(creator.g("avatar_url"));
    let avatar = match avatar_obj {
        Value::Object(_) => first_str([avatar_obj.g("large_url"), avatar_obj.g("image_url"), avatar_obj.g("middle_url")]),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    out.author = name_avatar(name, avatar);
    let rendering = record.g("rendering_video");
    if rendering.truthy() {
        out.video = first_str([rendering.g("video_url"), rendering.g("download_url")]);
    }
    for resource in artwork.g("resource_list").arr() {
        for video in resource.at("video_resource.rendering_videos").arr() {
            if out.video.is_none() {
                out.video = first_str([video.g("video_url"), video.g("download_url")]);
            }
        }
        for img in resource.at("image_resource.rendering_images").arr() {
            out.push_image(image_of(img));
        }
    }
    for img in record.g("rendering_images").arr() {
        out.push_image(image_of(img));
    }
    out.cover = first_str([artwork.g("cover_image_url"), artwork.g("cover_url")]);
    if out.cover.is_none() && rendering.truthy() {
        out.cover = rendering.g("cover_image_url").s();
    }
    out
}

pub fn dewu(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Referer" => "https://m.dewu.com/",
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let Some(html) = Session::new(ctx).get(real_url).headers(&headers).timeout(5.0).text() else { return out };
    let raw = Html::parse(&html)
        .scripts()
        .into_iter()
        .find(|s| s.contains("metaOGInfo"))
        .map(|s| s.trim().to_string())
        .or_else(|| {
            re!(r"(?s)<script[^>]*>(.*?metaOGInfo.*?)</script>")
                .captures(&html)
                .map(|c| c[1].trim().to_string())
        });
    let Some(data) = raw.and_then(|r| parse_json(&r)) else { return out };
    let list = data.at("props.pageProps.metaOGInfo.data");
    let Some(target) = list.arr().first() else { return out };
    let content = target.g("content");
    let user = target.g("userInfo");
    out.title = Some(trimmed(content.g("title")).unwrap_or_default());
    out.desc = trimmed(content.g("content"));
    out.cover = content.at("cover.url").s();
    if user.truthy() {
        out.author = name_avatar(user.g("userName").s(), user.g("icon").s());
    }
    for item in content.at("media.list").arr() {
        let Some(url) = item.g("url").s() else { continue };
        match item.g("mediaType").as_str() {
            Some("video") if out.video.is_none() => out.video = Some(url),
            Some("img") => out.images.push(Value::String(url)),
            _ => {}
        }
    }
    if out.video.is_none() {
        out.video = content.g("videoShareUrl").s();
    }
    if out.video.is_none() && out.images.is_empty() {
        if let Some(cover) = out.cover.clone() {
            out.images.push(Value::String(cover));
        }
    }
    out
}

pub fn cctv(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    if real_url.is_empty() {
        return out;
    }
    let session = Session::new(ctx);
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    if parts.netloc.contains("cctvnews") || parts.path.contains("snow-book") {
        cctv_news(&session, real_url, &query, &mut out);
    } else {
        cctv_web(&session, real_url, &query, &mut out);
    }
    if let Some(title) = out.title.take() {
        out.title = Some(re!(r"<[^>]+>").replace_all(&title, "").trim().to_string());
    }
    out
}

fn cctv_news(session: &Session, real_url: &str, query: &Query, out: &mut Fields) {
    let Some(item_id) = query.any(&["item_id", "articleId"]).or_else(|| {
        re!(r"(?:item_id|articleId)=([0-9a-zA-Z_\-]+)").captures(real_url).map(|c| c[1].to_string())
    }) else {
        return;
    };
    let ua = ua_pc_at(0);
    let timestamp = now_millis().to_string();
    let full_path = format!("/1.0.0/feed/article/server/getArticle?appcode=video_web&articleId={item_id}");
    let header_str = format!("x-ca-key:204133710\nx-ca-stage:RELEASE\nx-ca-timestamp:{timestamp}");
    let to_sign = format!("GET\napplication/json\n\n\n\n{header_str}\n{full_path}");
    let signature = b64(hmac_sha256(b"etyEuNdA7GvQU7iPZHqnrBpSFfRyKQTD", to_sign.as_bytes()));
    let headers = headers! {
        "x-ca-timestamp" => timestamp,
        "x-ca-key" => "204133710",
        "x-ca-stage" => "RELEASE",
        "accept" => "application/json",
        "User-Agent" => ua,
        "x-ca-signature-headers" => "x-ca-key,x-ca-stage,x-ca-timestamp",
        "x-ca-signature" => signature,
    };
    let Some(response) = session
        .get(format!("https://api.cctvnews.cctv.com{full_path}"))
        .headers(&headers)
        .timeout(5.0)
        .json_value()
    else {
        return;
    };
    let Some(encoded) = response.g("response").s() else { return };
    let Some(payload) = b64_decode(&encoded)
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|text| parse_json(&text))
        .map(|v| v.g("data").clone())
    else {
        return;
    };
    out.title = Some(trimmed(payload.g("title")).unwrap_or_default());
    let video = payload.g("videos").i(0);
    out.video = video.g("url").s();
    out.cover = video.at("cover.url").s();
    if out.cover.is_none() {
        out.cover = payload.g("thumbnails").i(0).g("url").s();
    }
    let name = first_str([payload.g("source"), payload.g("author")]).unwrap_or_else(|| "央视新闻".into());
    out.author = Some(json!({"name": name, "avatar": null}));
}

fn cctv_web(session: &Session, real_url: &str, query: &Query, out: &mut Fields) {
    let headers = headers! {"User-Agent" => ua_pc_at(0), "Referer" => "https://tv.cctv.com/", "Accept" => "*/*"};
    let mut pid = query.any(&["pid", "guid"]);
    if pid.is_none() {
        if let Some(html) = session.get(real_url).headers(&headers).timeout(5.0).text() {
            pid = re!(r#"(?:guid|pid|videoCenterId)\s*=\s*["']([0-9a-fA-F]{32})["']"#)
                .captures(&html)
                .map(|c| c[1].to_string());
        }
    }
    let Some(pid) = pid else { return };
    let Some(data) = session
        .get(format!("https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid={pid}"))
        .headers(&headers)
        .timeout(5.0)
        .json_value()
    else {
        return;
    };
    out.title = Some(trimmed(data.g("title")).unwrap_or_default());
    out.video = data.g("hls_url").s();
    out.cover = data.g("image").s();
    let name = first_str([data.g("column"), data.g("produce")]).unwrap_or_else(|| "央视网".into());
    out.author = Some(json!({"name": name, "avatar": null}));
}

const XIAOYUNQUE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn query_object(url: &str) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in Query::parse(&UrlParts::parse(url).query).0 {
        map.entry(key).or_insert(Value::String(value));
    }
    map
}

fn xiaoyunque_format(data: &Value) -> Fields {
    let page = data.g("page_info");
    let mut target = ["generate_page", "inspiration_page", "template_page", "share_page", "gugu_page"]
        .iter()
        .map(|k| page.g(k))
        .find(|v| v.is_object())
        .cloned()
        .unwrap_or(Value::Null);
    if !target.truthy() {
        if let Some(map) = page.obj() {
            if let Some(found) = map.values().find(|v| v.has("item_info") || v.has("user_info") || v.has("item_list")) {
                target = found.clone();
            }
        }
    }
    let list = target.g("item_list").arr();
    let (item, user) = if !list.is_empty() {
        let index = target.g("current_index").as_i64().filter(|i| *i >= 0 && (*i as usize) < list.len()).unwrap_or(0) as usize;
        let item = list[index].clone();
        let user = first([item.g("author_info"), item.g("user_info"), target.g("user_info")]).clone();
        (item, user)
    } else {
        (target.g("item_info").clone(), target.g("user_info").or(target.g("author_info")).clone())
    };
    let mut images = Vec::new();
    match item.g("image_info").or(item.g("images")) {
        Value::Array(list) => {
            for img in list {
                match img {
                    Value::Object(_) => images.extend(first_str([img.g("image_url"), img.g("url")])),
                    Value::String(s) => images.push(s.clone()),
                    _ => {}
                }
            }
        }
        obj @ Value::Object(_) => images.extend(first_str([obj.g("image_url"), obj.g("url")])),
        _ => {}
    }
    let mut videos: Vec<String> = Vec::new();
    let raw = first_str([item.g("video_url"), item.g("video_play_url")]);
    let video_info = item.g("video_info").or(item.g("video"));
    match video_info {
        Value::Array(list) => {
            for v in list {
                let url = match v {
                    Value::Object(_) => first_str([v.g("video_url"), v.g("main_url"), v.g("url")]),
                    Value::String(s) => Some(s.clone()),
                    _ => None,
                };
                if let Some(url) = url.filter(|u| !videos.contains(u)) {
                    videos.push(url);
                }
            }
        }
        obj @ Value::Object(_) => {
            if let Some(url) = first_str([obj.g("main_url"), obj.g("video_url"), obj.g("url")]) {
                videos.push(url);
            }
        }
        _ => {}
    }
    if let Some(raw) = raw.filter(|r| !videos.contains(r)) {
        videos.insert(0, raw);
    }
    let cover_of = |v: &Value| first_str([v.g("cover_url"), v.g("poster"), v.g("cover")]);
    let cover = cover_of(&item).or_else(|| match video_info {
        Value::Array(list) => list.iter().find_map(cover_of),
        obj @ Value::Object(_) => cover_of(obj),
        _ => None,
    });
    Fields {
        title: item.g("title").s(),
        desc: item.g("desc").s(),
        video: videos.first().cloned(),
        videos,
        cover,
        author: Some(author(
            first([user.g("nick_name"), user.g("nickname")]).str_or_empty(),
            first([user.g("user_id"), user.g("sec_uid")]).str_or_empty(),
            first([user.g("avatar_url"), user.g("avatar")]).str_or_empty(),
        )),
        images: images.into_iter().map(Value::String).collect(),
        ..Fields::default()
    }
}

pub fn xiaoyunque(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let empty = Fields { title: Some(String::new()), ..Fields::default() };
    let session = Session::new(ctx);
    let mut query = query_object(real_url);
    if query.is_empty() && UrlParts::parse(real_url).path.contains("/s/") {
        let target = if real_url.ends_with('/') { real_url.to_string() } else { format!("{real_url}/") };
        let Ok(response) = session.get(target).header("User-Agent", XIAOYUNQUE_UA).timeout(15.0).ok() else { return empty };
        query = query_object(&response.url);
    }
    if query.is_empty() {
        return empty;
    }
    let headers = headers! {
        "Accept" => "application/json, text/plain, */*",
        "Content-Type" => "application/json",
        "User-Agent" => XIAOYUNQUE_UA,
    };
    let Some(payload) = session
        .post("https://xiaoyunque.jianying.com/luckycat/cn/jianying/campaign/v1/pippit/share/landing_page")
        .headers(&headers)
        .json(&json!({"query_params": query}))
        .timeout(30.0)
        .json_value()
    else {
        return empty;
    };
    if payload.g("err_no").as_i64() != Some(0) {
        return empty;
    }
    xiaoyunque_format(payload.g("data"))
}

pub fn xinpianchang(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let text = real_url.trim();
    let path = UrlParts::parse(text).path;
    let Some(article) = re!(r"(?:a|article/)?(\d+)")
        .captures(&path)
        .map(|c| c[1].to_string())
        .or_else(|| re!(r"\d+").find(text).map(|m| m.as_str().to_string()))
    else {
        return out;
    };
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => ua_m_at(0), "Accept" => "application/json, text/plain, */*"};
    let Some(result) = session.get(format!("https://app.xinpianchang.com/article/{article}")).headers(&headers).json_value() else {
        return out;
    };
    if result.g("status").as_i64() != Some(0) || !result.g("data").is_object() {
        return out;
    }
    let data = result.g("data");
    out.title = Some(data.g("title").str_or_empty());
    out.cover = data.g("cover").s();
    let info = data.at("author.userinfo");
    if info.is_object() && info.truthy() {
        let id = if info.g("id").truthy() { info.g("id").str_or_empty() } else { String::new() };
        out.author = Some(author(info.g("username").str_or_empty(), id, info.g("avatar").str_or_empty()));
    }
    let vid = first([data.g("vid"), data.g("media_id")]);
    if vid.truthy() {
        let app_key = data.at("video.appKey").s().unwrap_or_else(|| "61a2f329348b3bf77".into());
        let url = format!("https://mod-api.xinpianchang.com/mod/api/v2/media/{}?appKey={app_key}", vid.str_or_empty());
        if let Ok(response) = session.get(url).headers(&headers).send() {
            if let Some(media) = response.json().filter(|_| response.status == 200) {
                if media.g("status").as_i64() == Some(0) && media.g("data").is_object() {
                    out.videos = dedupe(
                        media
                            .at("data.resource.progressive")
                            .arr()
                            .iter()
                            .filter_map(|p| p.g("url").s().filter(|u| u.starts_with("http")))
                            .collect(),
                    );
                }
            }
        }
    }
    out
}
