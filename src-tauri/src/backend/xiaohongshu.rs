use super::*;
use md5::Md5;
use std::fs::File;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

const XIAOHONGSHU_DOWNLOAD_DIR: &str = "tools/xiaohongshu-download";
const XIAOHONGSHU_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const XIAOHONGSHU_FEED_PATH: &str = "/api/sns/web/v1/feed";
const XIAOHONGSHU_COMMON_BASE64_ALPHABET: &[u8; 64] =
    b"ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5";
const XIAOHONGSHU_MNS_BASE64_ALPHABET: &[u8; 64] =
    b"MfgqrsbcyzPQRStuvC7mn501HIJBo2DEYZajkl63Gp89+/A4UVFTKdeNOwxWXLhi";
const XIAOHONGSHU_XXTEA_KEY: &[u8; 16] = b"e6483ca2a1eed5e3";
const XIAOHONGSHU_XXTEA_DELTA: u32 = 1_013_904_243;
static XIAOHONGSHU_A1: OnceLock<String> = OnceLock::new();
static XIAOHONGSHU_NAVIGATION_START: OnceLock<i64> = OnceLock::new();
static XIAOHONGSHU_SIGN_COUNT: AtomicU32 = AtomicU32::new(0);

#[derive(serde::Serialize)]
struct XiaohongshuFeedExtra {
    need_body_topic: u8,
}

#[derive(serde::Serialize)]
struct XiaohongshuFeedBody<'a> {
    source_note_id: &'a str,
    image_formats: [&'static str; 3],
    extra: XiaohongshuFeedExtra,
    xsec_source: &'a str,
    xsec_token: &'a str,
}

struct XiaohongshuSignature {
    x_s: String,
    x_t: i64,
    x_s_common: String,
}

#[derive(serde::Serialize)]
struct XiaohongshuCommonSignature<'a> {
    s0: u8,
    s1: &'static str,
    x0: &'static str,
    x1: &'static str,
    x2: &'static str,
    x3: &'static str,
    x4: &'static str,
    x5: &'a str,
    x6: &'static str,
    x7: &'static str,
    x8: &'static str,
    x9: i32,
    x10: u8,
    x11: &'static str,
    x12: &'a str,
}

#[derive(serde::Serialize)]
struct XiaohongshuXysPayload {
    x0: &'static str,
    x1: &'static str,
    x2: &'static str,
    x3: String,
    x4: &'static str,
    x5: String,
}

#[derive(Deserialize)]
pub(super) struct XiaohongshuParseBody {
    pub(super) url: String,
}

#[derive(Deserialize)]
pub(super) struct XiaohongshuDownloadBody {
    pub(super) url: String,
    pub(super) filename: Option<String>,
    pub(super) image_index: Option<usize>,
}

#[derive(Clone, Debug)]
struct XiaohongshuProfile {
    note_id: String,
    source_url: String,
    title: String,
    description: String,
    author: String,
    author_icon: String,
    create_time: Option<i64>,
    image_urls: Vec<String>,
    cover_url: String,
}

struct XiaohongshuHistoryDownload {
    path: String,
    filename: String,
    download_dir: String,
    size_bytes: u64,
}

pub(super) async fn api_tools_xiaohongshu_parse(
    State(state): State<BackendState>,
    Json(body): Json<XiaohongshuParseBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = fetch_xiaohongshu_profile(&state, &body.url).await?;
    let conn = db_connection(&state)?;
    let history_id = upsert_xiaohongshu_history(&conn, &profile, None)?;
    Ok(Json(json!({
      "success": true,
      "data": xiaohongshu_profile_json(&profile, Some(&history_id))
    })))
}

