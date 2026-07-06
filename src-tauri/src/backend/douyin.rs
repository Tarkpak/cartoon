use super::*;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderValue as ReqwestHeaderValue};
use reqwest::redirect::Policy;
use std::fs::File;

const DOUYIN_DOWNLOAD_DIR: &str = "tools/douyin-download";
const DOUYIN_DETAIL_URL: &str = "https://www.douyin.com/aweme/v1/web/aweme/detail/";
const DOUYIN_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const DOUYIN_TTWID: &str = "1%7CvDWCB8tYdKPbdOlqwNTkDPhizBaV9i91KjYLKJbqurg%7C1723536402%7C314e63000decb79f46b8ff255560b29f4d8c57352dad465b41977db4830b4c7e";
const DOUYIN_WEBID: &str = "7307457174287205926";

#[derive(Deserialize)]
pub(super) struct DouyinParseBody {
    pub(super) url: String,
}

#[derive(Deserialize)]
pub(super) struct DouyinDownloadBody {
    pub(super) url: String,
    pub(super) filename: Option<String>,
}

#[derive(Clone, Debug)]
struct DouyinProfile {
    title: String,
    video_url: String,
    cover_url: String,
    aweme_id: String,
    real_url: String,
}

pub(super) async fn api_tools_douyin_parse(
    State(state): State<BackendState>,
    Json(body): Json<DouyinParseBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = fetch_douyin_profile(&body.url).await?;
    let conn = db_connection(&state)?;
    let history_id = upsert_douyin_history(&conn, &profile, None)?;
    Ok(Json(json!({
      "success": true,
      "data": douyin_profile_json(&profile, Some(&history_id))
    })))
}

pub(super) async fn api_tools_douyin_download(
    State(state): State<BackendState>,
    Json(body): Json<DouyinDownloadBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = fetch_douyin_profile(&body.url).await?;
    if profile.video_url.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "未获取到可下载视频地址"));
    }

    let dir = douyin_download_dir(&state);
    fs::create_dir_all(&dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let filename = body
        .filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if profile.title.trim().is_empty() {
                "douyin_video"
            } else {
                profile.title.trim()
            }
        });
    let target_path = unique_douyin_download_path(&dir, filename);
    download_douyin_video(&profile.video_url, &target_path).await?;
    let file_size = fs::metadata(&target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let download = DouyinHistoryDownload {
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
    let history_id = upsert_douyin_history(&conn, &profile, Some(&download))?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "profile": douyin_profile_json(&profile, Some(&history_id)),
        "path": download.path,
        "filename": download.filename,
        "downloadDir": download.download_dir,
        "sizeBytes": file_size
      }
    })))
}

pub(super) async fn api_tools_douyin_preview(
    Query(query): Query<HashMap<String, String>>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    let target = query
        .get("url")
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url 不能为空"))?;
    if target.chars().count() > 4096 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "url 不能超过 4096 个字符"));
    }
    if !(target.starts_with("https://") || target.starts_with("http://")) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "仅支持 http/https 视频地址"));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut request = client
        .get(&target)
        .header("User-Agent", DOUYIN_USER_AGENT)
        .header("Referer", "https://www.douyin.com/")
        .header("Accept", "video/webm,video/ogg,video/*;q=0.9,*/*;q=0.8");
    if let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("bytes="))
    {
        request = request.header(reqwest::header::RANGE, range);
    }

    let response = request
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("加载预览视频失败: {error}")))?;
    let status = response.status();
    if !(status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT) {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("加载预览视频失败: HTTP {}", status),
        ));
    }
    let upstream_headers = response.headers().clone();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("读取预览视频失败: {error}")))?;

    let mut builder = Response::builder().status(
        StatusCode::from_u16(status.as_u16())
            .unwrap_or(if status == reqwest::StatusCode::PARTIAL_CONTENT {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            }),
    );
    let response_headers = builder.headers_mut().ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "创建预览响应失败")
    })?;
    response_headers.insert(
        header::CONTENT_TYPE,
        upstream_headers
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| HeaderValue::from_str(value).ok())
            .unwrap_or_else(|| HeaderValue::from_static("video/mp4")),
    );
    response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for (source, target) in [
        (reqwest::header::CONTENT_LENGTH, header::CONTENT_LENGTH),
        (reqwest::header::CONTENT_RANGE, header::CONTENT_RANGE),
    ] {
        if let Some(value) = upstream_headers
            .get(source)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| HeaderValue::from_str(value).ok())
        {
            response_headers.insert(target, value);
        }
    }

    builder
        .body(axum::body::Body::from(bytes))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) async fn api_tools_douyin_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, aweme_id, real_url, title, cover_url, video_url,
                    downloaded_path, downloaded_filename, download_dir, size_bytes,
                    parsed_at, downloaded_at, updated_at
             FROM douyin_history
             ORDER BY updated_at DESC
             LIMIT 30",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let items = stmt
        .query_map([], douyin_history_row_json)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "data": { "items": items }
    })))
}

