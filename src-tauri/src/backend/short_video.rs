use super::*;
use super::{douyin, wx_channels, xiaohongshu};

#[derive(Deserialize)]
pub(super) struct ShortVideoBody {
    url: String,
    filename: Option<String>,
    #[serde(rename = "imageIndex")]
    image_index: Option<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShortVideoPlatform {
    Douyin,
    WxChannels,
    Xiaohongshu,
}

impl ShortVideoPlatform {
    fn as_str(self) -> &'static str {
        match self {
            Self::Douyin => "douyin",
            Self::WxChannels => "wxChannels",
            Self::Xiaohongshu => "xiaohongshu",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "douyin" => Some(Self::Douyin),
            "wxChannels" | "wx-channels" | "wx_channels" => Some(Self::WxChannels),
            "xiaohongshu" | "xhs" => Some(Self::Xiaohongshu),
            _ => None,
        }
    }
}

pub(super) async fn api_tools_short_video_parse(
    State(state): State<BackendState>,
    Json(body): Json<ShortVideoBody>,
) -> Result<Json<Value>, ApiError> {
    let platform = detect_short_video_platform(&body.url)?;
    let profile = match platform {
        ShortVideoPlatform::Douyin => {
            let Json(payload) = douyin::api_tools_douyin_parse(
                State(state),
                Json(douyin::DouyinParseBody { url: body.url }),
            )
            .await?;
            normalize_douyin_profile(payload.get("data").cloned().unwrap_or_else(|| json!({})))
        }
        ShortVideoPlatform::WxChannels => {
            let source_url = body.url.clone();
            let Json(payload) = wx_channels::api_tools_wx_channels_parse(
                State(state),
                Json(wx_channels::WxChannelsParseBody { url: body.url }),
            )
            .await?;
            normalize_wx_channels_profile(
                payload.get("data").cloned().unwrap_or_else(|| json!({})),
                &source_url,
            )
        }
        ShortVideoPlatform::Xiaohongshu => {
            let Json(payload) = xiaohongshu::api_tools_xiaohongshu_parse(
                State(state),
                Json(xiaohongshu::XiaohongshuParseBody { url: body.url }),
            )
            .await?;
            normalize_xiaohongshu_profile(payload.get("data").cloned().unwrap_or_else(|| json!({})))
        }
    };

    Ok(Json(json!({
      "success": true,
      "data": profile
    })))
}

pub(super) async fn api_tools_short_video_download(
    State(state): State<BackendState>,
    Json(body): Json<ShortVideoBody>,
) -> Result<Json<Value>, ApiError> {
    let platform = detect_short_video_platform(&body.url)?;
    let data = match platform {
        ShortVideoPlatform::Douyin => {
            let Json(payload) = douyin::api_tools_douyin_download(
                State(state),
                Json(douyin::DouyinDownloadBody {
                    url: body.url,
                    filename: body.filename,
                    image_index: body.image_index,
                }),
            )
            .await?;
            normalize_douyin_download(payload.get("data").cloned().unwrap_or_else(|| json!({})))
        }
        ShortVideoPlatform::WxChannels => {
            let source_url = body.url.clone();
            let Json(payload) = wx_channels::api_tools_wx_channels_download(
                State(state),
                Json(wx_channels::WxChannelsDownloadBody {
                    url: body.url,
                    filename: body.filename,
                }),
            )
            .await?;
            normalize_wx_channels_download(
                payload.get("data").cloned().unwrap_or_else(|| json!({})),
                &source_url,
            )
        }
        ShortVideoPlatform::Xiaohongshu => {
            let Json(payload) = xiaohongshu::api_tools_xiaohongshu_download(
                State(state),
                Json(xiaohongshu::XiaohongshuDownloadBody {
                    url: body.url,
                    filename: body.filename,
                    image_index: body.image_index,
                }),
            )
            .await?;
            normalize_xiaohongshu_download(
                payload.get("data").cloned().unwrap_or_else(|| json!({})),
            )
        }
    };

    Ok(Json(json!({
      "success": true,
      "data": data
    })))
}

