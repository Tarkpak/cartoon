//! 微博 (upstream `weibo_parser.py`).

use super::super::core::*;
use std::sync::Arc;

const ALPHABET: &str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

fn base62_decode(text: &str) -> Option<u128> {
    text.chars().try_fold(0u128, |acc, ch| {
        ALPHABET.find(ch).map(|index| acc * 62 + index as u128)
    })
}

/// Base62 mid (e.g. `O8yqz0I8Q`) to numeric status id.
pub fn mid_to_id(mid: &str) -> Option<String> {
    let reversed: Vec<char> = mid.chars().rev().collect();
    let chunks: Vec<String> = reversed
        .chunks(4)
        .map(|chunk| chunk.iter().rev().collect())
        .collect();
    let size = chunks.len();
    let mut parts = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let mut part = base62_decode(chunk)?.to_string();
        if index != size - 1 {
            part = format!("{part:0>7}");
        }
        parts.push(part);
    }
    parts.reverse();
    parts.concat().parse::<u128>().ok().map(|n| n.to_string())
}

fn numeric_or_mid(segment: &str) -> Option<String> {
    if segment.chars().all(|c| c.is_ascii_digit()) {
        Some(segment.to_string())
    } else {
        mid_to_id(segment)
    }
}

fn protocol_relative(url: &str) -> String {
    if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    }
}

fn strip_watermark(url: &str) -> String {
    let url = protocol_relative(url);
    re!(r"(sinaimg\.cn/)(?:mw\d+|large|bmiddle|thumbnail|thumb\d+|woriginal|orj\d+|wap\d+)(/)")
        .replace_all(&url, "${1}osj1080${2}")
        .into_owned()
}

fn jsonp(text: &str) -> Value {
    let (Some(start), Some(end)) = (text.find('('), text.rfind(')')) else { return Value::Null };
    if end <= start {
        return Value::Null;
    }
    parse_json(&text[start + 1..end]).unwrap_or(Value::Null)
}

pub struct Weibo {
    session: Session,
    headers: Headers,
    real_url: String,
    video_oid: Option<String>,
    numeric_id: Option<String>,
    post: Value,
}

impl Weibo {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Weibo {
        let mut headers = headers! {"User-Agent" => ua_pc(), "referer" => "https://weibo.com/"};
        let cookie = platform_cookie("weibo", None);
        if !cookie.is_empty() {
            headers.set("Cookie", cookie);
        }
        let mut parser = Weibo {
            session: Session::new(ctx),
            headers,
            real_url: real_url.to_string(),
            video_oid: None,
            numeric_id: None,
            post: Value::Null,
        };
        parser.video_oid = parser.extract_video_oid();
        parser.numeric_id = parser.extract_id();
        parser.post = parser.fetch_post();
        parser
    }

    fn extract_video_oid(&self) -> Option<String> {
        let parts = UrlParts::parse(&self.real_url);
        let fid = parts.qs().get("fid").unwrap_or_default();
        if re!(r"^\d+:[a-zA-Z0-9]+$").is_match(&fid) {
            return Some(fid);
        }
        re!(r"/(?:tv/|l/wblive/p/)?show/(\d+:[a-zA-Z0-9]+)")
            .captures(&parts.path)
            .or_else(|| re!(r"/show/(\d+:[a-zA-Z0-9]+)").captures(&self.real_url))
            .map(|c| c[1].to_string())
    }

    fn extract_id(&self) -> Option<String> {
        let url = &self.real_url;
        let parts = UrlParts::parse(url);
        let fid = parts.qs().get("fid").unwrap_or_default();
        if let Some(c) = re!(r"^\d+:([a-zA-Z0-9]+)$").captures(&fid) {
            return Some(c[1].to_string());
        }
        if let Some(c) = re!(r"/(?:tv/|l/wblive/p/)?show/\d+:([a-zA-Z0-9]+)")
            .captures(&parts.path)
            .or_else(|| re!(r"/show/\d+:([a-zA-Z0-9]+)").captures(url))
        {
            return Some(c[1].to_string());
        }
        if let Some(c) = re!(r"weibo\.(?:com|cn)/\d+/([a-zA-Z0-9]+)(?:/|\?|$)").captures(url) {
            return numeric_or_mid(&c[1]);
        }
        if let Some(c) = re!(r"weibo\.(?:cn|com)/(?:\d+/)?(?:status/|detail/|statuses/show\?id=)([a-zA-Z0-9]+)").captures(url) {
            return numeric_or_mid(&c[1]);
        }
        if let Some(c) = re!(r"id=(\d+)").captures(url) {
            return Some(c[1].to_string());
        }
        if let Some(c) = re!(r"id=([a-zA-Z0-9]+)").captures(url) {
            return numeric_or_mid(&c[1]);
        }
        if let Some(c) = re!(r"/([a-zA-Z0-9]{9})\b").captures(url) {
            return numeric_or_mid(&c[1]);
        }
        None
    }