pub(super) async fn api_tools_xiaohongshu_download(
    State(state): State<BackendState>,
    Json(body): Json<XiaohongshuDownloadBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = fetch_xiaohongshu_profile(&state, &body.url).await?;
    let dir = state.data_dir.join(XIAOHONGSHU_DOWNLOAD_DIR);
    fs::create_dir_all(&dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let filename = body
        .filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if profile.title.trim().is_empty() {
                "xiaohongshu_images"
            } else {
                profile.title.trim()
            }
        });

    let target_path = if let Some(image_index) = body.image_index {
        let image_url = profile
            .image_urls
            .get(image_index)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "要下载的图片序号无效"))?;
        let (bytes, extension) = fetch_xiaohongshu_image(image_url, image_index).await?;
        let single_filename = format!(
            "{}-{:02}",
            strip_download_extension(filename),
            image_index + 1
        );
        let path = unique_xiaohongshu_file_path(&dir, &single_filename, extension);
        fs::write(&path, bytes)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        path
    } else {
        let path = unique_xiaohongshu_file_path(&dir, filename, "zip");
        download_xiaohongshu_images(&profile.image_urls, &path).await?;
        path
    };

    let file_size = fs::metadata(&target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let download = XiaohongshuHistoryDownload {
        path: target_path.to_string_lossy().to_string(),
        filename: target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(if body.image_index.is_some() {
                "image.jpg"
            } else {
                "images.zip"
            })
            .to_string(),
        download_dir: dir.to_string_lossy().to_string(),
        size_bytes: file_size,
    };
    let conn = db_connection(&state)?;
    let history_id = upsert_xiaohongshu_history(&conn, &profile, Some(&download))?;

    Ok(Json(json!({
      "success": true,
      "data": {
        "profile": xiaohongshu_profile_json(&profile, Some(&history_id)),
        "path": download.path,
        "filename": download.filename,
        "downloadDir": download.download_dir,
        "sizeBytes": file_size,
        "imageIndex": body.image_index
      }
    })))
}

pub(super) async fn api_tools_xiaohongshu_preview(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let target = query
        .get("url")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url 不能为空"))?;
    if target.chars().count() > 4096 || !is_xiaohongshu_image_url(&target) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持小红书图片地址",
        ));
    }

    let client = xiaohongshu_client(Duration::from_secs(120))?;
    let response = client
        .get(&target)
        .header("User-Agent", XIAOHONGSHU_USER_AGENT)
        .header("Referer", "https://www.xiaohongshu.com/")
        .header(
            "Accept",
            "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("加载图片预览失败: {error}"),
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("加载图片预览失败: HTTP {}", response.status()),
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = response.bytes().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取图片预览失败: {error}"),
        )
    })?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .body(axum::body::Body::from(bytes))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) async fn api_tools_xiaohongshu_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, note_id, source_url, title, description, author, author_icon,
                    create_time, cover_url, image_urls_json, downloaded_path,
                    downloaded_filename, download_dir, size_bytes, parsed_at,
                    downloaded_at, updated_at
             FROM xiaohongshu_history
             ORDER BY updated_at DESC
             LIMIT 30",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let items = stmt
        .query_map([], xiaohongshu_history_row_json)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true, "data": { "items": items } })))
}

pub(super) async fn api_tools_xiaohongshu_history_delete(
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
        "DELETE FROM xiaohongshu_history WHERE id = ?1",
        params![target],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

async fn fetch_xiaohongshu_profile(
    _backend_state: &BackendState,
    input: &str,
) -> Result<XiaohongshuProfile, ApiError> {
    let url = extract_input_url(input)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请填写小红书分享链接或分享文案"))?;
    let domain = url_domain(&url);
    if !is_xiaohongshu_page_domain(&domain) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持小红书图文链接",
        ));
    }

    let client = xiaohongshu_client(Duration::from_secs(30))?;
    let response = client
        .get(&url)
        .header("User-Agent", XIAOHONGSHU_USER_AGENT)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("请求小红书页面失败: {error}"),
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("请求小红书页面失败: HTTP {}", response.status()),
        ));
    }
    let final_url = response.url().to_string();
    if !is_xiaohongshu_page_domain(&url_domain(&final_url)) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "小红书分享链接跳转异常",
        ));
    }
    let html = response.text().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取小红书页面失败: {error}"),
        )
    })?;
    let state = parse_xiaohongshu_initial_state(&html).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            "未读取到小红书笔记数据，请确认链接仍可公开访问",
        )
    })?;
    let note_id_from_url = extract_note_id(&final_url);
    let note_map = state
        .get("note")
        .and_then(|value| value.get("noteDetailMap"))
        .and_then(Value::as_object)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "未读取到小红书笔记详情"))?;
    let initial_note = note_map
        .get(&note_id_from_url)
        .and_then(|value| value.get("note"))
        .or_else(|| note_map.values().find_map(|value| value.get("note")))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "小红书笔记详情为空"))?;
    let dynamic_note;
    let note = if initial_note
        .as_object()
        .is_none_or(|value| value.is_empty())
    {
        let payload =
            fetch_xiaohongshu_dynamic_note(&client, &final_url, &note_id_from_url).await?;
        dynamic_note = extract_dynamic_note(&payload).ok_or_else(|| {
            ApiError::new(StatusCode::BAD_GATEWAY, "小红书动态接口未返回笔记详情")
        })?;
        &dynamic_note
    } else {
        initial_note
    };

    xiaohongshu_profile_from_note(note, note_id_from_url, final_url)
}

