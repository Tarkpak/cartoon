use super::*;
use std::fs::File;

const XIAOHONGSHU_DOWNLOAD_DIR: &str = "tools/xiaohongshu-download";
const XIAOHONGSHU_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

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
    backend_state: &BackendState,
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
        let fetcher = backend_state
            .xiaohongshu_dynamic_fetcher
            .as_ref()
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "该笔记需要小红书页面动态加载，请使用桌面客户端解析",
                )
            })?;
        let payload = fetcher(final_url.clone(), note_id_from_url.clone())
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    format!("动态加载小红书笔记失败: {error}"),
                )
            })?;
        dynamic_note = extract_dynamic_note(&payload).ok_or_else(|| {
            ApiError::new(StatusCode::BAD_GATEWAY, "小红书动态接口未返回笔记详情")
        })?;
        &dynamic_note
    } else {
        initial_note
    };

    xiaohongshu_profile_from_note(note, note_id_from_url, final_url)
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
    Client::builder()
        .timeout(timeout)
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
}
