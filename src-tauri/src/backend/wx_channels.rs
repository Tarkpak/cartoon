use super::*;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderValue as ReqwestHeaderValue};
use std::fs::File;

const WX_CHANNELS_DOWNLOAD_DIR: &str = "tools/wx-channels-download";
const YUANBAO_PARSE_URL: &str = "https://yuanbao.tencent.com/api/weixin/get_parse_result";
const CHANNELS_FEED_INFO_URL: &str =
    "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

#[derive(Deserialize)]
pub(super) struct WxChannelsParseBody {
    pub(super) url: String,
}

#[derive(Deserialize)]
pub(super) struct WxChannelsDownloadBody {
    pub(super) url: String,
    pub(super) filename: Option<String>,
}

#[derive(Clone, Debug)]
struct WxChannelsProfile {
    author: String,
    author_icon: String,
    cover_url: String,
    description: String,
    video_url: String,
    origin_video_url: String,
    create_time: Option<i64>,
}

pub(super) async fn api_tools_wx_channels_parse(
    State(state): State<BackendState>,
    Json(body): Json<WxChannelsParseBody>,
) -> Result<Json<Value>, ApiError> {
    let share_url = normalize_sph_share_url(&body.url)?;
    let cookie = resolve_yuanbao_cookie()?;
    let profile = fetch_wx_channels_profile(&share_url, &cookie).await?;
    let conn = db_connection(&state)?;
    let history_id = upsert_wx_channels_history(&conn, &share_url, &profile, None)?;
    Ok(Json(json!({
      "success": true,
      "data": wx_channels_profile_json(&profile, Some(&history_id))
    })))
}

pub(super) async fn api_tools_wx_channels_download(
    State(state): State<BackendState>,
    Json(body): Json<WxChannelsDownloadBody>,
) -> Result<Json<Value>, ApiError> {
    let share_url = normalize_sph_share_url(&body.url)?;
    let cookie = resolve_yuanbao_cookie()?;
    let profile = fetch_wx_channels_profile(&share_url, &cookie).await?;
    if profile.origin_video_url.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "未获取到可下载视频地址",
        ));
    }

    let dir = wx_channels_download_dir(&state);
    fs::create_dir_all(&dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let filename = body
        .filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if profile.description.trim().is_empty() {
                "wx_channels_video"
            } else {
                profile.description.trim()
            }
        });
    let target_path = unique_download_path(&dir, filename);
    download_video(&profile.origin_video_url, &target_path).await?;
    let file_size = fs::metadata(&target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let download = WxChannelsHistoryDownload {
        path: target_path.to_string_lossy().to_string(),
        filename: target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("video.mp4")
            .to_string(),
        download_dir: dir.to_string_lossy().to_string(),
        size_bytes: file_size,
    };
    let conn = db_connection(&state)?;
    let history_id = upsert_wx_channels_history(&conn, &share_url, &profile, Some(&download))?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "profile": wx_channels_profile_json(&profile, Some(&history_id)),
        "path": download.path,
        "filename": download.filename,
        "downloadDir": download.download_dir,
        "sizeBytes": file_size
      }
    })))
}

pub(super) async fn api_tools_wx_channels_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, share_url, author, author_icon, cover_url, description,
                    video_url, origin_video_url, create_time, downloaded_path,
                    downloaded_filename, download_dir, size_bytes, parsed_at,
                    downloaded_at, updated_at
             FROM wx_channels_history
             ORDER BY updated_at DESC
             LIMIT 30",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let items = stmt
        .query_map([], wx_channels_history_row_json)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "data": { "items": items }
    })))
}

