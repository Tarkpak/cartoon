//! 腾讯元宝 (upstream `yuanbao_parser.py`).

use super::super::core::*;
use std::sync::Arc;

fn valid(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|v| v.starts_with("http://") || v.starts_with("https://"))
        .map(|v| unescape_html(v).replace("\\u0026", "&"))
}

fn clean_title(value: &Value) -> String {
    let Some(text) = value.as_str() else { return String::new() };
    let text = unescape_html(text).trim().to_string();
    re!(r"^\[(?:图片|视频)\]\s*").replace(&text, "").into_owned()
}

fn author_from(data: &Value) -> Option<Map<String, Value>> {
    if !data.is_object() || !data.truthy() {
        return None;
    }
    let nickname = first([data.g("name"), data.g("nickname"), data.g("nick")]).str_or_empty();
    let id = first([data.g("userId"), data.g("id"), data.g("uid")]).str_or_empty();
    let avatar = first([data.g("imageUrl"), data.g("avatar"), data.g("avatarUrl")]);
    if nickname.is_empty() && id.is_empty() && !avatar.truthy() {
        return None;
    }
    let mut map = Map::new();
    map.insert("nickname".into(), json!(nickname));
    map.insert("author_id".into(), json!(id));
    map.insert("avatar".into(), if avatar.truthy() { avatar.clone() } else { json!("") });
    Some(map)
}

#[derive(Default)]
struct Yuanbao {
    title: String,
    cover: Option<String>,
    videos: Vec<String>,
    images: Vec<String>,
    author: Option<Map<String, Value>>,
}