pub(super) async fn api_tools_short_video_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let Json(douyin_payload) = douyin::api_tools_douyin_history_get(State(state.clone())).await?;
    let Json(wx_payload) =
        wx_channels::api_tools_wx_channels_history_get(State(state.clone())).await?;
    let Json(xiaohongshu_payload) =
        xiaohongshu::api_tools_xiaohongshu_history_get(State(state)).await?;
    let mut items = Vec::new();

    if let Some(douyin_items) = douyin_payload
        .get("data")
        .and_then(|value| value.get("items"))
        .and_then(Value::as_array)
    {
        items.extend(
            douyin_items
                .iter()
                .cloned()
                .map(normalize_douyin_history_item),
        );
    }

    if let Some(wx_items) = wx_payload
        .get("data")
        .and_then(|value| value.get("items"))
        .and_then(Value::as_array)
    {
        items.extend(
            wx_items
                .iter()
                .cloned()
                .map(normalize_wx_channels_history_item),
        );
    }

    if let Some(xiaohongshu_items) = xiaohongshu_payload
        .get("data")
        .and_then(|value| value.get("items"))
        .and_then(Value::as_array)
    {
        items.extend(
            xiaohongshu_items
                .iter()
                .cloned()
                .map(normalize_xiaohongshu_history_item),
        );
    }

    items.sort_by(|left, right| {
        let left_updated = value_string(left, "updatedAt");
        let right_updated = value_string(right, "updatedAt");
        right_updated.cmp(&left_updated)
    });

    Ok(Json(json!({
      "success": true,
      "data": { "items": items }
    })))
}

pub(super) async fn api_tools_short_video_history_delete(
    State(state): State<BackendState>,
    Path((platform, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    match ShortVideoPlatform::from_str(platform.trim()) {
        Some(ShortVideoPlatform::Douyin) => {
            douyin::api_tools_douyin_history_delete(State(state), Path(id)).await
        }
        Some(ShortVideoPlatform::WxChannels) => {
            wx_channels::api_tools_wx_channels_history_delete(State(state), Path(id)).await
        }
        Some(ShortVideoPlatform::Xiaohongshu) => {
            xiaohongshu::api_tools_xiaohongshu_history_delete(State(state), Path(id)).await
        }
        None => Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的平台")),
    }
}

pub(super) async fn api_tools_short_video_preview(
    Query(mut query): Query<HashMap<String, String>>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    let platform = query
        .remove("platform")
        .and_then(|value| ShortVideoPlatform::from_str(value.trim()))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "platform 不能为空"))?;
    match platform {
        ShortVideoPlatform::Douyin => douyin::api_tools_douyin_preview(Query(query), headers).await,
        ShortVideoPlatform::Xiaohongshu => {
            xiaohongshu::api_tools_xiaohongshu_preview(Query(query)).await
        }
        ShortVideoPlatform::WxChannels => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "视频号预览不需要本地代理",
        )),
    }
}

fn detect_short_video_platform(input: &str) -> Result<ShortVideoPlatform, ApiError> {
    let text = input.trim().to_ascii_lowercase();
    if text.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "请填写分享链接"));
    }
    if text.contains("weixin.qq.com/sph/") || text.contains("channels.weixin.qq.com") {
        return Ok(ShortVideoPlatform::WxChannels);
    }
    if text.contains("xiaohongshu.com") || text.contains("xhslink.com") {
        return Ok(ShortVideoPlatform::Xiaohongshu);
    }
    if text.contains("v.douyin.com")
        || text.contains("www.douyin.com")
        || text.contains("douyin.com")
        || text.contains("iesdouyin.com")
    {
        return Ok(ShortVideoPlatform::Douyin);
    }
    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        "暂只支持抖音、视频号、小红书分享链接",
    ))
}

fn normalize_douyin_download(data: Value) -> Value {
    json!({
      "profile": normalize_douyin_profile(data.get("profile").cloned().unwrap_or_else(|| json!({}))),
      "path": value_string(&data, "path"),
      "filename": value_string(&data, "filename"),
      "downloadDir": value_string(&data, "downloadDir"),
      "sizeBytes": value_i64(&data, "sizeBytes"),
      "imageIndex": data.get("imageIndex").cloned().unwrap_or(Value::Null)
    })
}

fn normalize_wx_channels_download(data: Value, source_url: &str) -> Value {
    json!({
      "profile": normalize_wx_channels_profile(data.get("profile").cloned().unwrap_or_else(|| json!({})), source_url),
      "path": value_string(&data, "path"),
      "filename": value_string(&data, "filename"),
      "downloadDir": value_string(&data, "downloadDir"),
      "sizeBytes": value_i64(&data, "sizeBytes")
    })
}

fn normalize_xiaohongshu_download(data: Value) -> Value {
    json!({
      "profile": normalize_xiaohongshu_profile(data.get("profile").cloned().unwrap_or_else(|| json!({}))),
      "path": value_string(&data, "path"),
      "filename": value_string(&data, "filename"),
      "downloadDir": value_string(&data, "downloadDir"),
      "sizeBytes": value_i64(&data, "sizeBytes"),
      "imageIndex": data.get("imageIndex").cloned().unwrap_or(Value::Null)
    })
}