pub(super) async fn api_tools_wx_channels_history_delete(
    State(state): State<BackendState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let target = id.trim();
    if target.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "历史记录 ID 不能为空",
        ));
    }
    let conn = db_connection(&state)?;
    conn.execute(
        "DELETE FROM wx_channels_history WHERE id = ?1",
        params![target],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

fn wx_channels_download_dir(state: &BackendState) -> PathBuf {
    state.data_dir.join(WX_CHANNELS_DOWNLOAD_DIR)
}

fn resolve_yuanbao_cookie() -> Result<String, ApiError> {
    let config = get_cloud_runtime_wx_channels_config().unwrap_or_else(|| json!({}));
    let cookie = config
        .get("yuanbaoCookie")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if cookie.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请先在后台管理配置视频号 Cookie，并在客户端重新同步后台配置",
        ));
    }
    Ok(cookie)
}

fn normalize_sph_share_url(input: &str) -> Result<String, ApiError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请填写视频号分享链接",
        ));
    }
    if !(value.starts_with("https://weixin.qq.com/sph/")
        || value.starts_with("http://weixin.qq.com/sph/")
        || value.starts_with("https://channels.weixin.qq.com/")
        || value.starts_with("http://channels.weixin.qq.com/"))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持视频号 SPH 分享链接",
        ));
    }
    Ok(value.to_string())
}

async fn fetch_wx_channels_profile(
    share_url: &str,
    cookie: &str,
) -> Result<WxChannelsProfile, ApiError> {
    let parse_data = parse_share_url(share_url, cookie).await?;
    let playable_url = parse_data
        .get("playable_url")
        .and_then(Value::as_str)
        .unwrap_or("");
    let general_token = url_query_value(playable_url, "token").unwrap_or_default();
    let export_id = url_query_value(playable_url, "eid")
        .or_else(|| {
            parse_data
                .get("wx_export_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if general_token.is_empty() || export_id.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "解析结果缺少 token 或 eid",
        ));
    }
    let feed = get_feed_info(&export_id, &general_token).await?;
    let feed_info = feed
        .get("data")
        .and_then(|value| value.get("feedInfo"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let author_info = feed
        .get("data")
        .and_then(|value| value.get("authorInfo"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let video_url = first_downloadable_video_url(&feed_info);
    let origin_video_url = clean_video_url(&video_url);
    if origin_video_url.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "解析成功但没有可下载视频地址",
        ));
    }
    Ok(WxChannelsProfile {
        author: author_info
            .get("nickname")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        author_icon: author_info
            .get("headImgUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        cover_url: feed_info
            .get("coverUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        description: feed_info
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        create_time: feed_info.get("createtime").and_then(Value::as_i64),
        video_url,
        origin_video_url,
    })
}

async fn parse_share_url(share_url: &str, cookie: &str) -> Result<Value, ApiError> {
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let response = client
        .post(YUANBAO_PARSE_URL)
        .headers(yuanbao_headers(cookie)?)
        .json(&json!({
          "type": "video_channel_url",
          "url": share_url,
          "scene": 1
        }))
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("请求腾讯元宝失败: {error}"),
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("腾讯元宝解析失败: HTTP {}", response.status()),
        ));
    }
    let body = response.json::<Value>().await.map_err(|error| {
        ApiError::new(StatusCode::BAD_GATEWAY, format!("解析响应失败: {error}"))
    })?;
    let data = body
        .get("data")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "腾讯元宝响应缺少 data"))?;
    if data
        .get("wx_export_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            body.get("msg")
                .and_then(Value::as_str)
                .unwrap_or("腾讯元宝未返回视频标识"),
        ));
    }
    Ok(data)
}

async fn get_feed_info(export_id: &str, general_token: &str) -> Result<Value, ApiError> {
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rid = format!(
        "{:x}-{}",
        Utc::now().timestamp(),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let api_url = format!(
        "{}?_rid={}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed",
        CHANNELS_FEED_INFO_URL, rid
    );
    let referer = format!(
        "https://channels.weixin.qq.com/finder-preview/pages/feed?entry_card_type=48&comment_scene=39&appid=0&token={}&entry_scene=0&eid={}",
        url_encode(general_token),
        url_encode(export_id)
    );
    let response = client
        .post(api_url)
        .headers(channels_headers(&referer)?)
        .json(&json!({
          "baseReq": { "generalToken": general_token },
          "exportId": export_id
        }))
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("请求视频号详情失败: {error}"),
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("视频号详情请求失败: HTTP {}", response.status()),
        ));
    }
    let body = response.json::<Value>().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("解析详情响应失败: {error}"),
        )
    })?;
    if body.get("errCode").and_then(Value::as_i64).unwrap_or(0) != 0 {
        let message = body
            .get("errMsg")
            .and_then(Value::as_str)
            .unwrap_or("视频号详情接口返回错误");
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
    }
    Ok(body)
}