pub(super) async fn api_tools_douyin_history_delete(
    State(state): State<BackendState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let target = id.trim();
    if target.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "历史记录 ID 不能为空"));
    }
    let conn = db_connection(&state)?;
    conn.execute("DELETE FROM douyin_history WHERE id = ?1", params![target])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

fn douyin_download_dir(state: &BackendState) -> PathBuf {
    state.data_dir.join(DOUYIN_DOWNLOAD_DIR)
}

async fn fetch_douyin_profile(input: &str) -> Result<DouyinProfile, ApiError> {
    let url = extract_input_url(input).ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "请填写抖音分享链接或分享文案")
    })?;
    let real_url = if is_douyin_short_url(&url) {
        fetch_douyin_redirect_url(&url).await?
    } else {
        extract_douyin_video_address(&url)
    };
    let domain = url_domain(&real_url);
    if domain != "www.douyin.com" && domain != "www.iesdouyin.com" {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "仅支持抖音视频链接"));
    }
    let aweme_id = extract_aweme_id(&real_url);
    if aweme_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "未识别到抖音视频 ID"));
    }

    let ms_token = generate_ms_token(107);
    let query_params = format!(
        "device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id={}&update_version_code=170400&pc_client_type=1&version_code=190500&version_name=19.5.0&cookie_enabled=true&screen_width=1536&screen_height=864&browser_language=zh-CN&browser_platform=Win32&browser_name=Chrome&browser_version=127.0.0.0&browser_online=true&engine_name=Blink&engine_version=127.0.0.0&os_name=Windows&os_version=10&cpu_core_num=8&device_memory=8&platform=PC&downlink=1.25&effective_type=4g&round_trip_time=50&webid={}&msToken={}",
        aweme_id, DOUYIN_WEBID, ms_token
    );
    let a_bogus = generate_a_bogus(&query_params, DOUYIN_USER_AGENT);
    let api_url = format!("{}?{}&a_bogus={}", DOUYIN_DETAIL_URL, query_params, a_bogus);
    let referer = format!(
        "https://www.douyin.com/video/{}w?previous_page=web_code_link",
        aweme_id
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let response = client
        .get(api_url)
        .headers(douyin_headers(&referer, &ms_token)?)
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("请求抖音详情失败: {error}")))?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("抖音详情请求失败: HTTP {}", response.status()),
        ));
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("解析抖音响应失败: {error}")))?;
    let detail = body
        .get("aweme_detail")
        .filter(|value| value.is_object())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "抖音接口未返回视频详情"))?;
    let title = detail
        .get("desc")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let video_url = first_douyin_video_url(detail);
    if video_url.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "解析成功但没有可下载视频地址"));
    }
    let cover_url = detail
        .get("video")
        .and_then(|value| value.get("cover_original_scale"))
        .and_then(|value| value.get("url_list"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    Ok(DouyinProfile {
        title,
        video_url,
        cover_url,
        aweme_id,
        real_url,
    })
}

async fn fetch_douyin_redirect_url(url: &str) -> Result<String, ApiError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut current_url = url.to_string();
    for _ in 0..10 {
        let response = client
            .get(&current_url)
            .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1")
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "zh-CN,zh;q=0.9")
            .send()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("请求抖音短链失败: {error}")))?;
        if let Some(location) = response.headers().get("location").and_then(|value| value.to_str().ok()) {
            let next_url = absolutize_url(&current_url, location);
            let domain = url_domain(&next_url);
            if domain == "webcast.amemv.com" || next_url.contains("/webcast/") {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "这是抖音直播链接，不是视频链接"));
            }
            if domain == "www.douyin.com" || domain == "www.iesdouyin.com" {
                return Ok(extract_douyin_video_address(&next_url));
            }
            current_url = next_url;
            continue;
        }
        if response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            if let Some(found) = find_douyin_video_url_in_text(&text) {
                return Ok(found);
            }
        }
        break;
    }
    Err(ApiError::new(StatusCode::BAD_GATEWAY, "无法获取抖音短链跳转地址"))
}