async fn fetch_xiaohongshu_dynamic_note(
    client: &Client,
    page_url: &str,
    note_id: &str,
) -> Result<Value, ApiError> {
    let page_url = reqwest::Url::parse(page_url).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("解析小红书笔记地址失败: {error}"),
        )
    })?;
    let xsec_source = page_url
        .query_pairs()
        .find_map(|(name, value)| (name == "xsec_source").then(|| value.into_owned()))
        .unwrap_or_else(|| "pc_feed".to_string());
    let xsec_token = page_url
        .query_pairs()
        .find_map(|(name, value)| (name == "xsec_token").then(|| value.into_owned()))
        .unwrap_or_default();
    let body = XiaohongshuFeedBody {
        source_note_id: note_id,
        image_formats: ["jpg", "webp", "avif"],
        extra: XiaohongshuFeedExtra { need_body_topic: 1 },
        xsec_source: &xsec_source,
        xsec_token: &xsec_token,
    };
    let body_json = serde_json::to_string(&body).map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("生成小红书动态请求失败: {error}"),
        )
    })?;
    let signature = sign_xiaohongshu_request(XIAOHONGSHU_FEED_PATH, &body_json, None)?;
    let response = client
        .post(format!(
            "https://edith.xiaohongshu.com{XIAOHONGSHU_FEED_PATH}"
        ))
        .header("User-Agent", XIAOHONGSHU_USER_AGENT)
        .header("Origin", "https://www.xiaohongshu.com")
        .header("Referer", page_url.as_str())
        .header("Content-Type", "application/json;charset=UTF-8")
        .header("X-s", &signature.x_s)
        .header("X-t", signature.x_t.to_string())
        .header("X-s-common", &signature.x_s_common)
        .header("x-b3-traceid", &Uuid::new_v4().simple().to_string()[..16])
        .header("x-xray-traceid", Uuid::new_v4().simple().to_string())
        .body(body_json)
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("请求小红书动态接口失败: {error}"),
            )
        })?;
    let status = response.status();
    let response_text = response.text().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取小红书动态数据失败: {error}"),
        )
    })?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "小红书动态接口返回 HTTP {status}: {}",
                response_text.chars().take(300).collect::<String>()
            ),
        ));
    }
    let payload: Value = serde_json::from_str(&response_text).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("小红书动态接口返回了无效数据: {error}"),
        )
    })?;
    if payload.get("success").and_then(Value::as_bool) == Some(false) {
        let message = payload
            .get("msg")
            .or_else(|| payload.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("小红书动态接口返回失败");
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
    }
    Ok(payload)
}