fn normalize_douyin_history_item(item: Value) -> Value {
    let profile =
        normalize_douyin_profile(item.get("profile").cloned().unwrap_or_else(|| json!({})));
    json!({
      "id": value_string(&item, "id"),
      "platform": ShortVideoPlatform::Douyin.as_str(),
      "profile": profile,
      "sourceUrl": profile.get("sourceUrl").and_then(Value::as_str).unwrap_or(""),
      "path": value_string(&item, "path"),
      "filename": value_string(&item, "filename"),
      "downloadDir": value_string(&item, "downloadDir"),
      "sizeBytes": value_i64(&item, "sizeBytes"),
      "parsedAt": value_string(&item, "parsedAt"),
      "downloadedAt": item.get("downloadedAt").cloned().unwrap_or(Value::Null),
      "updatedAt": value_string(&item, "updatedAt")
    })
}

fn normalize_wx_channels_history_item(item: Value) -> Value {
    let source_url = value_string(&item, "shareUrl");
    let profile = normalize_wx_channels_profile(
        item.get("profile").cloned().unwrap_or_else(|| json!({})),
        &source_url,
    );
    json!({
      "id": value_string(&item, "id"),
      "platform": ShortVideoPlatform::WxChannels.as_str(),
      "profile": profile,
      "sourceUrl": source_url,
      "path": value_string(&item, "path"),
      "filename": value_string(&item, "filename"),
      "downloadDir": value_string(&item, "downloadDir"),
      "sizeBytes": value_i64(&item, "sizeBytes"),
      "parsedAt": value_string(&item, "parsedAt"),
      "downloadedAt": item.get("downloadedAt").cloned().unwrap_or(Value::Null),
      "updatedAt": value_string(&item, "updatedAt")
    })
}

fn normalize_xiaohongshu_history_item(item: Value) -> Value {
    let profile =
        normalize_xiaohongshu_profile(item.get("profile").cloned().unwrap_or_else(|| json!({})));
    json!({
      "id": value_string(&item, "id"),
      "platform": ShortVideoPlatform::Xiaohongshu.as_str(),
      "profile": profile,
      "sourceUrl": profile.get("sourceUrl").and_then(Value::as_str).unwrap_or(""),
      "path": value_string(&item, "path"),
      "filename": value_string(&item, "filename"),
      "downloadDir": value_string(&item, "downloadDir"),
      "sizeBytes": value_i64(&item, "sizeBytes"),
      "parsedAt": value_string(&item, "parsedAt"),
      "downloadedAt": item.get("downloadedAt").cloned().unwrap_or(Value::Null),
      "updatedAt": value_string(&item, "updatedAt")
    })
}

fn normalize_douyin_profile(profile: Value) -> Value {
    json!({
      "historyId": profile.get("historyId").cloned().unwrap_or(Value::Null),
      "platform": ShortVideoPlatform::Douyin.as_str(),
      "title": value_string(&profile, "title"),
      "coverUrl": value_string(&profile, "coverUrl"),
      "videoUrl": value_string(&profile, "videoUrl"),
      "mediaType": value_string(&profile, "mediaType"),
      "imageUrls": profile.get("imageUrls").cloned().unwrap_or_else(|| json!([])),
      "sourceUrl": value_string(&profile, "realUrl"),
      "awemeId": value_string(&profile, "awemeId")
    })
}

fn normalize_wx_channels_profile(profile: Value, source_url: &str) -> Value {
    let origin_video_url = value_string(&profile, "originVideoUrl");
    let video_url = if origin_video_url.is_empty() {
        value_string(&profile, "videoUrl")
    } else {
        origin_video_url
    };
    json!({
      "historyId": profile.get("historyId").cloned().unwrap_or(Value::Null),
      "platform": ShortVideoPlatform::WxChannels.as_str(),
      "title": value_string(&profile, "description"),
      "coverUrl": value_string(&profile, "coverUrl"),
      "videoUrl": video_url,
      "sourceUrl": source_url,
      "author": value_string(&profile, "author"),
      "authorIcon": value_string(&profile, "authorIcon"),
      "createTime": profile.get("createTime").cloned().unwrap_or(Value::Null)
    })
}

fn normalize_xiaohongshu_profile(profile: Value) -> Value {
    json!({
      "historyId": profile.get("historyId").cloned().unwrap_or(Value::Null),
      "platform": ShortVideoPlatform::Xiaohongshu.as_str(),
      "title": value_string(&profile, "title"),
      "description": value_string(&profile, "description"),
      "coverUrl": value_string(&profile, "coverUrl"),
      "videoUrl": "",
      "mediaType": "image",
      "imageUrls": profile.get("imageUrls").cloned().unwrap_or_else(|| json!([])),
      "sourceUrl": value_string(&profile, "realUrl"),
      "author": value_string(&profile, "author"),
      "authorIcon": value_string(&profile, "authorIcon"),
      "createTime": profile.get("createTime").cloned().unwrap_or(Value::Null),
      "noteId": value_string(&profile, "noteId")
    })
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn value_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}