async fn download_douyin_video(video_url: &str, target_path: &FsPath) -> Result<(), ApiError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut response = client
        .get(video_url)
        .header("User-Agent", DOUYIN_USER_AGENT)
        .header("Referer", "https://www.douyin.com/")
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, format!("下载视频失败: {error}")))?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("下载视频失败: HTTP {}", response.status()),
        ));
    }
    let mut file = File::create(target_path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        ApiError::new(StatusCode::BAD_GATEWAY, format!("读取视频数据失败: {error}"))
    })? {
        file.write_all(&chunk)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(())
}

fn douyin_headers(referer: &str, ms_token: &str) -> Result<ReqwestHeaderMap, ApiError> {
    let mut headers = ReqwestHeaderMap::new();
    header(&mut headers, "Accept", "application/json, text/plain, */*")?;
    header(&mut headers, "Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")?;
    header(&mut headers, "User-Agent", DOUYIN_USER_AGENT)?;
    header(&mut headers, "Referer", referer)?;
    header(&mut headers, "sec-ch-ua", "\"Google Chrome\";v=\"123\", \"Not:A-Brand\";v=\"8\", \"Chromium\";v=\"123\"")?;
    header(&mut headers, "sec-ch-ua-mobile", "?0")?;
    header(&mut headers, "sec-ch-ua-platform", "\"Windows\"")?;
    header(&mut headers, "Sec-Fetch-Site", "same-origin")?;
    header(&mut headers, "Sec-Fetch-Mode", "cors")?;
    header(&mut headers, "Sec-Fetch-Dest", "empty")?;
    header(&mut headers, "Cookie", &format!("ttwid={}; msToken={}", DOUYIN_TTWID, ms_token))?;
    Ok(headers)
}

fn header(headers: &mut ReqwestHeaderMap, key: &'static str, value: &str) -> Result<(), ApiError> {
    let value = ReqwestHeaderValue::from_str(value)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    headers.insert(key, value);
    Ok(())
}

fn extract_input_url(input: &str) -> Option<String> {
    let text = input.trim();
    let start = text.find("http://").or_else(|| text.find("https://"))?;
    let rest = &text[start..];
    let end = rest
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace() || is_cjk_or_fullwidth(*ch))
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    let url = rest[..end]
        .trim_end_matches(|ch: char| ",，。！!?？;；:：'\"".contains(ch))
        .to_string();
    if url.is_empty() { None } else { Some(url) }
}

fn is_cjk_or_fullwidth(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fa5}').contains(&ch)
        || ('\u{3000}'..='\u{303f}').contains(&ch)
        || ('\u{ff00}'..='\u{ffef}').contains(&ch)
}

fn is_douyin_short_url(url: &str) -> bool {
    url_domain(url) == "v.douyin.com"
}

