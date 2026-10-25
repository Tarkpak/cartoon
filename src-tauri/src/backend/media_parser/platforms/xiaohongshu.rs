//! 小红书 (upstream `xiaohongshu_parser.py`).

use super::super::core::*;
use std::sync::Arc;

pub struct Xiaohongshu {
    flags: Flags,
    note: Value,
}

fn terminal(message: &str) -> Option<Value> {
    Some(json!({"detail_msg": message}))
}

impl Xiaohongshu {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Xiaohongshu {
        let mut parser = Xiaohongshu {
            flags: Flags::default(),
            note: Value::Null,
        };
        parser.fetch(real_url, &Session::new(ctx));
        parser
    }

    fn fetch(&mut self, real_url: &str, session: &Session) {
        let cookie = platform_cookie("xhs", None);
        let candidates = [ua_pc_at(0), ua_m_at(0)];
        for (index, ua) in candidates.iter().enumerate() {
            let last = index == candidates.len() - 1;
            let mut headers = headers! {
                "User-Agent" => ua.as_str(),
                "Referer" => "https://www.xiaohongshu.com/",
                "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            };
            if !cookie.is_empty() {
                headers.set("Cookie", cookie.clone());
            }
            let Ok(response) = session.get(real_url).headers(&headers).timeout(6.0).send() else {
                continue;
            };
            if response.status == 404 {
                if last {
                    self.flags.terminal_error = terminal("该小红书笔记已被作者删除或不存在");
                }
                continue;
            }
            if response.status != 200 {
                continue;
            }
            if response.url.contains("xiaohongshu.com/404") || response.url.contains("undertake_note_error") {
                if last {
                    self.flags.terminal_error = terminal("该小红书笔记已被作者删除或不存在");
                }
                continue;
            }
            if response.url.contains("xiaohongshu.com/login") {
                if last && self.flags.terminal_error.is_none() {
                    self.flags.terminal_error = terminal(if cookie.is_empty() {
                        "访问被小红书风控拦截（需在后台系统设置中配置小红书 Cookie 凭据）"
                    } else {
                        "小红书 Cookie 凭据可能已失效或访问受限，请在后台更新"
                    });
                }
                continue;
            }
            if let Some(note) = self.extract_note(&response.text()) {
                self.note = note;
                return;
            }
            if self.flags.terminal_error.is_some() {
                return;
            }
        }
    }

    pub fn extract_note(&mut self, html: &str) -> Option<Value> {
        let raw = re!(r"(?s)window\.__INITIAL_STATE__\s*=\s*(\{.*?\})</script>")
            .captures(html)
            .or_else(|| re!(r"(?s)window\.__INITIAL_STATE__\s*=\s*(\{.*\})").captures(html))?
            .get(1)?
            .as_str()
            .to_string();
        let raw = re!(r"\bundefined\b").replace_all(&raw, "null");
        let raw = re!(r"new\s+Map\s*\([^)]*\)").replace_all(&raw, "{}");
        let raw = re!(r"new\s+Set\s*\([^)]*\)").replace_all(&raw, "[]");
        let raw = re!(r"new\s+Date\s*\([^)]*\)").replace_all(&raw, "null");
        let full = parse_json(&raw)?;
        if let Some(first_id) = full.at("note.firstNoteId").s() {
            let item = full.g("note").g("noteDetailMap").g(&first_id);
            if item.is_object() {
                let note = item.g("note");
                if note.is_object() && note.truthy() {
                    return Some(note.clone());
                }
                if note.is_object() {
                    self.flags.terminal_error = terminal("该小红书笔记已被作者删除或设置为私密不可见");
                    return None;
                }
            }
        }
        let note = full.at("noteData.data.noteData");
        if note.truthy() {
            return Some(note.clone());
        }
        let fallback = full.at("noteData.note").or(full.at("note.note"));
        fallback.truthy().then(|| fallback.clone())
    }

    pub fn clean_image(image: &Value) -> Option<String> {
        if !image.truthy() {
            return None;
        }
        let mut file_id = None;
        let mut url = None;
        match image {
            Value::Object(_) => {
                file_id = image.g("fileId").s();
                url = image.g("urlDefault").or(image.g("url")).s();
                if url.is_none() {
                    let list = image.g("infoList").arr();
                    if let Some(last) = list.last() {
                        url = last.g("url").s().or_else(|| list[0].g("url").s());
                    }
                }
            }
            Value::String(text) => url = Some(text.clone()),
            _ => {}
        }
        if let Some(file_id) = file_id {
            return Some(format!("https://sns-img-qc.xhscdn.com/{file_id}?imageView2/2/w/1920/format/jpg"));
        }
        let url = url?.replace("\\u002F", "/");
        if let Some(c) = re!(r"/[0-9a-f]{32}/(.+?)(?:!|$)").captures(&url) {
            return Some(format!("https://sns-img-qc.xhscdn.com/{}?imageView2/2/w/1920/format/jpg", &c[1]));
        }
        Some(re!(r"![^?]*").replace_all(&url, "").into_owned())
    }

    fn ensure_https(url: &str) -> String {
        https_str(&url.replace("\\u002F", "/"))
    }

    fn origin_key(key: &str) -> String {
        if key.starts_with("http://") || key.starts_with("https://") {
            Self::ensure_https(key)
        } else {
            format!("https://sns-video-bd.xhscdn.com/{}", key.trim_start_matches('/'))
        }
    }
}

impl Parser for Xiaohongshu {
    fn flags(&self) -> Option<&Flags> {
        Some(&self.flags)
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        Some(&mut self.flags)
    }

