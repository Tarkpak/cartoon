use super::media_parser::{self, ParsedMedia};
use super::*;
use axum::body::Body;
use std::io::Write;
use tokio::io::AsyncWriteExt;

pub(super) const HISTORY_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS media_parser_history (
    id TEXT PRIMARY KEY, item_key TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
    source_url TEXT NOT NULL, profile_json TEXT NOT NULL,
    downloaded_path TEXT, downloaded_filename TEXT, download_dir TEXT, size_bytes INTEGER,
    parsed_at TEXT NOT NULL, downloaded_at TEXT, updated_at TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS idx_media_parser_history_updated ON media_parser_history(updated_at);";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DownloadOptions {
    pub url: String,
    pub filename: Option<String>,
    pub image_index: Option<usize>,
    pub media_kind: Option<String>,
    pub media_index: Option<usize>,
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn profile(media: ParsedMedia) -> Value {
    let platform_name = text(&media.data, "platform");
    let platform = match platform_name.as_str() {
        "抖音" => "douyin",
        "小红书" => "xiaohongshu",
        "视频号" | "微信视频号" => "wxChannels",
        _ => "mediaParser",
    };
    let mut video_list = media
        .data
        .get("video_list")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|url| !url.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            if media.video_url.is_empty() {
                vec![]
            } else {
                vec![media.video_url.clone()]
            }
        });
    if !media.video_url.is_empty() && !video_list.contains(&media.video_url) {
        video_list.insert(0, media.video_url.clone());
    }
    let live_photos: Vec<Value> = media
        .data
        .get("image_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, image)| {
            let url = image
                .get("live_photo_url")
                .and_then(Value::as_str)
                .filter(|url| !url.is_empty())?;
            Some(json!({"imageIndex": index, "url": url, "coverUrl": image.get("url")}))
        })
        .collect();
    let media_type = if !media.video_url.is_empty() {
        "video"
    } else if !media.image_urls.is_empty() {
        "image"
    } else {
        "audio"
    };
    json!({
        "platform": platform, "platformName": platform_name, "mediaId": media.id,
        "title": media.title, "description": media.description, "sourceUrl": media.source_url,
        "coverUrl": media.cover_url, "videoUrl": media.video_url, "imageUrls": media.image_urls,
        "mediaType": media_type, "author": media.author, "authorIcon": media.author_icon,
        "videoUrls": video_list, "audioUrl": media.data.get("audio_url"), "livePhotos": live_photos,
        "subtitles": media.data.get("subtitles"), "isPreview": media.data.get("is_preview"),
        "fullDuration": media.data.get("full_duration")
    })
}

pub(super) fn ensure_history(conn: &Connection) -> Result<(), ApiError> {
    conn.execute_batch(HISTORY_SCHEMA)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    super::media_history_migration::migrate(conn)
}