fn url_domain(raw_url: &str) -> String {
    let without_scheme = raw_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(raw_url);
    without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .last()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn extract_douyin_video_address(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let path_start = rest.find('/').unwrap_or(rest.len());
    let path = &rest[path_start..];
    let path = path.split(['?', '#']).next().unwrap_or("");
    let mut address = format!("{}://{}{}", scheme, host, path);
    if address.ends_with('/') {
        address.pop();
    }
    address
}

fn extract_aweme_id(url: &str) -> String {
    let path = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .split_once('/')
        .map(|(_, path)| path)
        .unwrap_or("");
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    for pair in parts.windows(2) {
        if pair[0] == "video" {
            return pair[1].trim_end_matches('w').to_string();
        }
    }
    parts.last().copied().unwrap_or("").trim_end_matches('w').to_string()
}

fn absolutize_url(current_url: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    if location.starts_with('/') {
        let Some((scheme, rest)) = current_url.split_once("://") else {
            return location.to_string();
        };
        let host = rest.split('/').next().unwrap_or("");
        return format!("{}://{}{}", scheme, host, location);
    }
    location.to_string()
}

fn find_douyin_video_url_in_text(text: &str) -> Option<String> {
    let marker = "https://www.douyin.com/video/";
    let start = text.find(marker)?;
    let rest = &text[start..];
    let end = rest
        .char_indices()
        .find(|(_, ch)| !(ch.is_ascii_digit() || marker.contains(*ch)))
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

fn first_douyin_video_url(detail: &Value) -> String {
    let Some(bit_rates) = detail
        .get("video")
        .and_then(|value| value.get("bit_rate"))
        .and_then(Value::as_array)
    else {
        return String::new();
    };
    for bit_rate in bit_rates {
        let Some(url_list) = bit_rate
            .get("play_addr")
            .and_then(|value| value.get("url_list"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        if let Some(url) = url_list
            .get(2)
            .or_else(|| url_list.first())
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            return url.replace("playwm", "play");
        }
    }
    String::new()
}

fn generate_ms_token(length: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=";
    let random = random_bytes(length);
    random
        .into_iter()
        .map(|byte| CHARS[byte as usize % CHARS.len()] as char)
        .collect()
}

fn random_bytes(length: usize) -> Vec<u8> {
    let rng = SystemRandom::new();
    let mut bytes = vec![0; length];
    if rng.fill(&mut bytes).is_err() {
        let seed = Utc::now().timestamp_nanos_opt().unwrap_or_default() as u64;
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = seed.wrapping_shr(((index % 8) * 8) as u32) as u8 ^ index as u8;
        }
    }
    bytes
}

fn generate_a_bogus(url_search_params: &str, user_agent: &str) -> String {
    let mut result = generate_random_str();
    result.extend(generate_rc4_bb_bytes(
        url_search_params,
        user_agent,
        "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32",
    ));
    format!("{}=", result_encrypt(&result, "s4"))
}

fn generate_random_str() -> Vec<u8> {
    let random = random_bytes(6);
    let numbers = [
        u16::from_be_bytes([random[0], random[1]]) % 10000,
        u16::from_be_bytes([random[2], random[3]]) % 10000,
        u16::from_be_bytes([random[4], random[5]]) % 10000,
    ];
    let mut output = Vec::new();
    output.extend(gener_random(numbers[0], [3, 45]));
    output.extend(gener_random(numbers[1], [1, 0]));
    output.extend(gener_random(numbers[2], [1, 5]));
    output
}

fn gener_random(random: u16, option: [u8; 2]) -> [u8; 4] {
    [
        (random as u8 & 170) | (option[0] & 85),
        (random as u8 & 85) | (option[0] & 170),
        ((random >> 8) as u8 & 170) | (option[1] & 85),
        ((random >> 8) as u8 & 85) | (option[1] & 170),
    ]
}

fn generate_rc4_bb_bytes(url_search_params: &str, user_agent: &str, window_env_str: &str) -> Vec<u8> {
    let start_time = Utc::now().timestamp_millis();
    let url_hash_source = url_search_params.as_bytes_with_suffix("cus");
    let url_hash_once = sm3_sum(&url_hash_source);
    let url_search_params_list = sm3_sum(&url_hash_once);
    let cus_once = sm3_sum(b"cus");
    let cus = sm3_sum(&cus_once);
    let ua_rc4 = rc4_encrypt(user_agent.as_bytes(), &[0, 1, 14]);
    let ua_encoded = result_encrypt(&ua_rc4, "s3");
    let ua = sm3_sum(ua_encoded.as_bytes());
    let end_time = Utc::now().timestamp_millis();
    let page_id = 6241u32;
    let aid = 6383u32;
    let args = [0u32, 1u32, 14u32];
    let env = window_env_str.as_bytes();
    let mut b = [0u8; 73];
    b[8] = 3;
    write_i64_bytes(&mut b, 16, start_time);
    b[18] = 44;
    write_u32_bytes(&mut b, 26, args[0]);
    b[30] = ((args[1] / 256) & 255) as u8;
    b[31] = (args[1] % 256) as u8;
    b[32] = ((args[1] >> 24) & 255) as u8;
    b[33] = ((args[1] >> 16) & 255) as u8;
    write_u32_bytes(&mut b, 34, args[2]);
    b[38] = url_search_params_list[21];
    b[39] = url_search_params_list[22];
    b[40] = cus[21];
    b[41] = cus[22];
    b[42] = ua[23];
    b[43] = ua[24];
    write_i64_bytes(&mut b, 44, end_time);
    b[48] = b[8];
    b[49] = ((end_time / 256 / 256 / 256 / 256) & 255) as u8;
    b[50] = ((end_time / 256 / 256 / 256 / 256 / 256) & 255) as u8;
    b[51] = page_id as u8;
    b[52] = ((page_id >> 24) & 255) as u8;
    b[53] = ((page_id >> 16) & 255) as u8;
    b[54] = ((page_id >> 8) & 255) as u8;
    b[55] = (page_id & 255) as u8;
    b[56] = aid as u8;
    b[57] = (aid & 255) as u8;
    b[58] = ((aid >> 8) & 255) as u8;
    b[59] = ((aid >> 16) & 255) as u8;
    b[60] = ((aid >> 24) & 255) as u8;
    b[64] = env.len() as u8;
    b[65] = (env.len() & 255) as u8;
    b[66] = ((env.len() >> 8) & 255) as u8;
    b[72] = b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42] ^ b[21] ^ b[27]
        ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43] ^ b[22] ^ b[28] ^ b[32] ^ b[36]
        ^ b[23] ^ b[29] ^ b[33] ^ b[37] ^ b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48]
        ^ b[49] ^ b[50] ^ b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55] ^ b[57]
        ^ b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71];
    let order = [
        18, 20, 52, 26, 30, 34, 58, 38, 40, 53, 42, 21, 27, 54, 55, 31, 35, 57, 39, 41, 43,
        22, 28, 32, 60, 36, 23, 29, 33, 37, 44, 45, 59, 46, 47, 48, 49, 50, 24, 25, 65, 66,
        70, 71,
    ];
    let mut bb: Vec<u8> = order.into_iter().map(|index| b[index]).collect();
    bb.extend(env);
    bb.push(b[72]);
    rc4_encrypt(&bb, &[121])
}