async fn download_video(video_url: &str, target_path: &FsPath) -> Result<(), ApiError> {
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut response = client
        .get(video_url)
        .header("User-Agent", BROWSER_USER_AGENT)
        .send()
        .await
        .map_err(|error| {
            ApiError::new(StatusCode::BAD_GATEWAY, format!("下载视频失败: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("下载视频失败: HTTP {}", response.status()),
        ));
    }
    let mut file = File::create(target_path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取视频数据失败: {error}"),
        )
    })? {
        file.write_all(&chunk)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(())
}

fn yuanbao_headers(cookie: &str) -> Result<ReqwestHeaderMap, ApiError> {
    let mut headers = ReqwestHeaderMap::new();
    header(&mut headers, "accept", "application/json, text/plain, */*")?;
    header(&mut headers, "accept-language", "zh-CN,zh;q=0.9,en;q=0.8")?;
    header(&mut headers, "content-type", "application/json")?;
    header(&mut headers, "origin", "https://yuanbao.tencent.com")?;
    header(
        &mut headers,
        "referer",
        "https://yuanbao.tencent.com/chat/naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
    )?;
    header(&mut headers, "user-agent", BROWSER_USER_AGENT)?;
    header(
        &mut headers,
        "sec-ch-ua",
        "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
    )?;
    header(&mut headers, "sec-ch-ua-mobile", "?0")?;
    header(&mut headers, "sec-ch-ua-platform", "\"macOS\"")?;
    header(&mut headers, "sec-fetch-dest", "empty")?;
    header(&mut headers, "sec-fetch-mode", "cors")?;
    header(&mut headers, "sec-fetch-site", "same-origin")?;
    header(&mut headers, "t-userid", "b9575f6b0a8c4a55a08096904a5ef20a")?;
    header(
        &mut headers,
        "x-agentid",
        "naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
    )?;
    header(&mut headers, "x-commit-tag", "72282a0d")?;
    header(
        &mut headers,
        "x-device-id",
        "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
    )?;
    header(&mut headers, "x-hy106", "")?;
    header(
        &mut headers,
        "x-hy92",
        "e963067ffa31002b9646bd0c03000008b1951a",
    )?;
    header(
        &mut headers,
        "x-hy93",
        "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
    )?;
    header(&mut headers, "x-id", "b9575f6b0a8c4a55a08096904a5ef20a")?;
    header(&mut headers, "x-instance-id", "5")?;
    header(&mut headers, "x-language", "zh-CN")?;
    header(&mut headers, "x-os_version", "Mac OS(10.15.7)-Blink")?;
    header(&mut headers, "x-platform", "mac")?;
    header(&mut headers, "x-requested-with", "XMLHttpRequest")?;
    header(&mut headers, "x-source", "web")?;
    header(&mut headers, "x-web-third-source", "main")?;
    header(&mut headers, "x-webdriver", "0")?;
    header(&mut headers, "x-webversion", "2.69.0")?;
    header(&mut headers, "x-ybuitest", "0")?;
    header(&mut headers, "cookie", cookie)?;
    Ok(headers)
}