fn save_history(
    state: &BackendState,
    profile: &mut Value,
    download: Option<&Value>,
) -> Result<String, ApiError> {
    let conn = db_connection(state)?;
    ensure_history(&conn)?;
    let media_id = text(profile, "mediaId");
    let key = format!(
        "{}:{}",
        text(profile, "platformName"),
        if media_id.is_empty() {
            text(profile, "sourceUrl")
        } else {
            media_id
        }
    );
    let id = conn
        .query_row(
            "SELECT id FROM media_parser_history WHERE item_key=?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .unwrap_or_else(|| format!("mp_{}", Uuid::new_v4().simple()));
    profile["historyId"] = json!(id);
    let now = now_iso();
    conn.execute("INSERT INTO media_parser_history
        (id,item_key,platform,source_url,profile_json,downloaded_path,downloaded_filename,download_dir,size_bytes,parsed_at,downloaded_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?10)
        ON CONFLICT(item_key) DO UPDATE SET source_url=excluded.source_url, profile_json=excluded.profile_json,
        downloaded_path=COALESCE(excluded.downloaded_path,media_parser_history.downloaded_path),
        downloaded_filename=COALESCE(excluded.downloaded_filename,media_parser_history.downloaded_filename),
        download_dir=COALESCE(excluded.download_dir,media_parser_history.download_dir),
        size_bytes=COALESCE(excluded.size_bytes,media_parser_history.size_bytes),
        downloaded_at=COALESCE(excluded.downloaded_at,media_parser_history.downloaded_at),updated_at=excluded.updated_at",
        params![id, key, text(profile,"platform"), text(profile,"sourceUrl"), profile.to_string(),
            download.map(|d| text(d,"path")), download.map(|d| text(d,"filename")), download.map(|d| text(d,"downloadDir")),
            download.and_then(|d| d.get("sizeBytes")).and_then(Value::as_i64), now, download.map(|_| now.clone())])
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(id)
}

pub(super) async fn parse(state: &BackendState, input: &str) -> Result<Value, ApiError> {
    let mut profile = profile(media_parser::parse(state, input).await?);
    save_history(state, &mut profile, None)?;
    Ok(profile)
}

pub(super) fn history(state: &BackendState) -> Result<Vec<Value>, ApiError> {
    let conn = db_connection(state)?;
    ensure_history(&conn)?;
    let mut stmt = conn.prepare("SELECT id,platform,source_url,profile_json,downloaded_path,downloaded_filename,download_dir,size_bytes,parsed_at,downloaded_at,updated_at FROM media_parser_history ORDER BY updated_at DESC LIMIT 200")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt.query_map([], |row| {
        let raw: String = row.get(3)?;
        Ok(json!({"id": row.get::<_,String>(0)?, "platform": row.get::<_,String>(1)?,
            "sourceUrl": row.get::<_,String>(2)?, "profile": serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null),
            "path": row.get::<_,Option<String>>(4)?.unwrap_or_default(), "filename": row.get::<_,Option<String>>(5)?.unwrap_or_default(),
            "downloadDir": row.get::<_,Option<String>>(6)?.unwrap_or_default(), "sizeBytes": row.get::<_,Option<i64>>(7)?.unwrap_or(0),
            "parsedAt": row.get::<_,String>(8)?, "downloadedAt": row.get::<_,Option<String>>(9)?, "updatedAt": row.get::<_,String>(10)?}))
    }).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) fn delete_history(
    state: &BackendState,
    platform: &str,
    id: &str,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    ensure_history(&conn)?;
    conn.execute(
        "DELETE FROM media_parser_history WHERE id=?1 AND platform=?2",
        params![id, platform],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn media_url(profile: &Value, kind: &str, index: usize) -> Option<String> {
    if kind == "audio" && index > 0 {
        return None;
    }
    let value = match kind {
        "video" => profile.get("videoUrls")?.get(index)?.as_str()?,
        "image" => profile.get("imageUrls")?.get(index)?.as_str()?,
        "livePhoto" => profile
            .get("livePhotos")?
            .get(index)?
            .get("url")?
            .as_str()?,
        "audio" => profile.get("audioUrl")?.as_str()?,
        _ => return None,
    };
    (!value.is_empty()).then(|| value.to_string())
}

fn client() -> Result<Client, ApiError> {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn request(
    client: &Client,
    url: &str,
    source_url: &str,
) -> Result<reqwest::RequestBuilder, ApiError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "解析结果包含无效媒体地址"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "解析结果包含无效媒体地址",
        ));
    }
    let source = reqwest::Url::parse(source_url).ok();
    let host = source.as_ref().and_then(|url| url.host_str()).unwrap_or("");
    let referer = if host == "xhslink.com" || host.ends_with(".xiaohongshu.com") {
        "https://www.xiaohongshu.com/".to_string()
    } else if host == "douyin.com"
        || host.ends_with(".douyin.com")
        || host.ends_with(".iesdouyin.com")
    {
        "https://www.douyin.com/".to_string()
    } else if host == "b23.tv" || host.ends_with(".bilibili.com") {
        "https://www.bilibili.com/".to_string()
    } else {
        source
            .map(|url| url.origin().ascii_serialization() + "/")
            .unwrap_or_default()
    };
    Ok(client.get(parsed).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36").header("Referer",referer))
}

async fn fetch(
    client: &Client,
    url: &str,
    source_url: &str,
) -> Result<reqwest::Response, ApiError> {
    let response = request(client, url, source_url)?
        .send()
        .await
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "请求媒体资源失败"))?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("媒体资源请求失败: HTTP {}", response.status()),
        ));
    }
    Ok(response)
}

fn extension(kind: &str, content_type: &str) -> &'static str {
    match content_type.split(';').next().unwrap_or("").trim() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/jpeg" => "jpg",
        "audio/mp4" => "m4a",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        _ => match kind {
            "image" => "jpg",
            "audio" => "mp3",
            _ => "mp4",
        },
    }
}