    fn fetch_post(&self) -> Value {
        if self.video_oid.is_some() {
            return self.fetch_video_page();
        }
        let Some(id) = self.numeric_id.clone() else { return Value::Null };
        let headers = headers! {
            "User-Agent" => ua_m(),
            "Accept" => "application/json, text/plain, */*",
            "MWeibo-Pwa" => "1",
            "X-Requested-With" => "XMLHttpRequest",
            "Referer" => format!("https://m.weibo.cn/detail/{id}"),
        };
        if let Ok(response) = self
            .session
            .get(format!("https://m.weibo.cn/statuses/show?id={id}"))
            .headers(&headers)
            .send()
        {
            if response.status == 200 {
                if let Some(data) = response.json() {
                    if data.g("ok").as_i64() == Some(1) {
                        return data.g("data").clone();
                    }
                }
            }
        }
        self.fallback_ajax(&id)
    }

    fn init_visitor(&self) -> bool {
        let fingerprint = json!({
            "os": "1", "browser": "Chrome", "fonts": "undefined", "screenInfo": "1440*900*24",
            "plugins": "", "ls": "undefined", "wh": "", "version": "1.0.0", "vendor": "Google Inc.",
            "ua": "Mozilla/5.0",
        });
        let headers = self.headers.with("Referer", "https://weibo.com/");
        let Ok(response) = self
            .session
            .get("https://passport.weibo.com/visitor/genvisitor")
            .query(&[("cb", "parser_callback".to_string()), ("fp", py_json_with(&fingerprint, ",", ":", true))])
            .headers(&headers)
            .send()
        else {
            return false;
        };
        let Some(tid) = jsonp(&response.text()).at("data.tid").text() else { return false };
        let rand: f64 = rand::random();
        let params = [
            ("a", "incarnate".to_string()),
            ("t", tid),
            ("w", "2".into()),
            ("c", "095".into()),
            ("gc", String::new()),
            ("cb", "parser_callback".into()),
            ("from", "weibo".into()),
            ("_rand", rand.to_string()),
        ];
        self.session
            .get("https://passport.weibo.com/visitor/visitor")
            .query(&params)
            .headers(&headers)
            .send()
            .map(|r| jsonp(&r.text()).g("retcode").as_i64() == Some(20000000))
            .unwrap_or(false)
    }

    fn fetch_video_page(&self) -> Value {
        if !self.init_visitor() {
            return Value::Null;
        }
        let oid = self.video_oid.clone().unwrap_or_default();
        let mut headers = self.headers.with("Referer", self.real_url.clone());
        headers.set("PAGE-REFERER", UrlParts::parse(&self.real_url).path);
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        let payload = json!({"Component_Play_Playinfo": {"oid": oid}});
        if let Ok(response) = self
            .session
            .post("https://weibo.com/tv/api/component")
            .form(&[("data", py_json_with(&payload, ",", ":", true))])
            .headers(&headers)
            .send()
        {
            if let Some(data) = response.json() {
                if data.g("code").as_str() == Some("100000") {
                    let info = data.at("data.Component_Play_Playinfo");
                    if info.truthy() {
                        return info.clone();
                    }
                }
            }
        }
        if oid.starts_with("1022:") {
            if let Some(data) = self
                .session
                .get("https://weibo.com/l/!/2/wblive/room/show_pc_live.json")
                .query(&[("live_id", &oid)])
                .headers(&self.headers.with("Referer", self.real_url.clone()))
                .send()
                .ok()
                .and_then(|r| r.json())
            {
                if data.g("code").as_i64() == Some(100000) && data.g("data").truthy() {
                    return data.g("data").clone();
                }
            }
        }
        Value::Null
    }

