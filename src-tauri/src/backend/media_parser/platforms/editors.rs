//! 剪映 / CapCut and 快影 templates.

use super::super::core::*;
use std::sync::Arc;

const JIANYING_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub struct Template {
    data: Value,
    default_title: Option<&'static str>,
    kind: TemplateKind,
}

#[derive(PartialEq)]
enum TemplateKind {
    Jianying,
    Kwaiying,
}

fn capcut_sign(path: &str, timestamp: u64) -> String {
    let tail = &path[path.len() - 7..];
    md5_hex(format!("9e2c|{tail}|7||{timestamp}||11ac"))
}

fn capcut(session: &Session, real_url: &str, share_id: &str) -> Value {
    if share_id.is_empty() {
        return Value::Null;
    }
    let timestamp = now_secs();
    let headers = |path: &str| {
        headers! {
            "sign" => capcut_sign(path, timestamp),
            "device-time" => timestamp.to_string(),
            "pf" => "7",
            "sign-ver" => "1",
            "User-Agent" => JIANYING_UA,
            "Content-Type" => "application/json",
            "Origin" => "https://www.capcut.cn",
            "Referer" => real_url,
        }
    };
    let mut inner = share_id.to_string();
    if let Ok(response) = session
        .post("https://www.capcut.cn/lv/v1/coordination/cluster_list")
        .headers(&headers("/lv/v1/coordination/cluster_list"))
        .json(&json!({"share_id": share_id, "password": ""}))
        .timeout(12.0)
        .send()
    {
        if response.status == 200 {
            if let Some(found) = response.json().and_then(|j| j.at("data.share_info_list.0.share_id").text()) {
                inner = found;
            }
        }
    }
    let Some(data) = session
        .post("https://www.capcut.cn/lv/v1/coordination/share_detail_query")
        .headers(&headers("/lv/v1/coordination/share_detail_query"))
        .json(&json!({"share_id": inner}))
        .timeout(12.0)
        .json_value()
        .map(|j| j.g("data").clone())
        .filter(Value::truthy)
    else {
        return Value::Null;
    };
    let player = |video: &Value| first_str([video.at("player_720p.main_url"), video.at("player_480p.main_url"), video.at("player_360p.main_url")]);
    let video = player(data.g("normal_video")).or_else(|| player(data.g("video")));
    let cover = data.g("cover_image");
    let duration = data.g("duration").str_or_empty();
    json!({
        "video_url": opt_value(video),
        "title": first_str([data.g("file_name"), data.g("share_name")]).unwrap_or_else(|| "CapCut视频".into()),
        "cover_url": first_str([cover.g("preview_1080p_url"), cover.g("preview_720p_url"), cover.g("preview_360p_url")]).unwrap_or_default(),
        "author": {"name": data.g("uploader_name").str_or_empty(), "id": data.g("uploader_id").str_or_empty(), "avatar": ""},
        "duration": if !duration.is_empty() && duration.chars().all(|c| c.is_ascii_digit()) { duration.parse::<i64>().unwrap_or(0) / 1000 } else { 0 },
    })
}

pub fn jianying(real_url: &str, ctx: &Arc<Ctx>) -> Template {
    let session = Session::new(ctx);
    let parts = UrlParts::parse(real_url);
    let data = if parts.netloc.contains("capcut") || parts.path.contains("/share/") {
        let id = re!(r"/share/(\d+)").captures(&parts.path).map(|c| c[1].to_string()).unwrap_or_default();
        capcut(&session, real_url, &id)
    } else {
        let query = parts.qs();
        let template_id = query.get("template_id").unwrap_or_default();
        let item_type = query.get("item_type").and_then(|t| t.trim().parse::<i64>().ok()).unwrap_or(0);
        if template_id.is_empty() {
            Value::Null
        } else {
            let timestamp = now_secs();
            let headers = headers! {
                "sign" => md5_hex(format!("9e2c|mplates|0||{timestamp}||11ac")),
                "pf" => "0",
                "sign-ver" => "1",
                "device-time" => timestamp.to_string(),
                "User-Agent" => JIANYING_UA,
                "Content-Type" => "application/json",
                "Origin" => "https://lv.ulikecam.com",
                "Referer" => "https://lv.ulikecam.com/",
            };
            session
                .post("https://lv-api.ulikecam.com/lv/v1/web/replicate/multi_get_templates")
                .headers(&headers)
                .json(&json!({"sdk_version": "100.0.0", "id": [template_id], "scene": "share", "item_type": item_type}))
                .timeout(15.0)
                .json_value()
                .map(|j| j.at("data.templates.0").clone())
                .filter(Value::is_object)
                .unwrap_or(Value::Null)
        }
    };
    Template { data, default_title: Some("剪映模板"), kind: TemplateKind::Jianying }
}