trait BytesWithSuffix {
    fn as_bytes_with_suffix(&self, suffix: &str) -> Vec<u8>;
}

impl BytesWithSuffix for str {
    fn as_bytes_with_suffix(&self, suffix: &str) -> Vec<u8> {
        let mut bytes = self.as_bytes().to_vec();
        bytes.extend(suffix.as_bytes());
        bytes
    }
}

fn write_i64_bytes(output: &mut [u8; 73], start: usize, value: i64) {
    output[start + 4] = ((value / 256 / 256 / 256 / 256) & 255) as u8;
    output[start + 5] = ((value / 256 / 256 / 256 / 256 / 256) & 255) as u8;
    output[start] = ((value >> 24) & 255) as u8;
    output[start + 1] = ((value >> 16) & 255) as u8;
    output[start + 2] = ((value >> 8) & 255) as u8;
    output[start + 3] = (value & 255) as u8;
}

fn write_u32_bytes(output: &mut [u8; 73], start: usize, value: u32) {
    output[start] = ((value >> 24) & 255) as u8;
    output[start + 1] = ((value >> 16) & 255) as u8;
    output[start + 2] = ((value >> 8) & 255) as u8;
    output[start + 3] = (value & 255) as u8;
}

fn rc4_encrypt(plaintext: &[u8], key: &[u8]) -> Vec<u8> {
    let mut s = [0u8; 256];
    for (index, value) in s.iter_mut().enumerate() {
        *value = index as u8;
    }
    let mut j = 0usize;
    for i in 0..256 {
        j = (j + s[i] as usize + key[i % key.len()] as usize) % 256;
        s.swap(i, j);
    }
    let mut i = 0usize;
    j = 0;
    let mut cipher = Vec::with_capacity(plaintext.len());
    for byte in plaintext {
        i = (i + 1) % 256;
        j = (j + s[i] as usize) % 256;
        s.swap(i, j);
        let k = s[(s[i] as usize + s[j] as usize) % 256];
        cipher.push(k ^ *byte);
    }
    cipher
}

