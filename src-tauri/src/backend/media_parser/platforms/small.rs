//! Small single-request platforms: 虎牙, 全民K歌, 绿洲, 微视, AcFun, 可灵AI.

use super::super::core::*;
use super::super::urls;
use std::sync::Arc;

/// Parser over one JSON document with fixed field paths.
pub struct Simple {
    data: Value,
    video: &'static str,
    cover: &'static str,
    title: &'static str,
}

impl Parser for Simple {
    fn video_url(&mut self) -> Option<String> {
        self.data.at(self.video).s()
    }
    fn cover_url(&mut self) -> Option<String> {
        self.data.at(self.cover).s()
    }
    fn title(&mut self) -> Option<String> {
        self.data.at(self.title).s()
    }
}

pub fn huya(real_url: &str, ctx: &Arc<Ctx>) -> Simple {
    let headers = headers! {"User-Agent" => ua_pc(), "Referer" => "https://www.huya.com/"};
    let data = urls::get_video_id(real_url)
        .filter(|id| id.chars().all(|c| c.is_ascii_digit()))
        .and_then(|id| {
            Session::new(ctx)
                .get(format!("https://liveapi.huya.com/moment/getMomentContent?videoId={id}"))
                .headers(&headers)
                .json_value()
        })
        .unwrap_or(Value::Null);
    Simple {
        data,
        video: "data.moment.videoInfo.definitions.0.url",
        cover: "data.moment.videoInfo.videoCover",
        title: "data.moment.videoInfo.videoTitle",
    }
}

pub fn quanminkge(real_url: &str, ctx: &Arc<Ctx>) -> Simple {
    let headers = headers! {"User-Agent" => ua_pc(), "Referer" => "https://kg.qq.com/"};
    let data = query_of(real_url)
        .get("s")
        .and_then(|id| {
            Session::new(ctx)
                .get(format!("https://kg.qq.com/node/play?s={id}"))
                .headers(&headers)
                .text()
        })
        .and_then(|html| {
            re!(r"(?s)window\.__DATA__\s*=\s*(\{.*?\})\s*;\s*</script>")
                .captures(&html)
                .and_then(|c| parse_json(&c[1]))
        })
        .unwrap_or(Value::Null);
    Simple {
        data,
        video: "detail.playurl_video",
        cover: "detail.cover",
        title: "detail.content",
    }
}

pub struct Lvzhou {
    html: String,
}

impl Lvzhou {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Lvzhou {
        let headers = headers! {"User-Agent" => ua_m(), "Referer" => "https://oasis.weibo.cn/"};
        Lvzhou {
            html: Session::new(ctx).get(real_url).headers(&headers).text().unwrap_or_default(),
        }
    }
}

impl Parser for Lvzhou {
    fn video_url(&mut self) -> Option<String> {
        let doc = Html::parse(&self.html);
        doc.one("video").and_then(|v| v.value().attr("src").map(str::to_string))
    }
    fn image_list(&mut self) -> Vec<Value> {
        Html::parse(&self.html)
            .select(".media img")
            .into_iter()
            .filter_map(|img| img.value().attr("src").filter(|s| !s.is_empty()).map(|s| json!(s)))
            .collect()
    }
    fn cover_url(&mut self) -> Option<String> {
        if let Some(c) = re!(r"background-image:url\((.*?)\)").captures(&self.html) {
            return Some(c[1].to_string());
        }
        self.image_list().first().and_then(|v| v.s())
    }
    fn title(&mut self) -> Option<String> {
        Html::parse(&self.html).text(".status-text, .status-title")
    }
    fn author(&mut self) -> Option<Value> {
        let doc = Html::parse(&self.html);
        let Some(nickname) = doc.one(".user .nickname") else { return Some(json!({})) };
        let avatar = doc.attr(".user .avatar img", "src").unwrap_or_default();
        Some(author(element_text(&nickname), "", avatar))
    }
}

pub struct Weishi {
    data: Value,
}

impl Weishi {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Weishi {
        let headers = headers! {
            "content-type" => "application/json; charset=UTF-8",
            "User-Agent" => ua_pc(),
            "referer" => "https://isee.weishi.qq.com",
        };
        let html = Session::new(ctx).get(real_url).headers(&headers).timeout(5.0).text().unwrap_or_default();
        let data = script_json(&html, re!(r"(?s)window\.Vise\.initState\s*=\s*(\{.*\};)"))
            .and_then(|raw| parse_json(&raw))
            .unwrap_or(Value::Null);
        Weishi { data }
    }
    fn feed(&self) -> &Value {
        self.data.g("feedsList").i(0)
    }
}

