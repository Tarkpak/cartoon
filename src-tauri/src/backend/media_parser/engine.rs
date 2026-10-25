//! Port of upstream `src/api/parse.py` (`API_ONLY` mode: no keys, credits or proxy pool).

use super::core::*;
use super::{platforms, urls};
use std::sync::Arc;

const MAX_TEXT_LENGTH: usize = 2000;
const AI_TEXT_PLATFORMS: &[&str] = &["豆包", "通义千问", "腾讯元宝", "夸克AI", "小云雀AI"];

pub fn response(retcode: u16, retdesc: &str, data: Value, succ: bool, error_code: Option<&str>) -> Value {
    let mut payload = json!({"retcode": retcode, "retdesc": retdesc, "succ": succ, "data": data});
    if let Some(code) = error_code {
        payload["error_code"] = json!(code);
    }
    payload
}

fn fail(status: u16, code: &str, message: &str) -> Value {
    response(status, message, Value::Null, false, Some(code))
}

struct Content {
    title: Option<String>,
    desc: Option<String>,
    video_url: Option<String>,
    video_list: Vec<String>,
    cover_url: Option<String>,
    author: Option<Value>,
    image_list: Vec<Value>,
    audio_url: Option<String>,
    subtitles: Option<Value>,
    is_preview: bool,
    full_duration: Option<Value>,
}

impl Content {
    fn has_media(&self) -> bool {
        self.video_url.as_deref().is_some_and(|v| !v.is_empty())
            || !self.video_list.is_empty()
            || !self.image_list.is_empty()
            || self.audio_url.as_deref().is_some_and(|v| !v.is_empty())
    }
}

fn fetch_with_retry(parser: &mut dyn Parser, platform: &str) -> Content {
    let attempts = if platform == "小红书" { 3 } else { 1 };
    let mut content = None;
    for _ in 0..attempts {
        let result = Content {
            title: opt(parser.title()),
            desc: opt(parser.description()),
            video_url: opt(parser.video_url()),
            video_list: parser.video_list(),
            cover_url: opt(parser.cover_url()),
            author: parser.author().filter(|a| !a.is_null()),
            image_list: parser.image_list(),
            audio_url: opt(parser.audio_url()),
            subtitles: parser.subtitles().filter(Value::truthy),
            is_preview: parser.is_preview(),
            full_duration: parser.full_duration().filter(Value::truthy),
        };
        let done = result.has_media();
        content = Some(result);
        if done {
            break;
        }
    }
    content.expect("at least one attempt")
}

fn cookie_code(platform: &str) -> &'static str {
    match platform {
        "小红书" => "XIAOHONGSHU_COOKIE_REQUIRED",
        "拼多多" => "PINDUODUO_COOKIE_REQUIRED",
        "视频号" | "微信视频号" => "WECHAT_CHANNELS_COOKIE_REQUIRED",
        "快手" => "KUAISHOU_COOKIE_REQUIRED",
        _ => "COOKIE_REQUIRED",
    }
}

fn is_cookie_detail(detail: &Value) -> bool {
    let code = detail.g("error_code").str_or_empty().to_uppercase();
    let message = detail
        .g("detail_msg")
        .or(detail.g("notice"))
        .str_or_empty()
        .to_lowercase();
    code.contains("COOKIE") || message.contains("cookie")
}

fn terminal_detail(parser: &dyn Parser) -> Option<Value> {
    parser
        .flags()
        .and_then(|flags| flags.terminal_error.clone())
        .filter(|detail| detail.is_object() && detail.truthy())
}

/// `_result_kind`, used to tag empty results that hit a login wall.
fn is_empty_kind(parser: &dyn Parser, content: &Content, platform: &str) -> bool {
    if content.has_media() || terminal_detail(parser).is_some() {
        return false;
    }
    let flags = parser.flags();
    if flags.is_some_and(|f| f.no_media_in_content || f.cookie_required) {
        return false;
    }
    if AI_TEXT_PLATFORMS.contains(&platform) && (content.title.is_some() || content.desc.is_some()) {
        return false;
    }
    !matches!(platform, "小红书" | "拼多多" | "视频号" | "微信视频号")
}