fn safe_filename(input: &str) -> String {
    let name: String = input
        .chars()
        .filter(|ch| !ch.is_control() && !"/\\:*?\"<>|".contains(*ch))
        .take(100)
        .collect();
    let name = name.trim().trim_matches('.');
    if name.is_empty() {
        "media".to_string()
    } else {
        name.to_string()
    }
}

fn subtitle_srt(subtitles: &[Value]) -> String {
    fn timestamp(seconds: f64) -> String {
        let ms = (seconds.max(0.0) * 1000.0).round() as u64;
        format!(
            "{:02}:{:02}:{:02},{:03}",
            ms / 3_600_000,
            ms / 60_000 % 60,
            ms / 1000 % 60,
            ms % 1000
        )
    }
    subtitles
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "{}\n{} --> {}\n{}\n\n",
                index + 1,
                timestamp(line.get("start").and_then(Value::as_f64).unwrap_or(0.0)),
                timestamp(line.get("end").and_then(Value::as_f64).unwrap_or(0.0)),
                text(line, "text")
            )
        })
        .collect()
}

pub(super) async fn download(
    state: &BackendState,
    options: DownloadOptions,
) -> Result<Value, ApiError> {
    let mut profile = profile(media_parser::parse(state, &options.url).await?);
    let kind = options.media_kind.as_deref().unwrap_or_else(|| {
        if options.image_index.is_some() {
            "image"
        } else {
            profile
                .get("mediaType")
                .and_then(Value::as_str)
                .unwrap_or("video")
        }
    });
    let index = options.image_index.or(options.media_index).unwrap_or(0);
    let source_url = text(&profile, "sourceUrl");
    let dir = state.data_dir.join("tools/media-download");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let name = safe_filename(
        options
            .filename
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| {
                profile
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("media")
            }),
    );
    let stem = format!("{}-{}", name, &Uuid::new_v4().simple().to_string()[..8]);
    let images = profile
        .get("imageUrls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let client = client()?;
    let path;
    if kind == "subtitles" {
        let lines = profile
            .get("subtitles")
            .and_then(Value::as_array)
            .filter(|lines| !lines.is_empty())
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "当前作品没有字幕"))?;
        path = dir.join(format!("{stem}.srt"));
        tokio::fs::write(&path, subtitle_srt(lines))
            .await
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    } else if kind == "image" && options.image_index.is_none() && options.media_index.is_none() {
        if images.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "当前作品没有图片"));
        }
        path = dir.join(format!("{stem}.zip"));
        let file = fs::File::create(&path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let mut zip = zip::ZipWriter::new(file);
        let result: Result<(), ApiError> = async {
            for (index, image) in images.iter().enumerate() {
                let url = image
                    .as_str()
                    .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "图片地址无效"))?;
                let response = fetch(&client, url, &source_url).await?;
                let ext = extension(
                    "image",
                    response
                        .headers()
                        .get("content-type")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or(""),
                );
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "读取图片失败"))?;
                zip.start_file(
                    format!("{:03}.{ext}", index + 1),
                    zip::write::SimpleFileOptions::default(),
                )
                .map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
                zip.write_all(&bytes).map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            }
            zip.finish().map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error);
        }
    } else {
        let url = media_url(&profile, kind, index)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "当前作品没有所选媒体资源"))?;
        let mut response = fetch(&client, &url, &source_url).await?;
        let ext = extension(
            kind,
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
        );
        path = dir.join(format!("{stem}.{ext}"));
        let result: Result<(), ApiError> = async {
            let mut file = tokio::fs::File::create(&path).await.map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
            while let Some(bytes) = response
                .chunk()
                .await
                .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "读取媒体资源失败"))?
            {
                file.write_all(&bytes).await.map_err(|error| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                })?;
            }
            file.flush().await.map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error);
        }
    }
    let mut result = json!({"path": path.to_string_lossy(), "filename": path.file_name().unwrap().to_string_lossy(),
        "downloadDir": dir.to_string_lossy(), "sizeBytes": fs::metadata(&path).map(|m|m.len()).unwrap_or(0),
        "imageIndex": options.image_index, "mediaKind": kind, "mediaIndex": index});
    save_history(state, &mut profile, Some(&result))?;
    result["profile"] = profile;
    Ok(result)
}