    fn author(&mut self) -> Option<Value> {
        let user = self.note.g("user");
        Some(author(
            user.g("nickname").or(user.g("nickName")).str_or_empty(),
            first([user.g("userId"), user.g("author_id"), user.g("id")]).clone(),
            user.g("avatar").str_or_empty(),
        ))
    }

    fn video_url(&mut self) -> Option<String> {
        let video = self.note.g("video");
        if !video.is_object() {
            return None;
        }
        let consumer = video.g("consumer");
        let key = consumer
            .g("originVideoKey")
            .or(consumer.g("origin_video_key"))
            .s()
            .or_else(|| video.g("originVideoKey").or(video.g("origin_video_key")).s());
        if let Some(key) = key {
            return Some(Self::origin_key(&key));
        }
        if let Some(media) = video.g("mediaV2").s().and_then(|raw| parse_json(&raw)) {
            let opaque = media.at("video.opaque1");
            for key in ["hd_screencast_stream", "default_screencast_stream"] {
                if let Some(url) = opaque.g(key).s() {
                    return Some(Self::ensure_https(&url));
                }
            }
            let consumer = media.at("video.consumer").or(media.g("consumer"));
            if let Some(key) = consumer.g("originVideoKey").or(consumer.g("origin_video_key")).s() {
                return Some(Self::origin_key(&key));
            }
        }
        let stream = video.at("media.stream").or(video.g("stream"));
        let mut clean = Vec::new();
        let mut fallback = Vec::new();
        for codec in ["h264", "h265", "av1"] {
            for item in stream.g(codec).arr() {
                let Some(master) = item.g("masterUrl").s() else { continue };
                let url = Self::ensure_https(&master);
                let kind = item.g("streamType");
                let kind = kind.as_i64();
                let desc = item.g("streamDesc").str_or_empty();
                if matches!(kind, Some(258 | 301)) || desc.contains("X264_MP4") || !matches!(kind, Some(259 | 309)) {
                    clean.push(url);
                } else {
                    fallback.push(url);
                }
            }
        }
        clean.into_iter().next().or_else(|| fallback.into_iter().next())
    }

    fn title(&mut self) -> Option<String> {
        self.note.g("title").s()
    }

    fn description(&mut self) -> Option<String> {
        self.note.g("desc").s()
    }

    fn cover_url(&mut self) -> Option<String> {
        let cover = self.note.g("cover");
        if cover.truthy() {
            if let Some(url) = opt(Self::clean_image(cover)) {
                return Some(url);
            }
        }
        opt(Self::clean_image(self.note.g("imageList").i(0)))
    }

    fn image_list(&mut self) -> Vec<Value> {
        let mut images = Vec::new();
        for image in self.note.g("imageList").arr() {
            if !image.is_object() {
                continue;
            }
            let Some(url) = opt(Self::clean_image(image)) else { continue };
            let live = image
                .g("livePhoto")
                .truthy()
                .then(|| image.at("stream.h264").i(0).g("masterUrl").s())
                .flatten()
                .map(|u| Self::ensure_https(&u));
            images.push(image_with_live(url, live));
        }
        images
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_pc_note_and_media() {
        let html = r#"<script>window.__INITIAL_STATE__={"note":{"firstNoteId":"n1","noteDetailMap":{"n1":{"note":{"title":"标题","desc":"正文","user":{"nickname":"作者","userId":"u"},"video":{"consumer":{"originVideoKey":"pre_post/abc"}},"imageList":[{"urlDefault":"http://sns-webpic-qc.xhscdn.com/202401/0123456789abcdef0123456789abcdef/spectrum/xyz!nd_dft","livePhoto":true,"stream":{"h264":[{"masterUrl":"http://live/1.mp4"}]}}],"time":undefined}}}}}</script>"#;
        let mut parser = Xiaohongshu { flags: Flags::default(), note: Value::Null };
        parser.note = parser.extract_note(html).unwrap();
        assert_eq!(parser.title().as_deref(), Some("标题"));
        assert_eq!(parser.video_url().as_deref(), Some("https://sns-video-bd.xhscdn.com/pre_post/abc"));
        let images = parser.image_list();
        assert_eq!(images[0]["url"], "https://sns-img-qc.xhscdn.com/spectrum/xyz?imageView2/2/w/1920/format/jpg");
        assert_eq!(images[0]["live_photo_url"], "https://live/1.mp4");
        assert_eq!(parser.author().unwrap()["nickname"], "作者");
    }
}
