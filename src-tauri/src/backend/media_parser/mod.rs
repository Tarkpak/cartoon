use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod catalog;
mod core;
mod engine;
mod platforms;
mod signer;
mod urls;

/// Rust port of https://github.com/ucmao/media-parser's v1 contract (MIT, see assets/).
pub(super) struct ParsedMedia {
    pub data: Value,
    pub id: String,
    pub source_url: String,
    pub title: String,
    pub description: String,
    pub video_url: String,
    pub image_urls: Vec<String>,
    pub cover_url: String,
    pub author: String,
    pub author_icon: String,
}

pub(super) use catalog::{catalog, detect};

/// Engine result injected by tests instead of reaching real platforms.
#[cfg(test)]
pub(super) static TEST_RESPONSE: std::sync::Mutex<Option<Value>> = std::sync::Mutex::new(None);

/// Marks the running parse as cancelled when the request future is dropped.
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

pub(super) async fn parse(_state: &BackendState, input: &str) -> Result<ParsedMedia, ApiError> {
    let source_url = input.trim().to_string();
    if source_url.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请填写分享链接或分享文案",
        ));
    }
    #[cfg(test)]
    if let Some(payload) = TEST_RESPONSE.lock().unwrap().clone() {
        return decode_response(true, &payload, source_url);
    }
    static LIMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let _permit = LIMIT
        .acquire()
        .await
        .map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "解析引擎正在关闭"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(cancelled.clone());
    let text = source_url.clone();
    // Parsers use blocking HTTP and QuickJS; keep them off the async workers.
    let task = tokio::task::spawn_blocking(move || {
        let ctx = core::Ctx::new(Duration::from_secs(90), cancelled);
        engine::execute(&text, ctx)
    });
    let payload = tokio::time::timeout(Duration::from_secs(100), task)
        .await
        .map_err(|_| ApiError::new(StatusCode::GATEWAY_TIMEOUT, "媒体解析超时，请稍后重试"))?
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "内置媒体解析引擎执行异常"))?;
    decode_response(true, &payload, source_url)
}

fn decode_response(
    http_success: bool,
    payload: &Value,
    source_url: String,
) -> Result<ParsedMedia, ApiError> {
    if !http_success
        || payload.get("succ").and_then(Value::as_bool) != Some(true)
        || payload.get("retcode").and_then(Value::as_i64) != Some(200)
    {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "media-parser 解析失败：{}",
                payload
                    .get("retdesc")
                    .and_then(Value::as_str)
                    .unwrap_or("服务返回错误")
            ),
        ));
    }
    let data = payload
        .get("data")
        .filter(|value| value.is_object())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "media-parser 未返回作品详情"))?;
    let string = |key: &str| {
        data.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let image_urls: Vec<String> = data
        .get("image_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.as_str()
                .or_else(|| item.get("url").and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect();
    let mut video_url = string("video_url");
    if video_url.is_empty() {
        video_url = data
            .get("video_list")
            .and_then(Value::as_array)
            .and_then(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .find(|url| !url.trim().is_empty())
            })
            .unwrap_or("")
            .to_string();
    }
    if video_url.is_empty() && image_urls.is_empty() && string("audio_url").is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "内置解析引擎未返回可下载的媒体地址",
        ));
    }
    let mut cover_url = string("cover_url");
    if cover_url.is_empty() {
        cover_url = image_urls.first().cloned().unwrap_or_default();
    }
    let description = string("desc");
    let title = string("title");
    Ok(ParsedMedia {
        data: data.clone(),
        id: string("video_id"),
        source_url: if string("source_url").is_empty() {
            source_url
        } else {
            string("source_url")
        },
        title: if title.is_empty() {
            description.clone()
        } else {
            title
        },
        description,
        video_url,
        image_urls,
        cover_url,
        author: data
            .pointer("/author/nickname")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        author_icon: data
            .pointer("/author/avatar")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_video_and_mixed_image_contract() {
        let payload = json!({"succ": true, "retcode": 200, "data": {
            "video_id": "123", "desc": "文案", "video_list": ["https://cdn/video.mp4"],
            "image_list": ["https://cdn/1.jpg", {"url": "https://cdn/2.jpg", "live_photo_url": "https://cdn/live.mp4"}, {}],
            "author": {"nickname": "作者", "avatar": "https://cdn/avatar.jpg"}
        }});
        let media = decode_response(true, &payload, "https://v.douyin.com/test/".into()).unwrap();
        assert_eq!(media.id, "123");
        assert_eq!(media.title, "文案");
        assert_eq!(media.video_url, "https://cdn/video.mp4");
        assert_eq!(media.image_urls.len(), 2);
        assert_eq!(media.cover_url, "https://cdn/1.jpg");
        assert_eq!(media.author, "作者");
    }

    #[test]
    fn rejects_service_errors_and_empty_media() {
        for payload in [
            json!({"succ": false, "retcode": 403, "retdesc": "密钥无效"}),
            json!({"succ": true, "retcode": 200, "data": {}}),
            json!({"succ": true, "retcode": 200, "data": null}),
        ] {
            assert!(decode_response(true, &payload, String::new()).is_err());
        }
        assert!(
            decode_response(false, &json!({"succ": true, "retcode": 200}), String::new()).is_err()
        );
    }
}