fn result_encrypt(long_bytes: &[u8], num: &str) -> String {
    let alphabet = match num {
        "s3" => b"ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe".as_slice(),
        "s4" => b"Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe".as_slice(),
        "s2" => b"Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=".as_slice(),
        "s1" => b"Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=".as_slice(),
        _ => b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".as_slice(),
    };
    let mut result = String::new();
    let output_len = (long_bytes.len() * 4 + 2) / 3;
    let mut round = 0usize;
    let mut long_int = get_long_int(round, long_bytes);
    for i in 0..output_len {
        if i / 4 != round {
            round += 1;
            long_int = get_long_int(round, long_bytes);
        }
        let index = match i % 4 {
            0 => (long_int & 0xFC0000) >> 18,
            1 => (long_int & 0x03F000) >> 12,
            2 => (long_int & 0x000FC0) >> 6,
            _ => long_int & 0x00003F,
        };
        result.push(alphabet[index as usize] as char);
    }
    result
}

fn get_long_int(round: usize, bytes: &[u8]) -> u32 {
    let index = round * 3;
    let first = bytes.get(index).copied().unwrap_or(0) as u32;
    let second = bytes.get(index + 1).copied().unwrap_or(0) as u32;
    let third = bytes.get(index + 2).copied().unwrap_or(0) as u32;
    (first << 16) | (second << 8) | third
}