fn channels_headers(referer: &str) -> Result<ReqwestHeaderMap, ApiError> {
    let mut headers = ReqwestHeaderMap::new();
    header(&mut headers, "accept", "application/json, text/plain, */*")?;
    header(&mut headers, "accept-language", "zh-CN,zh;q=0.9,en;q=0.8")?;
    header(&mut headers, "connection", "keep-alive")?;
    header(&mut headers, "content-type", "application/json")?;
    header(&mut headers, "origin", "https://channels.weixin.qq.com")?;
    header(&mut headers, "referer", referer)?;
    header(&mut headers, "sec-fetch-dest", "empty")?;
    header(&mut headers, "sec-fetch-mode", "cors")?;
    header(&mut headers, "sec-fetch-site", "same-origin")?;
    header(&mut headers, "user-agent", BROWSER_USER_AGENT)?;
    header(
        &mut headers,
        "sec-ch-ua",
        "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
    )?;
    header(&mut headers, "sec-ch-ua-mobile", "?0")?;
    header(&mut headers, "sec-ch-ua-platform", "\"macOS\"")?;
    Ok(headers)
}

fn header(headers: &mut ReqwestHeaderMap, key: &'static str, value: &str) -> Result<(), ApiError> {
    let value = ReqwestHeaderValue::from_str(value)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    headers.insert(key, value);
    Ok(())
}

fn clean_video_url(video_url: &str) -> String {
    let normalized = video_url.replace("&amp;", "&");
    let filekey = url_query_value(&normalized, "encfilekey").unwrap_or_default();
    if filekey.is_empty() {
        return String::new();
    }
    normalized
}

fn first_downloadable_video_url(feed_info: &Value) -> String {
    let candidates = [
        ["videoUrl"].as_slice(),
        ["h264VideoInfo", "videoUrl"].as_slice(),
        ["h265VideoInfo", "videoUrl"].as_slice(),
        ["originVideoUrl"].as_slice(),
    ];
    for path in candidates {
        if let Some(value) = value_at_path(feed_info, path)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.contains("encfilekey"))
        {
            return value.to_string();
        }
    }
    let mut urls = Vec::new();
    collect_downloadable_urls(feed_info, &mut urls);
    urls.into_iter().next().unwrap_or_default()
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn collect_downloadable_urls(value: &Value, urls: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if text.contains("encfilekey") && text.starts_with("http") {
                urls.push(text.trim().to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_downloadable_urls(item, urls);
            }
        }
        Value::Object(map) => {
            for value in map.values() {
                collect_downloadable_urls(value, urls);
            }
        }
        _ => {}
    }
}

fn url_query_value(raw_url: &str, key: &str) -> Option<String> {
    let query = raw_url.split_once('?')?.1.split('#').next().unwrap_or("");
    for part in query.split('&') {
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        if k == key {
            return Some(url_decode(v));
        }
    }
    None
}

fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                output.push(high * 16 + low);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            output.push(b' ');
        } else {
            output.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn url_encode(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char)
            }
            _ => output.push_str(&format!("%{:02X}", byte)),
        }
    }
    output
}

struct WxChannelsHistoryDownload {
    path: String,
    filename: String,
    download_dir: String,
    size_bytes: u64,
}