impl Yuanbao {
    fn multimedia(&mut self, media: &Value) {
        if !media.is_object() {
            return;
        }
        let kind = ["type", "mediaType", "mimeType", "display"]
            .iter()
            .map(|k| media.g(k).or(&json!("")).str_or_empty().to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        let is_video = kind.contains("video");
        let is_image = kind.contains("image") || !is_video;
        let primary = ["downloadUrl", "url", "resourceUrl", "playUrl", "videoUrl"].iter().find_map(|k| valid(media.g(k)));
        if let Some(url) = primary {
            if is_video {
                self.videos.push(url);
            } else if is_image {
                self.images.push(url);
            }
        }
        let cover = ["downloadCoverUrl", "cover", "coverUrl", "thumbnailUrl", "previewUrl"].iter().find_map(|k| valid(media.g(k)));
        if let Some(cover) = cover {
            if is_video || self.cover.is_none() {
                self.cover = Some(cover);
            }
        }
    }

    fn chat_share(&mut self, payload: &Value) {
        let chat = payload.g("chat");
        let card = chat.g("shareCardInfo");
        let conversations = chat.g("convs").arr();
        self.title = clean_title(card.g("title"));
        self.author = author_from(chat.g("userInfo"));
        for conv in conversations.iter().filter(|c| c.g("speaker").as_str() == Some("human")) {
            if let Some(mut candidate) = author_from(conv.g("role")) {
                if candidate.get("author_id").map_or(true, |v| v.str_or_empty().is_empty()) && conv.g("userId").truthy() {
                    candidate.insert("author_id".into(), json!(conv.g("userId").str_or_empty()));
                }
                match self.author.as_mut() {
                    None => self.author = Some(candidate),
                    Some(existing) => {
                        for key in ["nickname", "author_id", "avatar"] {
                            let empty = existing.get(key).map_or(true, |v| !v.truthy());
                            if empty && candidate.get(key).is_some_and(Value::truthy) {
                                existing.insert(key.into(), candidate[key].clone());
                            }
                        }
                    }
                }
                break;
            }
        }
        for conv in conversations.iter().filter(|c| c.g("speaker").as_str() == Some("ai")) {
            for speech in conv.g("speechesV2").arr() {
                for replace in speech.at("extra.replaces").arr() {
                    for media in replace.g("multimedias").arr() {
                        self.multimedia(media);
                    }
                }
            }
        }
        if self.title.is_empty() {
            self.title = conversations
                .iter()
                .filter(|c| c.g("speaker").as_str() == Some("human"))
                .find_map(|c| {
                    let prompt = c.g("displayPrompt").or(c.g("speech"));
                    prompt.as_str().filter(|p| !p.trim().is_empty()).map(|_| clean_title(prompt))
                })
                .unwrap_or_else(|| "腾讯元宝分享".into());
        }
        let media_type = card.g("imageFrom").str_or_empty().to_lowercase();
        if let Some(image) = valid(card.g("coverUrl").or(card.g("imageUrl"))) {
            if media_type.contains("video") {
                self.cover.get_or_insert(image);
            } else if self.images.is_empty() {
                self.images.push(image.clone());
                self.cover.get_or_insert(image);
            }
        }
    }

    fn direct_media(&mut self, data: &Value) {
        match data {
            Value::Object(map) => {
                for (key, value) in map {
                    let key = key.to_lowercase();
                    match value {
                        Value::String(_) => {
                            let Some(url) = valid(value) else { continue };
                            if ["avatar", "icon", "logo", "target"].iter().any(|t| key.contains(t)) {
                                continue;
                            }
                            if key.contains("video") || key.contains("playurl") {
                                self.videos.push(url);
                            } else if key.contains("cover") || key.contains("poster") || key.contains("thumbnail") {
                                self.cover.get_or_insert(url);
                            } else if matches!(key.as_str(), "downloadurl" | "imageurl" | "image_url") {
                                self.images.push(url);
                            }
                        }
                        Value::Object(_) | Value::Array(_) => self.direct_media(value),
                        _ => {}
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|i| self.direct_media(i)),
            _ => {}
        }
    }

    fn share_detail(&mut self, detail: &Value) {
        if !detail.is_object() {
            return;
        }
        if self.title.is_empty() {
            self.title = clean_title(detail.g("title").or(detail.g("prompt")));
        }
        let extra = match detail.g("extra") {
            Value::String(raw) => parse_json(raw).unwrap_or(json!({})),
            other => other.clone(),
        };
        if extra.is_object() {
            self.direct_media(&extra);
        }
        self.direct_media(detail);
        if self.author.is_none() {
            self.author = author_from(detail.g("userInfo").or(detail.g("author")));
        }
    }
}

pub fn yuanbao(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let mut headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let cookie = platform_cookie("yuanbao", None);
    if !cookie.is_empty() {
        headers.set("Cookie", cookie.clone());
    }
    let mut state = Yuanbao::default();
    if let Ok(response) = session.get(real_url).headers(&headers).timeout(15.0).ok() {
        let final_url = response.url.clone();
        let html = response.text();
        let doc = Html::parse(&html);
        let payload = doc.script_by_id("__NEXT_DATA__").and_then(|s| parse_json(&s)).unwrap_or(Value::Null);
        let props = payload.at("props.pageProps").clone();
        if props.is_object() {
            let full = props.g("fullChatShareData");
            if full.is_object() {
                state.chat_share(full);
            }
            let detail = props.g("shareDetailData");
            if detail.is_object() {
                state.share_detail(detail);
            }
            if !full.is_object() && !detail.is_object() {
                state.direct_media(&props);
            }
            if state.title.is_empty() {
                if let Some(title) = doc.one("title").map(|t| t.text().collect::<String>().trim().to_string()) {
                    state.title = title;
                }
            }
            state.videos = dedupe(std::mem::take(&mut state.videos));
            state.images = dedupe(std::mem::take(&mut state.images));
        }
        let path = UrlParts::parse(&final_url).path;
        if state.videos.is_empty() && state.images.is_empty() && path.contains("/bot/app/share/") {
            let share_id = props.g("shareId").s().or_else(|| path.trim_end_matches('/').rsplit('/').next().map(str::to_string)).unwrap_or_default();
            let user_id = query_of(&final_url).get("userId").unwrap_or_default();
            if !share_id.is_empty() {
                let mut api_headers = headers! {
                    "User-Agent" => ua_m_at(0),
                    "Accept" => "application/json, text/plain, */*",
                    "Content-Type" => "application/json",
                    "Origin" => "https://yb.tencent.com",
                    "Referer" => final_url.as_str(),
                    "X-Requested-With" => "XMLHttpRequest",
                    "x-source" => "web",
                    "x-verify-flag" => "1",
                };
                if !cookie.is_empty() {
                    api_headers.set("Cookie", cookie);
                }
                if let Ok(response) = session
                    .post("https://yb.tencent.com/api/share/general_share_detail")
                    .headers(&api_headers)
                    .json(&json!({"shareType": "videoWeb", "shareId": share_id, "userId": user_id}))
                    .send()
                {
                    if let Some(detail) = response.json().filter(|d| response.status == 200 && d.is_object() && !d.g("error").truthy()) {
                        if detail.truthy() {
                            state.share_detail(&detail);
                        }
                    }
                }
            }
        }
    }
    Fields {
        title: Some(state.title),
        cover: state.cover,
        videos: state.videos,
        images: state.images.into_iter().map(Value::String).collect(),
        author: state.author.map(Value::Object),
        ..Fields::default()
    }
}