fn sign_xiaohongshu_request(
    path: &str,
    body_json: &str,
    timestamp: Option<i64>,
) -> Result<XiaohongshuSignature, ApiError> {
    let x_t = timestamp.unwrap_or_else(|| Utc::now().timestamp_millis());
    let a1 = xiaohongshu_a1().to_string();
    let content = format!("{path}{body_json}");
    let content_md5 = format!("{:x}", Md5::digest(content.as_bytes()));
    let path_md5 = format!("{:x}", Md5::digest(path.as_bytes()));
    let mns = xiaohongshu_mnsv2(&content, &content_md5, &path_md5, &a1, x_t)?;
    let xys = XiaohongshuXysPayload {
        x0: "4.3.9",
        x1: "xhs-pc-web",
        x2: "Windows",
        x3: mns,
        x4: "object",
        x5: content_md5,
    };
    let x_s = format!(
        "XYS_{}",
        xiaohongshu_custom_base64(
            &serde_json::to_vec(&xys).map_err(|error| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("生成小红书请求签名失败: {error}"),
                )
            })?,
            XIAOHONGSHU_COMMON_BASE64_ALPHABET,
        )
    );
    let common_fingerprint = "I38rHdgsjopgIvesdVwgI3H=";
    let common_navigation_start = *XIAOHONGSHU_NAVIGATION_START.get_or_init(|| x_t - 4_000);
    let common_browser_start = x_t - 24_729_688;
    let common_timestamps = format!("{common_navigation_start};{common_browser_start}");
    let common = XiaohongshuCommonSignature {
        s0: 5,
        s1: "",
        x0: "1",
        x1: "4.3.9",
        x2: "Windows",
        x3: "xhs-pc-web",
        x4: "6.35.0",
        x5: &a1,
        x6: "",
        x7: "",
        x8: common_fingerprint,
        x9: xiaohongshu_crc32(common_fingerprint.as_bytes()) as i32,
        x10: 0,
        x11: "normal",
        x12: &common_timestamps,
    };
    let common_json = serde_json::to_vec(&common).map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("生成小红书公共签名失败: {error}"),
        )
    })?;
    Ok(XiaohongshuSignature {
        x_s,
        x_t,
        x_s_common: xiaohongshu_custom_base64(&common_json, XIAOHONGSHU_COMMON_BASE64_ALPHABET),
    })
}

fn xiaohongshu_mnsv2(
    content: &str,
    content_md5: &str,
    path_md5: &str,
    a1: &str,
    timestamp: i64,
) -> Result<String, ApiError> {
    let mut random = [0u8; 20];
    SystemRandom::new().fill(&mut random).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "生成小红书请求随机数失败",
        )
    })?;
    let navigation_start = *XIAOHONGSHU_NAVIGATION_START.get_or_init(|| timestamp - 1_833);
    let count = XIAOHONGSHU_SIGN_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let mut packet = Vec::with_capacity(144);
    packet.extend_from_slice(&[0x79, 0x68, 0x60, 0x29]);
    packet.extend_from_slice(&random[..4]);
    packet.extend_from_slice(&(timestamp as u64).to_le_bytes());
    packet.extend_from_slice(&(navigation_start as u64).to_le_bytes());
    packet.extend_from_slice(&count.to_le_bytes());
    packet.extend_from_slice(&1_346u32.to_le_bytes());
    packet.extend_from_slice(&(content.len() as u32).to_le_bytes());
    let content_binding = xiaohongshu_masked_md5(content_md5, random[0])?;
    packet.extend_from_slice(&content_binding[..8]);
    push_xiaohongshu_short_bytes(&mut packet, a1.as_bytes())?;
    push_xiaohongshu_short_bytes(&mut packet, b"xhs-pc-web")?;
    packet.push(1);
    packet.extend_from_slice(&[
        0xaa, 0xf9, 0x41, 0x67, 0x67, 0xc9, 0xb5, 0x81, 0x63, 0x5e, 0x07, 0x44, 0xfa, 0x84, 0x15,
    ]);
    push_xiaohongshu_short_bytes(&mut packet, b"a3")?;
    let path_binding = xiaohongshu_masked_md5(path_md5, random[0])?;
    push_xiaohongshu_short_bytes(&mut packet, &path_binding)?;
    let encrypted = xiaohongshu_xxtea_encrypt(&packet);
    Ok(format!(
        "mns0201_{}",
        xiaohongshu_custom_base64(&encrypted, XIAOHONGSHU_MNS_BASE64_ALPHABET)
    ))
}

fn xiaohongshu_masked_md5(value: &str, mask: u8) -> Result<[u8; 16], ApiError> {
    if value.len() != 32 {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "小红书签名摘要长度无效",
        ));
    }
    let mut output = [0u8; 16];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        let parsed = u8::from_str_radix(&value[offset..offset + 2], 16).map_err(|_| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "小红书签名摘要格式无效")
        })?;
        *byte = parsed ^ mask;
    }
    Ok(output)
}

fn push_xiaohongshu_short_bytes(output: &mut Vec<u8>, value: &[u8]) -> Result<(), ApiError> {
    let len = u8::try_from(value.len()).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "小红书签名字段长度超出限制",
        )
    })?;
    output.push(len);
    output.extend_from_slice(value);
    Ok(())
}