pub fn execute(text: &str, ctx: Arc<Ctx>) -> Value {
    if text.trim().is_empty() {
        return fail(400, "INVALID_TEXT", "请提供包含分享链接的文本");
    }
    if text.chars().count() > MAX_TEXT_LENGTH {
        return fail(
            400,
            "TEXT_TOO_LONG",
            &format!("分享文本不能超过 {MAX_TEXT_LENGTH} 个字符"),
        );
    }
    let Some(share_url) = urls::get_url(text) else {
        return fail(400, "URL_NOT_FOUND", "未找到有效的分享链接");
    };
    let timeout = || fail(504, "PARSE_TIMEOUT", "解析超时，请稍后重试");

    let session = Session::new(&ctx);
    let redirect_url = urls::fetch_redirect_url(&session, &share_url);
    if ctx.check().is_err() {
        return timeout();
    }
    let Some(redirect_url) = redirect_url else {
        if !urls::is_allowed_target(&share_url) {
            return fail(400, "PLATFORM_NOT_SUPPORTED", "该链接尚未支持提取");
        }
        return fail(400, "REDIRECT_FAILED", "无法访问或识别该分享链接");
    };
    let Some(platform) = urls::get_platform(&redirect_url) else {
        return fail(400, "PLATFORM_NOT_SUPPORTED", "该链接尚未支持提取");
    };
    let real_url = urls::extract_video_address(&redirect_url).unwrap_or_default();
    let Some(mut parser) = platforms::create(platform, &real_url, &ctx) else {
        return fail(500, "INTERNAL_ERROR", "功能太火爆啦，请稍后再试");
    };
    if ctx.check().is_err() {
        return timeout();
    }
    let content = fetch_with_retry(parser.as_mut(), platform);
    if ctx.check().is_err() {
        return timeout();
    }
    if is_empty_kind(parser.as_ref(), &content, platform) && ctx.cookie_required() {
        if let Some(flags) = parser.flags_mut() {
            flags.terminal_error = Some(json!({
                "error_code": cookie_code(platform),
                "detail_msg": "平台要求 Cookie 或登录校验"
            }));
        }
    }

    if !content.has_media() {
        if let Some(detail) = terminal_detail(parser.as_ref()) {
            let message = detail
                .g("detail_msg")
                .or(detail.g("notice"))
                .s()
                .unwrap_or_else(|| "该内容可能为私密/日常作品或已被作者删除".into());
            let code = detail.g("error_code").s().unwrap_or_else(|| {
                if is_cookie_detail(&detail) {
                    cookie_code(platform).to_string()
                } else {
                    "MEDIA_DELETED_OR_PRIVATE".to_string()
                }
            });
            if !message.trim().is_empty() {
                return fail(400, &code, message.trim());
            }
        }
        let flags = parser.flags();
        if flags.is_some_and(|f| f.no_media_in_content)
            || (AI_TEXT_PLATFORMS.contains(&platform)
                && (content.title.is_some() || content.desc.is_some()))
        {
            return fail(400, "NO_MEDIA_IN_CONTENT", "该分享内容仅包含文本对话，未包含图片或视频资源");
        }
        return match platform {
            "小红书" => fail(400, "XIAOHONGSHU_COOKIE_REQUIRED", "解析失败：该链接需要小红书登录 Cookie 校验，请在配置中提供有效 Cookie 后重试"),
            "拼多多" => fail(400, "PINDUODUO_COOKIE_REQUIRED", "解析失败：该链接需要拼多多登录 Cookie 校验，请在配置中提供有效 Cookie 后重试"),
            "视频号" | "微信视频号" => fail(400, "WECHAT_CHANNELS_COOKIE_REQUIRED", "解析失败：该链接需要配置腾讯元宝 YUANBAO_COOKIE 凭证后重试"),
            "快手" if flags.is_some_and(|f| f.cookie_required) => fail(400, "KUAISHOU_COOKIE_REQUIRED", "解析失败：该链接触发快手安全校验，请在配置中提供有效快手 Cookie 后重试"),
            _ => fail(400, "MEDIA_NOT_FOUND", "提取媒体内容失败，请检查链接或稍后重试"),
        };
    }

    let mut data = build_data(&redirect_url, platform, content);
    data["source_url"] = json!(share_url);
    response(200, "成功", data, true, None)
}