    fn fallback_ajax(&self, id: &str) -> Value {
        let headers = headers! {"User-Agent" => ua_m(), "Accept" => "text/html,application/xhtml+xml,application/xml;"};
        if let Ok(response) = self.session.get(format!("https://m.weibo.cn/detail/{id}")).headers(&headers).send() {
            if let Some(c) = re!(r"(?s)\$render_data\s*=\s*\[(.*?)\]\[0\]\s*\|\|").captures(&response.text()) {
                if let Some(data) = parse_json(&c[1]) {
                    return data.g("status").clone();
                }
            }
        }
        let headers = headers! {"User-Agent" => ua_pc(), "Referer" => "https://weibo.com/"};
        self.session
            .get(format!("https://weibo.com/ajax/statuses/show?id={id}"))
            .headers(&headers)
            .send()
            .ok()
            .filter(|r| r.status == 200)
            .and_then(|r| r.json())
            .unwrap_or(Value::Null)
    }
}

impl Parser for Weibo {
    fn video_url(&mut self) -> Option<String> {
        let post = &self.post;
        if let Some(live) = first_str([post.g("replay_origin_url"), post.g("live_origin_hls_url"), post.g("live_origin_flv_url")]) {
            return Some(protocol_relative(&live));
        }
        if let Some(urls) = post.g("urls").obj() {
            if let Some(url) = urls.values().find(|v| v.truthy()).and_then(|v| v.s()) {
                return Some(protocol_relative(&url));
            }
        }
        let media = post.at("page_info.media_info");
        if let Some(url) = first_str([media.g("mp4_hd_url"), media.g("mp4_sd_url"), media.g("stream_url_hd"), media.g("stream_url")]) {
            return Some(url);
        }
        media
            .g("playback_list")
            .arr()
            .iter()
            .find_map(|pb| pb.at("play_info.url").s())
    }

    fn title(&mut self) -> Option<String> {
        self.post.g("title").s()
    }

    fn description(&mut self) -> Option<String> {
        let post = &self.post;
        let content = first([post.g("text_raw"), post.g("text"), post.g("content"), post.g("title")]).str_or_empty();
        opt(Some(re!(r"<[^>]+>").replace_all(&content, "").into_owned()))
    }

    fn cover_url(&mut self) -> Option<String> {
        if let Some(cover) = first_str([self.post.g("cover"), self.post.g("cover_image")]) {
            return Some(strip_watermark(&cover));
        }
        let page = self.post.g("page_info");
        if page.truthy() && !matches!(page.g("type").as_str(), Some("topic" | "search" | "place")) {
            return page.at("page_pic.url").s().map(|u| strip_watermark(&u));
        }
        None
    }

    fn image_list(&mut self) -> Vec<Value> {
        let pics = self.post.g("pics").arr();
        let live_list = self.post.g("live_photo").arr();
        if !pics.is_empty() {
            let has_live = pics
                .iter()
                .any(|p| p.g("type").as_str() == Some("livephoto") || p.g("videoSrc").truthy())
                || !live_list.is_empty();
            let mut images = Vec::new();
            for (index, pic) in pics.iter().enumerate() {
                let Some(url) = pic.at("large.url").or(pic.g("url")).s().map(|u| strip_watermark(&u)) else { continue };
                if has_live {
                    let live = pic.g("videoSrc").s().or_else(|| live_list.get(index).and_then(|v| v.s()));
                    images.push(json!({"url": url, "live_photo_url": opt_value(live)}));
                } else {
                    images.push(Value::String(url));
                }
            }
            if !images.is_empty() {
                return images;
            }
        }
        self.post
            .g("pic_ids")
            .arr()
            .iter()
            .filter_map(|id| id.text())
            .map(|id| Value::String(format!("https://wx1.sinaimg.cn/osj1080/{id}.jpg")))
            .collect()
    }

    fn author(&mut self) -> Option<Value> {
        let post = &self.post;
        let user = post.g("user");
        if !user.truthy() && !post.g("author").truthy() {
            return None;
        }
        Some(author(
            first([user.g("screen_name"), user.g("screenName"), post.g("author")]).str_or_empty(),
            first([user.g("id"), user.g("uid"), post.g("author_id")]).str_or_empty(),
            first([user.g("avatar_hd"), user.g("profile_image_url"), user.g("avatar"), post.g("avatar")]).str_or_empty(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_mid_and_watermarks() {
        assert_eq!(mid_to_id("O8yqz0I8Q").as_deref(), Some("5020389670169684"));
        assert_eq!(
            strip_watermark("//wx1.sinaimg.cn/mw690/abc.jpg"),
            "https://wx1.sinaimg.cn/osj1080/abc.jpg"
        );
    }
}