fn xiaohongshu_xxtea_encrypt(input: &[u8]) -> Vec<u8> {
    let mut values = input
        .chunks(4)
        .map(|chunk| {
            let mut bytes = [0u8; 4];
            bytes[..chunk.len()].copy_from_slice(chunk);
            u32::from_le_bytes(bytes)
        })
        .collect::<Vec<_>>();
    values.push(input.len() as u32);
    let key = XIAOHONGSHU_XXTEA_KEY
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes(chunk.try_into().expect("four-byte key chunk")))
        .collect::<Vec<_>>();
    let rounds = 6 + 52 / values.len() as u32;
    let mut sum = 0u32;
    let mut z = *values.last().expect("XXTEA input is not empty");
    for _ in 0..rounds {
        sum = sum.wrapping_add(XIAOHONGSHU_XXTEA_DELTA);
        let e = (sum >> 2) & 3;
        for index in 0..values.len() {
            let y = values[(index + 1) % values.len()];
            let mix = ((z >> 5 ^ y << 2).wrapping_add(y >> 3 ^ z << 4))
                ^ ((sum ^ y).wrapping_add(key[((index as u32 & 3) ^ e) as usize] ^ z));
            values[index] = values[index].wrapping_add(mix);
            z = values[index];
        }
    }
    values.into_iter().flat_map(u32::to_le_bytes).collect()
}

fn xiaohongshu_a1() -> &'static str {
    XIAOHONGSHU_A1
        .get_or_init(|| "198caa7629bv66e5q25bgi30vat457l88mnryucvv50000230125".to_string())
}

fn xiaohongshu_crc32(input: &[u8]) -> u32 {
    let mut value = u32::MAX;
    for &byte in input.iter().take(57) {
        value ^= u32::from(byte);
        for _ in 0..8 {
            value = if value & 1 == 1 {
                0xedb8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
        }
    }
    value ^ u32::MAX ^ 0xedb8_8320
}

fn xiaohongshu_custom_base64(input: &[u8], alphabet: &[u8; 64]) -> String {
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let first = u32::from(chunk[0]);
        let second = chunk.get(1).copied().map(u32::from);
        let third = chunk.get(2).copied().map(u32::from);
        let triplet = (first << 16) | (second.unwrap_or(0) << 8) | third.unwrap_or(0);
        output.push(alphabet[((triplet >> 18) & 63) as usize] as char);
        output.push(alphabet[((triplet >> 12) & 63) as usize] as char);
        output.push(match second {
            Some(_) => alphabet[((triplet >> 6) & 63) as usize] as char,
            None => '=',
        });
        output.push(match third {
            Some(_) => alphabet[(triplet & 63) as usize] as char,
            None => '=',
        });
    }
    output
}