fn sm3_sum(input: &[u8]) -> [u8; 32] {
    let mut reg = [
        1937774191u32,
        1226093241,
        388252375,
        3666478592,
        2842636476,
        372324522,
        3817729613,
        2969243214,
    ];
    let mut chunk = input.to_vec();
    let bit_len = (chunk.len() as u64) * 8;
    chunk.push(128);
    while chunk.len() % 64 != 56 {
        chunk.push(0);
    }
    chunk.extend_from_slice(&bit_len.to_be_bytes());
    for block in chunk.chunks(64) {
        sm3_compress(&mut reg, block);
    }
    let mut output = [0u8; 32];
    for (index, value) in reg.iter().enumerate() {
        output[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    output
}

fn sm3_compress(reg: &mut [u32; 8], block: &[u8]) {
    let mut w = [0u32; 132];
    for i in 0..16 {
        w[i] = u32::from_be_bytes([
            block[4 * i],
            block[4 * i + 1],
            block[4 * i + 2],
            block[4 * i + 3],
        ]);
    }
    for i in 16..68 {
        let a = w[i - 16] ^ w[i - 9] ^ w[i - 3].rotate_left(15);
        let p1 = a ^ a.rotate_left(15) ^ a.rotate_left(23);
        w[i] = p1 ^ w[i - 13].rotate_left(7) ^ w[i - 6];
    }
    for i in 0..64 {
        w[i + 68] = w[i] ^ w[i + 4];
    }
    let mut v = *reg;
    for i in 0..64 {
        let t = if i < 16 { 2043430169u32 } else { 2055708042u32 };
        let ss1 = v[0]
            .rotate_left(12)
            .wrapping_add(v[4])
            .wrapping_add(t.rotate_left(i as u32))
            .rotate_left(7);
        let ss2 = ss1 ^ v[0].rotate_left(12);
        let ff = if i < 16 {
            v[0] ^ v[1] ^ v[2]
        } else {
            (v[0] & v[1]) | (v[0] & v[2]) | (v[1] & v[2])
        };
        let gg = if i < 16 {
            v[4] ^ v[5] ^ v[6]
        } else {
            (v[4] & v[5]) | ((!v[4]) & v[6])
        };
        let tt1 = ff
            .wrapping_add(v[3])
            .wrapping_add(ss2)
            .wrapping_add(w[i + 68]);
        let tt2 = gg
            .wrapping_add(v[7])
            .wrapping_add(ss1)
            .wrapping_add(w[i]);
        v[3] = v[2];
        v[2] = v[1].rotate_left(9);
        v[1] = v[0];
        v[0] = tt1;
        v[7] = v[6];
        v[6] = v[5].rotate_left(19);
        v[5] = v[4];
        v[4] = tt2 ^ tt2.rotate_left(9) ^ tt2.rotate_left(17);
    }
    for i in 0..8 {
        reg[i] ^= v[i];
    }
}

struct DouyinHistoryDownload {
    path: String,
    filename: String,
    download_dir: String,
    size_bytes: u64,
}

fn upsert_douyin_history(
    conn: &Connection,
    profile: &DouyinProfile,
    download: Option<&DouyinHistoryDownload>,
) -> Result<String, ApiError> {
    let existing_id = conn
        .query_row(
            "SELECT id FROM douyin_history WHERE aweme_id = ?1 LIMIT 1",
            params![profile.aweme_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let id = existing_id.unwrap_or_else(|| format!("dy_{}", Uuid::new_v4().simple()));
    let now = now_iso();
    let parsed_at = conn
        .query_row(
            "SELECT parsed_at FROM douyin_history WHERE id = ?1 LIMIT 1",
            params![id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .unwrap_or_else(|| now.clone());
    let downloaded_at = download.map(|_| now.clone());
    conn.execute(
        "INSERT INTO douyin_history
          (id, aweme_id, real_url, title, cover_url, video_url, downloaded_path,
           downloaded_filename, download_dir, size_bytes, parsed_at, downloaded_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(aweme_id) DO UPDATE SET
           real_url = excluded.real_url,
           title = excluded.title,
           cover_url = excluded.cover_url,
           video_url = excluded.video_url,
           downloaded_path = COALESCE(excluded.downloaded_path, douyin_history.downloaded_path),
           downloaded_filename = COALESCE(excluded.downloaded_filename, douyin_history.downloaded_filename),
           download_dir = COALESCE(excluded.download_dir, douyin_history.download_dir),
           size_bytes = COALESCE(excluded.size_bytes, douyin_history.size_bytes),
           downloaded_at = COALESCE(excluded.downloaded_at, douyin_history.downloaded_at),
           updated_at = excluded.updated_at",
        params![
            id.as_str(),
            profile.aweme_id,
            profile.real_url,
            profile.title,
            profile.cover_url,
            profile.video_url,
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

fn douyin_history_row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let id: String = row.get(0)?;
    let profile = DouyinProfile {
        aweme_id: row.get(1)?,
        real_url: row.get(2)?,
        title: row.get(3)?,
        cover_url: row.get(4)?,
        video_url: row.get(5)?,
    };
    let downloaded_path: Option<String> = row.get(6)?;
    let downloaded_filename: Option<String> = row.get(7)?;
    let download_dir: Option<String> = row.get(8)?;
    let size_bytes: Option<i64> = row.get(9)?;
    let parsed_at: String = row.get(10)?;
    let downloaded_at: Option<String> = row.get(11)?;
    let updated_at: String = row.get(12)?;

    Ok(json!({
      "id": id,
      "profile": douyin_profile_json(&profile, Some(&id)),
      "path": downloaded_path.unwrap_or_default(),
      "filename": downloaded_filename.unwrap_or_default(),
      "downloadDir": download_dir.unwrap_or_default(),
      "sizeBytes": size_bytes.unwrap_or(0),
      "parsedAt": parsed_at,
      "downloadedAt": downloaded_at,
      "updatedAt": updated_at
    }))
}

fn douyin_profile_json(profile: &DouyinProfile, history_id: Option<&str>) -> Value {
    let mut value = json!({
      "title": profile.title,
      "videoUrl": profile.video_url,
      "coverUrl": profile.cover_url,
      "awemeId": profile.aweme_id,
      "realUrl": profile.real_url
    });
    if let Some(history_id) = history_id {
        value["historyId"] = json!(history_id);
    }
    value
}

fn unique_douyin_download_path(dir: &FsPath, raw_filename: &str) -> PathBuf {
    let base = sanitize_filename(raw_filename);
    let base = base
        .strip_suffix(".mp4")
        .unwrap_or(base.as_str())
        .trim()
        .to_string();
    let base = if base.is_empty() {
        "douyin_video".to_string()
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
        if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0')
            || ch.is_control()
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