pub(super) async fn preview(
    state: &BackendState,
    query: HashMap<String, String>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    let url = query
        .get("url")
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "缺少媒体地址"))?;
    // Only proxy URLs returned by this engine and saved locally, never arbitrary user URLs.
    let source = history(state)?
        .into_iter()
        .find_map(|item| {
            let profile = item.get("profile")?;
            let matched = text(profile, "coverUrl") == *url
                || ["video", "image", "audio", "livePhoto"].iter().any(|kind| {
                    (0..1000)
                        .map_while(|index| media_url(profile, kind, index))
                        .any(|candidate| candidate == *url)
                });
            matched.then(|| text(profile, "sourceUrl"))
        })
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "媒体地址不在解析历史中，请重新解析",
            )
        })?;
    let client = client()?;
    let mut request = request(&client, url, &source)?;
    if let Some(range) = headers.get("range") {
        request = request.header("Range", range.clone());
    }
    let upstream = request
        .send()
        .await
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "请求媒体预览失败"))?;
    let status = upstream.status();
    if !status.is_success() && status != reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("媒体预览失败: HTTP {status}"),
        ));
    }
    let mut builder = axum::http::Response::builder().status(status.as_u16());
    for key in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
    ] {
        if let Some(value) = upstream.headers().get(key) {
            builder = builder.header(key, value);
        }
    }
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_xiaohongshu_video_and_extra_resources() {
        let media = ParsedMedia {
            data: json!({"platform":"小红书", "audio_url":"https://cdn/audio.mp3", "image_list":[{"url":"https://cdn/image.jpg","live_photo_url":"https://cdn/live.mp4"}], "subtitles":[{"start":0,"end":1,"text":"你好"}]}),
            id: "123".into(),
            source_url: "https://www.xiaohongshu.com/explore/123".into(),
            title: "标题".into(),
            description: "".into(),
            video_url: "https://cdn/video.mp4".into(),
            image_urls: vec!["https://cdn/image.jpg".into()],
            cover_url: "".into(),
            author: "".into(),
            author_icon: "".into(),
        };
        let profile = profile(media);
        assert_eq!(profile["mediaType"], "video");
        assert_eq!(profile["platform"], "xiaohongshu");
        assert_eq!(
            media_url(&profile, "livePhoto", 0).as_deref(),
            Some("https://cdn/live.mp4")
        );
        assert_eq!(
            media_url(&profile, "audio", 0).as_deref(),
            Some("https://cdn/audio.mp3")
        );
        assert!(media_url(&profile, "video", 2).is_none());
    }

    #[test]
    fn maps_video_channels_to_the_same_resource_contract() {
        let media = ParsedMedia {
            data: json!({"platform":"视频号","image_list":[],"audio_url":"https://cdn/audio.mp3"}),
            id: "123".into(),
            source_url: "https://weixin.qq.com/sph/123".into(),
            title: "视频号".into(),
            description: "正文".into(),
            video_url: "https://cdn/video.mp4".into(),
            image_urls: vec![],
            cover_url: "https://cdn/cover.jpg".into(),
            author: "作者".into(),
            author_icon: "".into(),
        };
        let result = profile(media);
        assert_eq!(result["platform"], "wxChannels");
        assert_eq!(result["platformName"], "视频号");
        assert_eq!(result["mediaType"], "video");
        assert_eq!(
            media_url(&result, "video", 0).as_deref(),
            Some("https://cdn/video.mp4")
        );
        assert_eq!(
            media_url(&result, "audio", 0).as_deref(),
            Some("https://cdn/audio.mp3")
        );
    }

    #[test]
    fn history_updates_preserve_download_and_keep_platforms_separate() {
        let dir = std::env::temp_dir().join(format!("media-history-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let state = BackendState {
            db_path: dir.join("test.db"),
            data_dir: dir.clone(),
            public_dir: dir.clone(),
            web_dir: dir.clone(),
        };
        let mut first = json!({"platform":"xiaohongshu","platformName":"小红书","mediaId":"123","sourceUrl":"https://xhslink.com/example","videoUrl":"https://cdn/video.mp4","mediaType":"video"});
        let download = json!({"path":"/downloads/video.mp4","filename":"video.mp4","downloadDir":"/downloads","sizeBytes":123});
        let first_id = save_history(&state, &mut first, Some(&download)).unwrap();
        first["title"] = json!("更新标题");
        assert_eq!(save_history(&state, &mut first, None).unwrap(), first_id);
        let mut other = json!({"platform":"douyin","platformName":"抖音","mediaId":"123","sourceUrl":"https://v.douyin.com/example"});
        save_history(&state, &mut other, None).unwrap();
        let entries = history(&state).unwrap();
        assert_eq!(entries.len(), 2);
        let saved = entries
            .iter()
            .find(|entry| entry["id"] == first_id)
            .unwrap();
        assert_eq!(saved["path"], "/downloads/video.mp4");
        assert_eq!(saved["profile"]["title"], "更新标题");
        delete_history(&state, "douyin", &first_id).unwrap();
        assert_eq!(history(&state).unwrap().len(), 2);
        delete_history(&state, "xiaohongshu", &first_id).unwrap();
        assert_eq!(history(&state).unwrap().len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn downloads_and_previews_embedded_results_without_external_services() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new()
            .route(
                "/video",
                axum::routing::get(|| async { ([("content-type", "video/mp4")], "video-bytes") }),
            )
            .route(
                "/image",
                axum::routing::get(|| async { ([("content-type", "image/png")], "image-bytes") }),
            )
            .route(
                "/audio",
                axum::routing::get(|| async { ([("content-type", "audio/mpeg")], "audio-bytes") }),
            );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let dir = std::env::temp_dir().join(format!("media-download-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let response = json!({"succ":true,"retcode":200,"data":{
            "platform":"小红书","video_id":"fixture","title":"测试","video_url":format!("{base}/video"),
            "image_list":[{"url":format!("{base}/image"),"live_photo_url":format!("{base}/video")}],
            "audio_url":format!("{base}/audio"),"subtitles":[{"start":0,"end":1,"text":"字幕"}]
        }});
        *media_parser::TEST_RESPONSE.lock().unwrap() = Some(response);
        let state = BackendState {
            db_path: dir.join("test.db"),
            data_dir: dir.clone(),
            public_dir: dir.clone(),
            web_dir: dir.clone(),
        };
        for (kind, expected_extension, expected_bytes) in [
            ("video", "mp4", "video-bytes"),
            ("audio", "mp3", "audio-bytes"),
            ("livePhoto", "mp4", "video-bytes"),
            (
                "subtitles",
                "srt",
                "1\n00:00:00,000 --> 00:00:01,000\n字幕\n\n",
            ),
            ("image", "zip", ""),
        ] {
            let result = download(
                &state,
                DownloadOptions {
                    url: "https://www.xiaohongshu.com/explore/fixture".into(),
                    filename: None,
                    image_index: None,
                    media_kind: Some(kind.into()),
                    media_index: None,
                },
            )
            .await
            .unwrap();
            assert_eq!(result["profile"]["mediaType"], "video");
            let path = PathBuf::from(result["path"].as_str().unwrap());
            assert_eq!(path.extension().unwrap(), expected_extension);
            if kind == "image" {
                let mut zip = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
                assert_eq!(zip.len(), 1);
                let mut bytes = String::new();
                std::io::Read::read_to_string(&mut zip.by_index(0).unwrap(), &mut bytes).unwrap();
                assert_eq!(bytes, "image-bytes");
            } else {
                assert_eq!(fs::read_to_string(path).unwrap(), expected_bytes);
            }
        }
        let query = HashMap::from([("url".to_string(), format!("{base}/video"))]);
        let response = preview(&state, query, axum::http::HeaderMap::new())
            .await
            .unwrap();
        assert_eq!(response.headers().get("content-type").unwrap(), "video/mp4");
        assert_eq!(
            &axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap()[..],
            b"video-bytes"
        );
        let query = HashMap::from([("url".to_string(), format!("{base}/not-in-history"))]);
        assert!(preview(&state, query, axum::http::HeaderMap::new())
            .await
            .is_err());
        assert!(download(
            &state,
            DownloadOptions {
                url: "https://www.xiaohongshu.com/explore/fixture".into(),
                filename: None,
                image_index: Some(99),
                media_kind: None,
                media_index: None
            }
        )
        .await
        .is_err());
        *media_parser::TEST_RESPONSE.lock().unwrap() = None;
        server.abort();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exports_subtitles_and_sanitizes_paths() {
        assert_eq!(
            subtitle_srt(&[json!({"start":0.64,"end":62.12,"text":"字幕"})]),
            "1\n00:00:00,640 --> 00:01:02,120\n字幕\n\n"
        );
        assert!(!safe_filename("../../test\\file").contains('/'));
        assert_eq!(safe_filename("..."), "media");
    }
}