fn extract_dynamic_note(payload: &Value) -> Option<Value> {
    payload
        .get("data")
        .and_then(|value| value.get("items"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("note_card").or_else(|| item.get("noteCard")))
        .filter(|note| note.as_object().is_some_and(|value| !value.is_empty()))
        .cloned()
}

fn xiaohongshu_profile_from_note(
    note: &Value,
    note_id_from_url: String,
    source_url: String,
) -> Result<XiaohongshuProfile, ApiError> {
    let note_id = note
        .get("noteId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(&note_id_from_url)
        .to_string();
    let image_urls = note
        .get("imageList")
        .and_then(Value::as_array)
        .map(|images| {
            images
                .iter()
                .filter_map(xiaohongshu_original_image_url)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if image_urls.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "当前仅支持小红书图文笔记",
        ));
    }
    let title = note
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let description = note
        .get("desc")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let user = note.get("user").unwrap_or(&Value::Null);
    let create_time = note.get("time").and_then(Value::as_i64).map(|value| {
        if value > 10_000_000_000 {
            value / 1000
        } else {
            value
        }
    });

    Ok(XiaohongshuProfile {
        note_id,
        source_url,
        title: if title.is_empty() {
            description.lines().next().unwrap_or("").to_string()
        } else {
            title
        },
        description,
        author: value_string(user, "nickname"),
        author_icon: value_string(user, "avatar"),
        create_time,
        cover_url: image_urls.first().cloned().unwrap_or_default(),
        image_urls,
    })
}

fn parse_xiaohongshu_initial_state(html: &str) -> Option<Value> {
    let marker = "window.__INITIAL_STATE__=";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find("</script>").unwrap_or(rest.len());
    let raw = rest[..end].trim().trim_end_matches(';');
    serde_json::from_str(&raw.replace("undefined", "null")).ok()
}

fn xiaohongshu_original_image_url(image: &Value) -> Option<String> {
    let file_id = image
        .get("fileId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let display_url = image
        .get("urlDefault")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| image.get("urlPre").and_then(Value::as_str))
        .unwrap_or("");

    if let Some(file_id) = file_id {
        let host = url_domain(display_url);
        if let Some(region) = host
            .strip_prefix("sns-webpic-")
            .and_then(|value| value.strip_suffix(".xhscdn.com"))
            .filter(|value| !value.is_empty())
        {
            return Some(format!(
                "https://sns-img-{region}.xhscdn.com/{}",
                file_id.trim_start_matches('/')
            ));
        }
    }
    if display_url.is_empty() {
        None
    } else {
        Some(display_url.replacen("http://", "https://", 1))
    }
}

async fn download_xiaohongshu_images(
    image_urls: &[String],
    target_path: &FsPath,
) -> Result<(), ApiError> {
    let file = File::create(target_path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (index, image_url) in image_urls.iter().enumerate() {
        let (bytes, extension) = fetch_xiaohongshu_image(image_url, index).await?;
        archive
            .start_file(format!("{:02}.{extension}", index + 1), options)
            .and_then(|_| archive.write_all(&bytes).map_err(Into::into))
            .map_err(|error: zip::result::ZipError| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
    }
    archive
        .finish()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

async fn fetch_xiaohongshu_image(
    image_url: &str,
    image_index: usize,
) -> Result<(Vec<u8>, &'static str), ApiError> {
    let client = xiaohongshu_client(Duration::from_secs(180))?;
    let response = client
        .get(image_url)
        .header("User-Agent", XIAOHONGSHU_USER_AGENT)
        .header("Referer", "https://www.xiaohongshu.com/")
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("下载第 {} 张图片失败: {error}", image_index + 1),
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "下载第 {} 张图片失败: HTTP {}",
                image_index + 1,
                response.status()
            ),
        ));
    }
    let extension = image_extension(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
    );
    let bytes = response.bytes().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取第 {} 张图片失败: {error}", image_index + 1),
        )
    })?;
    Ok((bytes.to_vec(), extension))
}