/// Kwaiying API nonce signature.
pub fn kwaiying_sign(now_ms: u64, nonce: u64) -> String {
    let hex: String = "yiuhjkbvhbjisjchgdnx38uejd".chars().map(|c| format!("{:x}", c as u32)).collect();
    let digits: String = hex.chars().filter(|c| c.is_ascii_digit()).take(16).collect();
    let a: u64 = digits.parse().unwrap_or(0);
    let s = (a ^ now_ms) | a;
    md5_hex((nonce ^ s).to_string())
}

pub fn kwaiying(real_url: &str, ctx: &Arc<Ctx>) -> Template {
    let query = query_of(real_url);
    let template_id = query
        .any(&["id", "templateId"])
        .or_else(|| re!(r"(?:id|templateId|template_id)=(\d+)").captures(real_url).map(|c| c[1].to_string()));
    let data = template_id
        .and_then(|id| {
            let now = now_millis() as u64;
            let nonce: u64 = rand::Rng::gen_range(&mut rand::thread_rng(), 100000000000..=999999999999);
            let headers = headers! {
                "User-Agent" => "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
                "Origin" => "https://share.kwaiying.com",
                "Referer" => real_url,
            };
            Session::new(ctx)
                .get("https://api.kmovie.gifshow.com/rest/n/kmovie/app/resource/getTemplateById")
                .headers(&headers)
                .query(&[
                    ("timestamp", now.to_string()),
                    ("nonce", nonce.to_string()),
                    ("sign", kwaiying_sign(now, nonce)),
                    ("templateId", id),
                ])
                .timeout(12.0)
                .json_value()
        })
        .filter(|j| j.g("result").as_i64() == Some(1) && j.g("resource").truthy())
        .map(|j| j.g("resource").clone())
        .unwrap_or(Value::Null);
    Template { data, default_title: None, kind: TemplateKind::Kwaiying }
}

impl Parser for Template {
    fn video_url(&mut self) -> Option<String> {
        match self.kind {
            TemplateKind::Jianying => self.data.g("video_url").s(),
            TemplateKind::Kwaiying => self.data.g("videoUrl").s(),
        }
    }
    fn video_list(&mut self) -> Vec<String> {
        self.video_url().into_iter().collect()
    }
    fn title(&mut self) -> Option<String> {
        match self.kind {
            TemplateKind::Jianying => first_str([self.data.g("title"), self.data.g("short_title")]).or(self.default_title.map(str::to_string)),
            TemplateKind::Kwaiying => self.data.g("name").s(),
        }
    }
    fn description(&mut self) -> Option<String> {
        match self.kind {
            TemplateKind::Jianying => None,
            TemplateKind::Kwaiying => self.data.at("templateBean.description").s(),
        }
    }
    fn cover_url(&mut self) -> Option<String> {
        match self.kind {
            TemplateKind::Jianying => first_str([self.data.g("cover_url"), self.data.g("cover")]),
            TemplateKind::Kwaiying => {
                let bean = self.data.g("templateBean");
                first_str([bean.g("coverUrl"), bean.g("coverWebPUrl")])
            }
        }
    }
    fn author(&mut self) -> Option<Value> {
        match self.kind {
            TemplateKind::Jianying => {
                let a = self.data.g("author");
                let aweme = a.g("aweme_info");
                Some(json!({
                    "nickname": first([a.g("name"), a.g("nickname"), aweme.g("name")]).str_or_empty(),
                    "author_id": first([a.g("uid"), a.g("id"), aweme.g("uid")]).str_or_empty(),
                    "avatar": first([a.g("avatar"), a.g("avatar_url"), aweme.g("avatar_url")]).str_or_empty(),
                    "description": a.g("description").str_or_empty(),
                }))
            }
            TemplateKind::Kwaiying => {
                let user = self.data.g("user");
                Some(author(
                    user.g("nickName").str_or_empty(),
                    first([user.g("userId"), user.g("ksUserId")]).str_or_empty(),
                    user.g("iconUrlList").i(0).clone().or(&json!("")).clone(),
                ))
            }
        }
    }
    fn audio_url(&mut self) -> Option<String> {
        match self.kind {
            TemplateKind::Jianying => self.data.at("music_info.play_url").s(),
            TemplateKind::Kwaiying => first_str([self.data.at("music.url"), self.data.at("music.playUrl")]),
        }
    }
    fn image_list(&mut self) -> Vec<Value> {
        match self.kind {
            TemplateKind::Jianying => self.data.g("images").arr().to_vec(),
            TemplateKind::Kwaiying => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn signs_kwaiying_like_upstream() {
        assert_eq!(super::kwaiying_sign(1700000000000, 123456789012), "19655b4033397b24f60ca6a0ed4742be");
    }
}