fn upsert_wx_channels_history(
    conn: &Connection,
    share_url: &str,
    profile: &WxChannelsProfile,
    download: Option<&WxChannelsHistoryDownload>,
) -> Result<String, ApiError> {
    let existing_id = conn
        .query_row(
            "SELECT id FROM wx_channels_history WHERE share_url = ?1 LIMIT 1",
            params![share_url],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let id = existing_id.unwrap_or_else(|| format!("wxh_{}", Uuid::new_v4().simple()));
    let now = now_iso();
    let parsed_at = conn
        .query_row(
            "SELECT parsed_at FROM wx_channels_history WHERE id = ?1 LIMIT 1",
            params![id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .unwrap_or_else(|| now.clone());

    let downloaded_at = download.map(|_| now.clone());
    conn.execute(
        "INSERT INTO wx_channels_history
          (id, share_url, author, author_icon, cover_url, description, video_url,
           origin_video_url, create_time, downloaded_path, downloaded_filename,
           download_dir, size_bytes, parsed_at, downloaded_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(share_url) DO UPDATE SET
           author = excluded.author,
           author_icon = excluded.author_icon,
           cover_url = excluded.cover_url,
           description = excluded.description,
           video_url = excluded.video_url,
           origin_video_url = excluded.origin_video_url,
           create_time = excluded.create_time,
           downloaded_path = COALESCE(excluded.downloaded_path, wx_channels_history.downloaded_path),
           downloaded_filename = COALESCE(excluded.downloaded_filename, wx_channels_history.downloaded_filename),
           download_dir = COALESCE(excluded.download_dir, wx_channels_history.download_dir),
           size_bytes = COALESCE(excluded.size_bytes, wx_channels_history.size_bytes),
           downloaded_at = COALESCE(excluded.downloaded_at, wx_channels_history.downloaded_at),
           updated_at = excluded.updated_at",
        params![
            id.as_str(),
            share_url,
            profile.author,
            profile.author_icon,
            profile.cover_url,
            profile.description,
            profile.video_url,
            profile.origin_video_url,
            profile.create_time,
            download.map(|value| value.path.as_str()),
            download.map(|value| value.filename.as_str()),
            download.map(|value| value.download_dir.as_str()),
            download.map(|value| value.size_bytes as i64),
            parsed_at,
            downloaded_at,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(id)
}

fn wx_channels_history_row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let profile = WxChannelsProfile {
        author: row.get(2)?,
        author_icon: row.get(3)?,
        cover_url: row.get(4)?,
        description: row.get(5)?,
        video_url: row.get(6)?,
        origin_video_url: row.get(7)?,
        create_time: row.get(8)?,
    };
    let id: String = row.get(0)?;
    let share_url: String = row.get(1)?;
    let downloaded_path: Option<String> = row.get(9)?;
    let downloaded_filename: Option<String> = row.get(10)?;
    let download_dir: Option<String> = row.get(11)?;
    let size_bytes: Option<i64> = row.get(12)?;
    let parsed_at: String = row.get(13)?;
    let downloaded_at: Option<String> = row.get(14)?;
    let updated_at: String = row.get(15)?;

    Ok(json!({
      "id": id,
      "shareUrl": share_url,
      "profile": wx_channels_profile_json(&profile, Some(&id)),
      "path": downloaded_path.unwrap_or_default(),
      "filename": downloaded_filename.unwrap_or_default(),
      "downloadDir": download_dir.unwrap_or_default(),
      "sizeBytes": size_bytes.unwrap_or(0),
      "parsedAt": parsed_at,
      "downloadedAt": downloaded_at,
      "updatedAt": updated_at
    }))
}

fn wx_channels_profile_json(profile: &WxChannelsProfile, history_id: Option<&str>) -> Value {
    let mut value = json!({
      "author": profile.author,
      "authorIcon": profile.author_icon,
      "coverUrl": profile.cover_url,
      "description": profile.description,
      "videoUrl": profile.video_url,
      "originVideoUrl": profile.origin_video_url,
      "createTime": profile.create_time
    });
    if let Some(history_id) = history_id {
        value["historyId"] = json!(history_id);
    }
    value
}

fn unique_download_path(dir: &FsPath, raw_filename: &str) -> PathBuf {
    let base = sanitize_filename(raw_filename);
    let base = base
        .strip_suffix(".mp4")
        .unwrap_or(base.as_str())
        .trim()
        .to_string();
    let base = if base.is_empty() {
        "wx_channels_video".to_string()
    } else {
        base
    };
    let mut candidate = dir.join(format!("{}.mp4", base));
    let mut index = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{}-{}.mp4", base, index));
        index += 1;
    }
    candidate
}

fn sanitize_filename(input: &str) -> String {
    let mut output = String::with_capacity(input.len().min(120));
    for ch in input.chars() {
        if matches!(
            ch,
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'
        ) || ch.is_control()
        {
            output.push('_');
        } else {
            output.push(ch);
        }
        if output.chars().count() >= 120 {
            break;
        }
    }
    output.trim().trim_matches('.').to_string()
}