fn xiaohongshu_client(timeout: Duration) -> Result<Client, ApiError> {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let root_url = reqwest::Url::parse("https://www.xiaohongshu.com/")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    jar.add_cookie_str(
        &format!("a1={}; Domain=.xiaohongshu.com; Path=/", xiaohongshu_a1()),
        &root_url,
    );
    Client::builder()
        .timeout(timeout)
        .cookie_provider(jar)
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn upsert_xiaohongshu_history(
    conn: &Connection,
    profile: &XiaohongshuProfile,
    download: Option<&XiaohongshuHistoryDownload>,
) -> Result<String, ApiError> {
    let existing_id = conn
        .query_row(
            "SELECT id FROM xiaohongshu_history WHERE note_id = ?1 LIMIT 1",
            params![profile.note_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let id = existing_id.unwrap_or_else(|| format!("xhs_{}", Uuid::new_v4().simple()));
    let now = now_iso();
    let parsed_at = conn
        .query_row(
            "SELECT parsed_at FROM xiaohongshu_history WHERE id = ?1 LIMIT 1",
            params![id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .unwrap_or_else(|| now.clone());
    let downloaded_at = download.map(|_| now.clone());
    conn.execute(
        "INSERT INTO xiaohongshu_history
          (id, note_id, source_url, title, description, author, author_icon, create_time,
           cover_url, image_urls_json, downloaded_path, downloaded_filename, download_dir,
           size_bytes, parsed_at, downloaded_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(note_id) DO UPDATE SET
           source_url = excluded.source_url,
           title = excluded.title,
           description = excluded.description,
           author = excluded.author,
           author_icon = excluded.author_icon,
           create_time = excluded.create_time,
           cover_url = excluded.cover_url,
           image_urls_json = excluded.image_urls_json,
           downloaded_path = COALESCE(excluded.downloaded_path, xiaohongshu_history.downloaded_path),
           downloaded_filename = COALESCE(excluded.downloaded_filename, xiaohongshu_history.downloaded_filename),
           download_dir = COALESCE(excluded.download_dir, xiaohongshu_history.download_dir),
           size_bytes = COALESCE(excluded.size_bytes, xiaohongshu_history.size_bytes),
           downloaded_at = COALESCE(excluded.downloaded_at, xiaohongshu_history.downloaded_at),
           updated_at = excluded.updated_at",
        params![
            id.as_str(),
            profile.note_id,
            profile.source_url,
            profile.title,
            profile.description,
            profile.author,
            profile.author_icon,
            profile.create_time,
            profile.cover_url,
            serde_json::to_string(&profile.image_urls).unwrap_or_else(|_| "[]".to_string()),
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

fn xiaohongshu_history_row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let id: String = row.get(0)?;
    let profile = XiaohongshuProfile {
        note_id: row.get(1)?,
        source_url: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        author: row.get(5)?,
        author_icon: row.get(6)?,
        create_time: row.get(7)?,
        cover_url: row.get(8)?,
        image_urls: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(9)?)
            .unwrap_or_default(),
    };
    let downloaded_path: Option<String> = row.get(10)?;
    let downloaded_filename: Option<String> = row.get(11)?;
    let download_dir: Option<String> = row.get(12)?;
    let size_bytes: Option<i64> = row.get(13)?;
    let parsed_at: String = row.get(14)?;
    let downloaded_at: Option<String> = row.get(15)?;
    let updated_at: String = row.get(16)?;
    Ok(json!({
      "id": id,
      "profile": xiaohongshu_profile_json(&profile, Some(&id)),
      "path": downloaded_path.unwrap_or_default(),
      "filename": downloaded_filename.unwrap_or_default(),
      "downloadDir": download_dir.unwrap_or_default(),
      "sizeBytes": size_bytes.unwrap_or(0),
      "parsedAt": parsed_at,
      "downloadedAt": downloaded_at,
      "updatedAt": updated_at
    }))
}

fn xiaohongshu_profile_json(profile: &XiaohongshuProfile, history_id: Option<&str>) -> Value {
    let mut value = json!({
      "noteId": profile.note_id,
      "realUrl": profile.source_url,
      "title": profile.title,
      "description": profile.description,
      "author": profile.author,
      "authorIcon": profile.author_icon,
      "createTime": profile.create_time,
      "mediaType": "image",
      "videoUrl": "",
      "imageUrls": profile.image_urls,
      "coverUrl": profile.cover_url
    });
    if let Some(history_id) = history_id {
        value["historyId"] = json!(history_id);
    }
    value
}

fn unique_xiaohongshu_file_path(dir: &FsPath, raw_filename: &str, extension: &str) -> PathBuf {
    let base = sanitize_filename(strip_download_extension(raw_filename));
    let base = if base.is_empty() {
        "xiaohongshu_images".to_string()
    } else {
        base
    };
    let mut candidate = dir.join(format!("{base}.{extension}"));
    let mut index = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{index}.{extension}"));
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

fn strip_download_extension(filename: &str) -> &str {
    for extension in [".zip", ".jpg", ".jpeg", ".png", ".webp", ".gif"] {
        if filename.to_ascii_lowercase().ends_with(extension) {
            return &filename[..filename.len() - extension.len()];
        }
    }
    filename
}

fn image_extension(content_type: Option<&str>) -> &'static str {
    match content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
    {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    }
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
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
    (!url.is_empty()).then_some(url)
}

fn is_cjk_or_fullwidth(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fa5}').contains(&ch)
        || ('\u{3000}'..='\u{303f}').contains(&ch)
        || ('\u{ff00}'..='\u{ffef}').contains(&ch)
}

fn extract_note_id(url: &str) -> String {
    if let Some(query) = url.split_once('?').map(|(_, query)| query) {
        for pair in query.split('&') {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            if matches!(name, "target_note_id" | "source_note_id") && !value.is_empty() {
                return value.to_string();
            }
        }
    }
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
        if matches!(pair[0], "item" | "explore") {
            return pair[1].to_string();
        }
    }
    parts.last().copied().unwrap_or("").to_string()
}

fn url_domain(raw_url: &str) -> String {
    raw_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(raw_url)
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

fn is_xiaohongshu_page_domain(domain: &str) -> bool {
    domain == "xiaohongshu.com"
        || domain.ends_with(".xiaohongshu.com")
        || domain == "xhslink.com"
        || domain.ends_with(".xhslink.com")
}

fn is_xiaohongshu_image_url(url: &str) -> bool {
    let domain = url_domain(url);
    domain == "xhscdn.com" || domain.ends_with(".xhscdn.com")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_note_id_from_discovery_url() {
        assert_eq!(
            extract_note_id("https://www.xiaohongshu.com/discovery/item/6a445a2d0000000007011c3d?source=webshare"),
            "6a445a2d0000000007011c3d"
        );
        assert_eq!(
            extract_note_id(
                "https://www.xiaohongshu.com/explore?target_note_id=6a41f69d00000000160252c9"
            ),
            "6a41f69d00000000160252c9"
        );
    }

    #[test]
    fn parses_initial_state_and_builds_original_image_url() {
        let html = r#"<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc":{"note":{"noteId":"abc","imageList":[{"fileId":"notes_pre_post/file","urlDefault":"http://sns-webpic-qc.xhscdn.com/path"}]}}}}};</script>"#;
        let state = parse_xiaohongshu_initial_state(html).expect("state");
        let image = &state["note"]["noteDetailMap"]["abc"]["note"]["imageList"][0];
        assert_eq!(
            xiaohongshu_original_image_url(image).as_deref(),
            Some("https://sns-img-qc.xhscdn.com/notes_pre_post/file")
        );
    }

    #[test]
    fn reproduces_current_xhs_xxtea_payload() {
        let decode_hex = |value: &str| {
            value
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| {
                    u8::from_str_radix(std::str::from_utf8(pair).expect("ASCII hex"), 16)
                        .expect("valid hex fixture")
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            xiaohongshu_xxtea_encrypt(&[1, 2, 3, 4, 5, 6, 7, 8]),
            [0xfd, 0x18, 0x93, 0xf5, 0x40, 0x01, 0x6c, 0xfd, 0xbe, 0xfe, 0xa6, 0x7e]
        );
        assert_eq!(
            xiaohongshu_custom_base64(b"abc", XIAOHONGSHU_MNS_BASE64_ALPHABET),
            "H0zd"
        );

        let plaintext = decode_hex(concat!(
            "79686029ffffffff9a53e8a39f010000714ce8a39f0100000100000043050000",
            "dc0000004bc2f85e657e1c913431393863616137363239627636366535713235",
            "62676933307661743435376c38386d6e72797563767635303030303233303132",
            "350a7868732d70632d776562018cf8516767c8b581625e0744fa841502613310",
            "8b96153b96a6cbf573e013996eda5c32"
        ));
        let ciphertext = decode_hex(concat!(
            "56b3eebe04ce290b6f4ff2ae78f270f249c1988039bc1d712cd71bb63c0de30d",
            "37a060917ed35fe6834adb58c8d69990d959b57f764de9e5bc7948dba4107aa0",
            "35b3ae8492de2c02451120030069b75ae4713d55ab79a2264e16bb5b665c7912",
            "5b273e0f4b4d6d1921a198602484f404646db8ddbc7ea3d4646fe3e6a32bc455",
            "ff110b26c4e909e5e76aeac293e2ee2556570388"
        ));
        assert_eq!(xiaohongshu_xxtea_encrypt(&plaintext), ciphertext);
        assert_eq!(
            xiaohongshu_masked_md5("b43d07a19a81e36e626959a14a1058ab", 0xff).expect("valid md5"),
            [
                0x4b, 0xc2, 0xf8, 0x5e, 0x65, 0x7e, 0x1c, 0x91, 0x9d, 0x96, 0xa6, 0x5e, 0xb5, 0xef,
                0xa7, 0x54,
            ]
        );
        assert_eq!(
            xiaohongshu_masked_md5("e975778a814d9fb705bf4aacc3e2d3eb", 0xff).expect("valid md5"),
            [
                0x16, 0x8a, 0x88, 0x75, 0x7e, 0xb2, 0x60, 0x48, 0xfa, 0x40, 0xb5, 0x53, 0x3c, 0x1d,
                0x2c, 0x14,
            ]
        );
    }
}