fn build_data(redirect_url: &str, platform: &str, content: Content) -> Value {
    let images: Vec<Value> = content
        .image_list
        .iter()
        .map(|image| match image {
            Value::Object(_) => json!({
                "url": opt_value(https(image.g("url").s())),
                "live_photo_url": opt_value(https(image.g("live_photo_url").s())),
            }),
            other => opt_value(https(other.s())),
        })
        .collect();
    let mut videos = dedupe(
        content
            .video_list
            .into_iter()
            .filter(|url| !url.is_empty())
            .map(|url| https_str(&url))
            .collect(),
    );
    let mut primary = https(content.video_url);
    if primary.is_none() {
        primary = videos.first().cloned();
    }
    if let Some(primary) = &primary {
        if let Some(index) = videos.iter().position(|url| url == primary) {
            let url = videos.remove(index);
            videos.insert(0, url);
        }
    }
    let title = content.title.clone().or_else(|| content.desc.clone());
    let cover = https(content.cover_url).or_else(|| {
        images.first().and_then(|image| match image {
            Value::Object(_) => image.g("url").s(),
            other => other.s(),
        })
    });
    let mut data = json!({
        "video_id": opt_value(urls::get_video_id(redirect_url)),
        "platform": platform,
        "title": opt_value(title),
        "desc": opt_value(content.desc),
        "video_url": opt_value(primary),
        "audio_url": opt_value(https(content.audio_url)),
        "cover_url": opt_value(cover),
        "author": content.author.unwrap_or(Value::Null),
        "image_list": images,
    });
    if videos.len() > 1 {
        data["video_list"] = json!(videos);
    }
    if let Some(subtitles) = content.subtitles {
        data["subtitles"] = subtitles;
    }
    if content.is_preview {
        data["is_preview"] = json!(true);
        if let Some(duration) = content.full_duration {
            data["full_duration"] = duration;
        }
    }
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture;

    impl Parser for Fixture {
        fn title(&mut self) -> Option<String> {
            None
        }
        fn description(&mut self) -> Option<String> {
            Some("正文".into())
        }
        fn video_url(&mut self) -> Option<String> {
            Some("http://cdn/video.mp4".into())
        }
        fn video_list(&mut self) -> Vec<String> {
            vec!["https://cdn/second.mp4".into(), "https://cdn/video.mp4".into()]
        }
        fn cover_url(&mut self) -> Option<String> {
            None
        }
        fn image_list(&mut self) -> Vec<Value> {
            vec![json!({"url": "http://cdn/image.jpg", "live_photo_url": "https://cdn/live.mp4"})]
        }
        fn subtitles(&mut self) -> Option<Value> {
            Some(json!([{"start": 0, "end": 1, "text": "字幕"}]))
        }
    }

    #[test]
    fn builds_v1_payload_like_upstream() {
        let mut parser = Fixture;
        let content = fetch_with_retry(&mut parser, "小红书");
        let data = build_data("https://www.xiaohongshu.com/explore/123", "小红书", content);
        assert_eq!(data["video_id"], "123");
        assert_eq!(data["title"], "正文");
        assert_eq!(data["video_url"], "https://cdn/video.mp4");
        assert_eq!(data["video_list"], json!(["https://cdn/video.mp4", "https://cdn/second.mp4"]));
        assert_eq!(data["cover_url"], "https://cdn/image.jpg");
        assert_eq!(data["image_list"][0]["live_photo_url"], "https://cdn/live.mp4");
        assert_eq!(data["subtitles"][0]["text"], "字幕");
    }

    #[test]
    fn rejects_invalid_input() {
        let ctx = Ctx::new(std::time::Duration::from_secs(5), Default::default());
        assert_eq!(execute("", ctx.clone())["error_code"], "INVALID_TEXT");
        assert_eq!(execute("没有链接", ctx.clone())["error_code"], "URL_NOT_FOUND");
        assert_eq!(
            execute("https://example.com/video", ctx.clone())["error_code"],
            "PLATFORM_NOT_SUPPORTED"
        );
        assert_eq!(execute(&"a".repeat(2001), ctx)["error_code"], "TEXT_TOO_LONG");
    }

    /// Live check against real platforms:
    /// `MEDIA_PARSER_LIVE_URLS="url1 url2" cargo test --lib live_parse -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_parse() {
        let urls = std::env::var("MEDIA_PARSER_LIVE_URLS").unwrap_or_default();
        for url in urls.split_whitespace() {
            let started = std::time::Instant::now();
            let ctx = Ctx::new(std::time::Duration::from_secs(90), Default::default());
            let result = execute(url, ctx);
            let data = &result["data"];
            println!(
                "{url}\n  {:?} {} {}s\n  platform={} title={:?}\n  video={:?}\n  images={} audio={:?} cover={:?}",
                result["retcode"],
                result["retdesc"],
                started.elapsed().as_secs(),
                data["platform"],
                data["title"].as_str().map(|t| t.chars().take(40).collect::<String>()),
                data["video_url"].as_str().map(|t| t.chars().take(90).collect::<String>()),
                data["image_list"].as_array().map_or(0, Vec::len),
                data["audio_url"].as_str().map(|t| t.chars().take(60).collect::<String>()),
                data["cover_url"].as_str().map(|t| t.chars().take(60).collect::<String>()),
            );
        }
    }
}