impl Parser for Weishi {
    fn video_url(&mut self) -> Option<String> {
        self.feed().g("videoUrl").s()
    }
    fn title(&mut self) -> Option<String> {
        self.feed().g("feedDesc").s()
    }
    fn cover_url(&mut self) -> Option<String> {
        self.feed().g("videoCover").s()
    }
    fn author(&mut self) -> Option<Value> {
        if !self.feed().is_object() {
            return None;
        }
        let poster = self.feed().g("poster");
        Some(author(
            poster.g("nick").s().unwrap_or_else(|| "未知用户".into()),
            poster.g("id").str_or_empty(),
            poster.g("avatar").str_or_empty(),
        ))
    }
}

pub struct Acfun {
    data: Value,
}

impl Acfun {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Acfun {
        let headers = headers! {"User-Agent" => ua_pc()};
        let data = Session::new(ctx)
            .get(real_url)
            .headers(&headers)
            .send()
            .ok()
            .filter(|r| r.status == 200)
            .and_then(|r| {
                re!(r"window\.pageInfo\s*=\s*(?:window\.videoInfo\s*=\s*)?(\{.*?\});")
                    .captures(&r.text())
                    .and_then(|c| parse_json(&c[1]))
            })
            .unwrap_or(Value::Null);
        Acfun { data }
    }
}

impl Parser for Acfun {
    fn video_url(&mut self) -> Option<String> {
        let play = self.data.at("currentVideoInfo.ksPlayJson").s().and_then(|raw| parse_json(&raw))?;
        play.g("adaptationSet").i(0).g("representation").i(0).g("url").s()
    }
    fn title(&mut self) -> Option<String> {
        self.data.g("title").s()
    }
    fn cover_url(&mut self) -> Option<String> {
        self.data.g("coverUrl").s()
    }
    fn author(&mut self) -> Option<Value> {
        let user = self.data.g("user");
        user.truthy().then(|| {
            author(user.g("name").str_or_empty(), user.g("id").str_or_empty(), user.g("headUrl").str_or_empty())
        })
    }
}

pub struct Kling {
    detail: Value,
}

fn resource(value: &Value) -> Option<String> {
    value.g("resource").text().map(|r| r.replace("\\/", "/"))
}

impl Kling {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Kling {
        let text = real_url.trim();
        let (mut id, mut kind) = (String::new(), "WORK".to_string());
        if text.contains("://") {
            let query = query_of(text);
            if let Some(found) = query.any(&["creative_id", "work_id"]) {
                id = found;
                kind = query.get("creative_type").unwrap_or_else(|| "WORK".into());
            }
        }
        if id.is_empty() && !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()) {
            id = text.to_string();
        }
        let headers = headers! {
            "User-Agent" => ua_m_at(-4),
            "Accept" => "application/json, text/plain, */*",
            "Accept-Language" => "zh",
            "Referer" => "https://klingai-share.kuaishou.com/",
        };
        let detail = if id.is_empty() {
            Value::Null
        } else {
            Session::new(ctx)
                .get("https://klingai-share.kuaishou.com/app/creatives/query")
                .query(&[("creativeId", id), ("creativeType", kind)])
                .headers(&headers)
                .timeout(15.0)
                .json_value()
                .filter(|r| r.g("status").as_i64() == Some(200) && r.g("result").as_i64() == Some(1) && r.g("data").is_object())
                .map(|r| r.g("data").clone())
                .unwrap_or(Value::Null)
        };
        Kling { detail }
    }
}

impl Parser for Kling {
    fn video_url(&mut self) -> Option<String> {
        resource(self.detail.g("resource"))
    }
    fn title(&mut self) -> Option<String> {
        Some(self.detail.g("introduction").s().unwrap_or_else(|| "可灵AI 作品".into()))
    }
    fn cover_url(&mut self) -> Option<String> {
        resource(self.detail.g("cover")).or_else(|| resource(self.detail.g("firstFrame")))
    }
    fn author(&mut self) -> Option<Value> {
        let profile = self.detail.g("userProfile");
        Some(json!({
            "nickname": profile.g("userName").s().unwrap_or_default(),
            "author_id": profile.g("userId").text().filter(|_| profile.g("userId").truthy()).unwrap_or_default(),
            "avatar": resource(profile.g("avatar")).unwrap_or_default(),
            "description": "",
        }))
    }
}
