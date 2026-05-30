use super::*;
use ve_tos_rust_sdk::object::{ListObjectsType2Input, ObjectAPI};
use ve_tos_rust_sdk::tos;

async fn resolve_source_bytes(
    state: &BackendState,
    source: &str,
    max_bytes: usize,
) -> Result<(Vec<u8>, Option<String>), ApiError> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "资源内容不能为空"));
    }

    if let Some((mime, bytes)) = parse_data_url(trimmed) {
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, Some(mime)));
    }

    if is_http_url(trimmed) {
        let response = http_client()
            .get(trimmed)
            .send()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
        if !response.status().is_success() {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("下载资源失败: {}", response.status()),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }

        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase()
            })
            .filter(|value| !value.is_empty());
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
            .to_vec();
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, mime));
    }

    if let Some(path) = resolve_api_file_path(
        trimmed,
        "/api/image/file/",
        &state.public_dir.join("generated-images"),
    ) {
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "图片文件不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }
    if let Some(path) = resolve_api_file_path(
        trimmed,
        "/api/video/file/",
        &state.public_dir.join("videos"),
    ) {
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "媒体文件不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }
    if let Some(rest) = trimmed.strip_prefix("/generated-images/") {
        if let Some(safe) = sanitize_rel_path(rest) {
            if !safe.contains('/') {
                let path = state.public_dir.join("generated-images").join(safe);
                let bytes = fs::read(&path)
                    .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "图片文件不存在"))?;
                return Ok((
                    bytes,
                    Some(
                        path_content_type(&path)
                            .split(';')
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    ),
                ));
            }
        }
    }
    if let Some(rest) = trimmed.strip_prefix("/videos/") {
        if let Some(safe) = sanitize_rel_path(rest) {
            if !safe.contains('/') {
                let path = state.public_dir.join("videos").join(safe);
                let bytes = fs::read(&path)
                    .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "视频文件不存在"))?;
                return Ok((
                    bytes,
                    Some(
                        path_content_type(&path)
                            .split(';')
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    ),
                ));
            }
        }
    }
    if trimmed.starts_with('/') {
        let safe = sanitize_rel_path(trimmed)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "无效本地资源路径"))?;
        let path = state.public_dir.join(safe);
        let bytes =
            fs::read(&path).map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "本地资源不存在"))?;
        return Ok((
            bytes,
            Some(
                path_content_type(&path)
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            ),
        ));
    }

    if let Some(bytes) = decode_base64_bytes(trimmed) {
        if bytes.len() > max_bytes {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "资源体积超过上限",
            ));
        }
        return Ok((bytes, None));
    }

    Err(ApiError::new(StatusCode::BAD_REQUEST, "不支持的资源格式"))
}

async fn persist_image_source(
    state: &BackendState,
    source: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    let (bytes, mime) = resolve_source_bytes(state, source, 35 * 1024 * 1024).await?;
    persist_image_bytes(state, prefix, mime.as_deref(), "png", &bytes)
}

async fn persist_video_source(
    state: &BackendState,
    source: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    let (bytes, mime) = resolve_source_bytes(state, source, 250 * 1024 * 1024).await?;
    persist_video_bytes(state, prefix, mime.as_deref(), "mp4", &bytes)
}

fn extract_scene_split_lines(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = normalized
        .split('\n')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return vec![];
    }

    if lines.len() == 1 {
        let one = lines.remove(0);
        let chunks = one
            .split(['。', '！', '？', ';', '；'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !chunks.is_empty() {
            return chunks;
        }
        return vec![one];
    }

    lines
}

fn extract_character_names(text: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some((speaker, _content)) = trimmed.split_once('：') {
            let candidate = speaker.trim();
            if !candidate.is_empty()
                && candidate.chars().count() <= 8
                && !names.iter().any(|item| item == candidate)
            {
                names.push(candidate.to_string());
            }
        }
        if names.len() >= 8 {
            break;
        }
    }
    names
}

fn build_episode_plan_from_text(text: &str) -> Vec<Value> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let char_count = normalized.chars().count();
    if char_count == 0 {
        return vec![];
    }

    let target_episode_chars = 2600usize;
    let mut episode_count = (char_count as f64 / target_episode_chars as f64).ceil() as usize;
    episode_count = episode_count.clamp(1, 12);
    let step = (char_count as f64 / episode_count as f64).ceil() as usize;
    let chars: Vec<char> = normalized.chars().collect();

    let mut episodes: Vec<Value> = Vec::new();
    let mut cursor = 0usize;
    for index in 0..episode_count {
        if cursor >= chars.len() {
            break;
        }
        let end = if index + 1 == episode_count {
            chars.len()
        } else {
            (cursor + step).min(chars.len())
        };
        let snippet: String = chars[cursor..end].iter().collect();
        episodes.push(json!({
          "id": format!("episode_{:03}", index + 1),
          "title": format!("第{}集", index + 1),
          "index": index + 1,
          "startOffset": cursor,
          "endOffset": end,
          "charCount": end.saturating_sub(cursor),
          "episodeHook": format!("围绕本段剧情推进冲突与反转（{}字）", snippet.chars().count())
        }));
        cursor = end;
    }

    episodes
}

fn build_parsed_script_payload(body: &Value) -> Value {
    let raw_text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let parse_mode = json_string(body.get("scriptParseMode"), "short_drama");
    let style = json_string(body.get("style"), "默认画风");
    let lines = extract_scene_split_lines(raw_text);
    let episode_plan = body
        .get("episodePlan")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_episode_plan = !episode_plan.is_empty();
    let scenes_per_episode = if has_episode_plan {
        ((lines.len() as f64) / (episode_plan.len() as f64))
            .ceil()
            .max(1.0) as usize
    } else {
        4usize
    };
    let characters = extract_character_names(raw_text);

    let scenes = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let episode_index = if has_episode_plan {
                (index / scenes_per_episode).min(episode_plan.len().saturating_sub(1))
            } else {
                0
            };
            let episode_meta = episode_plan.get(episode_index);
            let episode_id = episode_meta
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("episode_001");
            let episode_title = episode_meta
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("第1集");
            let episode_number = episode_meta
                .and_then(|item| item.get("index"))
                .and_then(Value::as_i64)
                .unwrap_or(1);
            let duration = 8i64;
            json!({
              "id": format!("scene_{:03}", index + 1),
              "episodeId": episode_id,
              "episodeTitle": episode_title,
              "episodeIndex": episode_number,
              "title": format!("场景 {}", index + 1),
              "description": format!("0-{}秒：中景，固定镜头。{}", duration, line.trim()),
              "characters": characters.iter().take(3).map(|name| json!({"name": name})).collect::<Vec<_>>(),
              "dialogues": [],
              "narration": Value::Null,
              "duration": duration,
              "setting": {
                "location": "未指定场景",
                "timeOfDay": "day"
              }
            })
        })
        .collect::<Vec<_>>();

    let formatted_lines = scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let title = scene.get("title").and_then(Value::as_str).unwrap_or("场景");
            let desc = scene
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("暂无描述");
            format!("场景 {} - {}: {}", index + 1, title, desc)
        })
        .collect::<Vec<_>>();

    json!({
      "success": true,
      "data": {
        "title": format!("{}脚本", style),
        "scenes": scenes,
        "characters": characters.into_iter().map(|name| json!({"name": name, "role": "supporting"})).collect::<Vec<_>>()
      },
      "formattedTimeline": {
        "lines": formatted_lines,
        "text": formatted_lines.join("\n")
      },
      "parseStrategy": {
        "segmented": has_episode_plan && episode_plan.len() > 1,
        "chunkCount": if has_episode_plan { episode_plan.len() } else { 1 },
        "episodeCount": if has_episode_plan { episode_plan.len() } else { 1 },
        "recommendedMinScenes": scenes_per_episode.max(1),
        "scriptParseMode": parse_mode
      }
    })
}

pub(super) async fn api_test(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let prompt = query
        .get("prompt")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if prompt.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请通过 query 参数传入 prompt，例如 /api/test?prompt=hello",
        ));
    }

    Ok(Json(json!({
      "success": true,
      "message": "Rust API 连接成功",
      "response": format!("Echo: {}", prompt),
      "model": "rust-local",
      "latencyMs": 1,
      "timestamp": now_iso()
    })))
}

fn infer_model_provider(model_id: &str) -> String {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return "rust_local".to_string();
    }
    if normalized.contains("qwen") || normalized.contains("wan") {
        return "qwen".to_string();
    }
    if normalized.contains("doubao") || normalized.contains("seed") {
        return "volcengine".to_string();
    }
    if normalized.contains("deepseek") {
        return "deepseek".to_string();
    }
    if normalized.contains("gemini") {
        return "gemini".to_string();
    }
    if normalized.contains("kling") {
        return "kling".to_string();
    }
    if normalized.contains("gpt") || normalized.contains("openai") {
        return "custom_openai".to_string();
    }
    "rust_local".to_string()
}

fn model_type_to_operation(model_type: &str) -> &'static str {
    match model_type {
        "text" => "generateText",
        "image" => "generateImage",
        "video" => "generateVideo",
        "tts" => "textToSpeech",
        "asr" => "speechToText",
        _ => "generateText",
    }
}

fn collect_log_media_refs(result: &Value) -> Value {
    let mut refs: Vec<Value> = Vec::new();

    if let Some(image_url) = result.get("imageUrl").and_then(Value::as_str) {
        refs.push(json!({
          "id": format!("media_{}", refs.len() + 1),
          "direction": "response",
          "path": "$.result.imageUrl",
          "mediaType": "image",
          "originalLength": image_url.len(),
          "url": image_url,
          "status": "ready"
        }));
    }
    if let Some(video_url) = result.get("videoUrl").and_then(Value::as_str) {
        refs.push(json!({
          "id": format!("media_{}", refs.len() + 1),
          "direction": "response",
          "path": "$.result.videoUrl",
          "mediaType": "video",
          "originalLength": video_url.len(),
          "url": video_url,
          "status": "ready"
        }));
    }
    if let Some(audio_url) = result.get("audioUrl").and_then(Value::as_str) {
        if !audio_url.trim().is_empty() {
            refs.push(json!({
              "id": format!("media_{}", refs.len() + 1),
              "direction": "response",
              "path": "$.result.audioUrl",
              "mediaType": "audio",
              "originalLength": audio_url.len(),
              "url": audio_url,
              "status": "ready"
            }));
        }
    }

    Value::Array(refs)
}

fn write_model_debug_log(
    state: &BackendState,
    provider: &str,
    model: &str,
    operation: &str,
    status: &str,
    duration_ms: i64,
    request: &Value,
    response: Option<&Value>,
    error: Option<&Value>,
) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    let now = now_iso();
    let response_value = response.cloned().unwrap_or(Value::Null);
    let media_refs = collect_log_media_refs(&response_value);
    conn.execute(
        "INSERT INTO model_debug_logs (
          id, timestamp, provider, model, operation, status, duration_ms,
          request_json, request_raw_json, response_json, response_raw_json,
          media_refs_json, error_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            format!("log_{}", Uuid::new_v4().simple()),
            now,
            provider,
            model,
            operation,
            status,
            duration_ms.max(1),
            request.to_string(),
            request.to_string(),
            if response.is_some() {
                Some(response_value.to_string())
            } else {
                None::<String>
            },
            if response.is_some() {
                Some(response_value.to_string())
            } else {
                None::<String>
            },
            if media_refs.as_array().is_some_and(|items| !items.is_empty()) {
                Some(media_refs.to_string())
            } else {
                None::<String>
            },
            error.map(Value::to_string),
            now_iso()
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

pub(super) async fn api_models_test(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let start = Utc::now().timestamp_millis();
    let model_type = json_string(body.get("modelType"), "text");
    let model_id = json_string(body.get("modelId"), "rust-local-model");
    let prompt = json_string(body.get("prompt"), "");
    let provider = infer_model_provider(&model_id);
    let operation = model_type_to_operation(&model_type);
    let request_payload = body.clone();

    if prompt.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请在请求体中提供 prompt",
        ));
    }

    let result = match model_type.as_str() {
        "text" => json!(format!("【Rust 本地测试输出】{}", prompt)),
        "image" => {
            let image_url = persist_image_bytes(
                &state,
                "model_test_image",
                Some("image/png"),
                "png",
                PLACEHOLDER_IMAGE_BYTES,
            )?;
            json!({
              "imageUrl": image_url,
              "hasImageData": false,
              "mimeType": "image/png"
            })
        }
        "video" => {
            let aspect_ratio = json_string(body.get("imageAspectRatio"), "16:9");
            let video_url = persist_video_bytes(
                &state,
                "model_test_video",
                Some("video/mp4"),
                "mp4",
                placeholder_video_bytes(&aspect_ratio),
            )?;
            json!({
              "videoUrl": video_url,
              "taskId": format!("test_{}", Uuid::new_v4().simple())
            })
        }
        "tts" => json!({
          "hasAudioData": false,
          "audioUrl": Value::Null,
          "audioMimeType": "audio/mpeg"
        }),
        _ => {
            let error_payload = json!({ "message": format!("不支持的模型类型: {}", model_type) });
            let _ = write_model_debug_log(
                &state,
                &provider,
                &model_id,
                operation,
                "error",
                (Utc::now().timestamp_millis() - start).max(1),
                &request_payload,
                None,
                Some(&error_payload),
            );
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("不支持的模型类型: {}", model_type),
            ))
        }
    };

    let latency_ms = (Utc::now().timestamp_millis() - start).max(1);
    let response_result = json!({
      "modelType": model_type,
      "modelId": model_id,
      "provider": provider,
      "displayName": "Rust Local Stub",
      "result": result,
      "latencyMs": latency_ms
    });

    let _ = write_model_debug_log(
        &state,
        response_result
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("rust_local"),
        response_result
            .get("modelId")
            .and_then(Value::as_str)
            .unwrap_or("rust-local-model"),
        operation,
        "success",
        latency_ms,
        &request_payload,
        response_result.get("result"),
        None,
    );

    Ok(Json(json!({
      "success": true,
      "data": {
        "modelType": response_result["modelType"],
        "modelId": response_result["modelId"],
        "provider": response_result["provider"],
        "displayName": response_result["displayName"],
        "result": response_result["result"],
        "latencyMs": response_result["latencyMs"]
      }
    })))
}

pub(super) async fn api_script_episode_plan(
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if text.is_empty() {
        return Ok(Json(json!({
          "success": true,
          "data": { "episodes": [] }
        })));
    }

    Ok(Json(json!({
      "success": true,
      "data": {
        "episodes": build_episode_plan_from_text(text)
      }
    })))
}

pub(super) async fn api_script_parse(Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    Ok(Json(build_parsed_script_payload(&body)))
}

pub(super) async fn api_script_parse_stream(Json(body): Json<Value>) -> Result<Response, ApiError> {
    let parsed = build_parsed_script_payload(&body);
    let lines = vec![
        json!({
          "type": "progress",
          "payload": {
            "step": "accepted",
            "message": "已接收解析请求，准备开始",
            "progress": 1
          },
          "timestamp": now_iso()
        }),
        json!({
          "type": "progress",
          "payload": {
            "step": "parsing",
            "message": "正在解析文本结构",
            "progress": 72
          },
          "timestamp": now_iso()
        }),
        json!({
          "type": "result",
          "payload": parsed,
          "timestamp": now_iso()
        }),
    ];
    Ok(json_lines_response(lines))
}

fn xml_escape_text(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn build_minimal_docx_bytes(title: &str, lines: &[String]) -> Result<Vec<u8>, ApiError> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
    writer
        .start_file("[Content_Types].xml", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(content_types.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
    writer
        .start_file("_rels/.rels", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(rels.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut document_xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>"#,
    );
    let title_line = xml_escape_text(title);
    document_xml.push_str(&format!("<w:p><w:r><w:t>{}</w:t></w:r></w:p>", title_line));
    for line in lines {
        let escaped = xml_escape_text(line);
        document_xml.push_str(&format!(
            "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escaped
        ));
    }
    document_xml.push_str(
        r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#,
    );

    writer
        .start_file("word/document.xml", options)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    writer
        .write_all(document_xml.as_bytes())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let cursor = writer
        .finish()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(cursor.into_inner())
}

pub(super) async fn api_script_export_docx(Json(body): Json<Value>) -> Result<Response, ApiError> {
    let project_name = json_string(body.get("projectName"), "剧本检视稿");
    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if scenes.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有可导出的场景"));
    }

    let mut lines: Vec<String> = Vec::new();
    for (index, scene) in scenes.iter().enumerate() {
        let title = json_string(scene.get("title"), &format!("场景 {}", index + 1));
        let description = json_string(scene.get("description"), "");
        let duration = scene.get("duration").and_then(Value::as_f64).unwrap_or(8.0);
        lines.push(format!("场景 {}：{}（{} 秒）", index + 1, title, duration));
        if !description.is_empty() {
            lines.push(format!("  描述：{}", description));
        }
        if let Some(narration) = scene.get("narration").and_then(Value::as_str) {
            if !narration.trim().is_empty() {
                lines.push(format!("  旁白：{}", narration.trim()));
            }
        }
    }

    let bytes = build_minimal_docx_bytes(&format!("{} - 格式化剧本", project_name), &lines)?;
    let file_name = format!(
        "{}-格式化剧本-{}.docx",
        sanitize_file_component(&project_name),
        Utc::now().format("%Y-%m-%d")
    );
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename*=UTF-8''{}", file_name))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        bytes,
    )
        .into_response())
}

pub(super) async fn api_asset_upload_image(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let image_data = body
        .get("imageData")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "图片内容不能为空"))?;
    let prefix = json_string(body.get("prefix"), "asset_upload");
    let image_url = persist_image_source(&state, image_data, &prefix).await?;
    Ok(Json(json!({
      "success": true,
      "imageUrl": image_url
    })))
}

pub(super) async fn api_character_voice_upload(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let audio_data = body
        .get("audioData")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "音频内容不能为空"))?;
    let prefix = json_string(body.get("prefix"), "character_voice_upload");
    let audio_url = persist_video_source(&state, audio_data, &prefix).await?;
    Ok(Json(json!({
      "success": true,
      "audioUrl": audio_url
    })))
}

pub(super) async fn api_character_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let character = body.get("character").cloned().unwrap_or_else(|| json!({}));
    let character_id = json_string(
        character.get("id"),
        &format!("char_{}", Uuid::new_v4().simple()),
    );
    let character_name = json_string(character.get("name"), "角色");
    let image_url = persist_image_bytes(
        &state,
        &format!("char_{}", character_id),
        Some("image/png"),
        "png",
        PLACEHOLDER_IMAGE_BYTES,
    )?;

    let now = now_iso();
    Ok(Json(json!({
      "success": true,
      "asset": {
        "characterId": character_id,
        "name": character_name,
        "baseImage": image_url,
        "expressions": {},
        "sheetType": "full",
        "createdAt": now,
        "updatedAt": now
      },
      "sheetType": "character-sheet",
      "latencyMs": 1
    })))
}

pub(super) async fn api_asset_prop_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let prop = body.get("prop").cloned().unwrap_or_else(|| json!({}));
    let prop_id = json_string(prop.get("id"), &format!("prop_{}", Uuid::new_v4().simple()));
    let image_url = persist_image_bytes(
        &state,
        &format!("prop_{}", prop_id),
        Some("image/png"),
        "png",
        PLACEHOLDER_IMAGE_BYTES,
    )?;
    Ok(Json(json!({
      "success": true,
      "imageUrl": image_url,
      "latencyMs": 1,
      "usage": {
        "modelId": "rust-local-image",
        "modelProvider": "rust_local"
      }
    })))
}

pub(super) async fn api_asset_reference_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let scene_id = body
        .get("scene")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("scene");
    let image_url = persist_image_bytes(
        &state,
        &format!("env_{}", scene_id),
        Some("image/png"),
        "png",
        PLACEHOLDER_IMAGE_BYTES,
    )?;
    Ok(Json(json!({
      "success": true,
      "referenceImage": image_url,
      "mimeType": "image/png",
      "latencyMs": 1,
      "usage": {
        "modelId": "rust-local-image",
        "modelDecision": "rust-local-placeholder",
        "referenceImageUsed": body.get("regeneration").is_some()
      }
    })))
}

pub(super) async fn api_asset_scene_description_refinement(
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let scene = body.get("scene").cloned().unwrap_or_else(|| json!({}));
    let user_message = json_string(body.get("userMessage"), "保持原意进行精炼");
    let original_description = json_string(scene.get("description"), "");
    let refined = if original_description.is_empty() {
        format!("0-8秒：中景，固定镜头。{}", user_message)
    } else {
        format!("{}\n\n镜头优化说明：{}", original_description, user_message)
    };

    Ok(Json(json!({
      "success": true,
      "data": {
        "description": refined
      }
    })))
}

pub(super) async fn api_asset_video_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let scene = body.get("scene").cloned().unwrap_or_else(|| json!({}));
    let scene_id = json_string(
        scene.get("id"),
        &format!("scene_{}", Uuid::new_v4().simple()),
    );
    let aspect_ratio = json_string(body.get("aspectRatio"), "16:9");
    let task_id = format!("video_{}", Uuid::new_v4().simple());
    let video_url = persist_video_bytes(
        &state,
        &format!("scene_{}", scene_id),
        Some("video/mp4"),
        "mp4",
        placeholder_video_bytes(&aspect_ratio),
    )?;

    let conn = db_connection(&state)?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO video_tasks (id, scene_id, status, progress, config, video_data, metadata, created_at, updated_at)
         VALUES (?1, ?2, 'completed', 100, ?3, ?4, ?5, ?6, ?7)",
        params![
            task_id,
            scene_id,
            body.to_string(),
            video_url,
            json!({"aspectRatio": aspect_ratio, "provider": "rust_local"}).to_string(),
            now,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "taskId": task_id,
      "latencyMs": 1
    })))
}

pub(super) async fn api_video_generate(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let scene_id = json_string(
        body.get("sceneId"),
        &format!("scene_{}", Uuid::new_v4().simple()),
    );
    let config = body.get("config").cloned().unwrap_or_else(|| json!({}));
    let aspect_ratio = json_string(config.get("aspectRatio"), "16:9");
    let task_id = format!("video_{}", Uuid::new_v4().simple());
    let video_url = persist_video_bytes(
        &state,
        &format!("video_{}", scene_id),
        Some("video/mp4"),
        "mp4",
        placeholder_video_bytes(&aspect_ratio),
    )?;

    let conn = db_connection(&state)?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO video_tasks (id, scene_id, status, progress, config, video_data, metadata, created_at, updated_at)
         VALUES (?1, ?2, 'completed', 100, ?3, ?4, ?5, ?6, ?7)",
        params![
            task_id,
            scene_id,
            config.to_string(),
            video_url,
            json!({"aspectRatio": aspect_ratio, "provider": "rust_local"}).to_string(),
            now,
            now
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(Json(json!({
      "success": true,
      "taskId": task_id,
      "message": "视频生成任务已启动（Rust本地占位）",
      "latencyMs": 1
    })))
}

pub(super) async fn api_video_status(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let row: Option<(String, Option<String>, String, i64, Option<String>, Option<String>, String, String, Option<String>)> = conn
        .query_row(
            "SELECT id, scene_id, status, progress, error, video_data, created_at, updated_at, metadata
             FROM video_tasks WHERE id = ?1 LIMIT 1",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?
                ))
            },
        )
        .optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let (task_id, scene_id, status, progress, error, video_data, created_at, updated_at, metadata) =
        row.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, format!("未找到任务: {}", id)))?;
    let parsed_metadata = metadata
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({}));

    Ok(Json(json!({
      "success": true,
      "task": {
        "id": task_id,
        "sceneId": scene_id,
        "status": status,
        "progress": progress,
        "error": error,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "result": if video_data.as_ref().is_some_and(|value| !value.trim().is_empty()) {
          json!({
            "id": format!("generated_{}", id),
            "sceneId": scene_id,
            "videoData": video_data,
            "metadata": parsed_metadata,
            "createdAt": created_at
          })
        } else {
          Value::Null
        }
      }
    })))
}

fn resolve_video_source_path(state: &BackendState, raw: &str) -> Option<PathBuf> {
    if let Some(path) =
        resolve_api_file_path(raw, "/api/video/file/", &state.public_dir.join("videos"))
    {
        return Some(path);
    }
    if let Some(path) = resolve_api_file_path(raw, "/videos/", &state.public_dir.join("videos")) {
        return Some(path);
    }
    if raw.starts_with('/') {
        let safe = sanitize_rel_path(raw)?;
        return Some(state.public_dir.join(safe));
    }
    None
}

pub(super) async fn api_video_merge(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let project_id = json_string(body.get("projectId"), "project");
    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if scenes.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "没有有效的视频片段"));
    }

    let mut first_video_bytes: Option<Vec<u8>> = None;
    for scene in &scenes {
        let video_url = scene
            .get("videoUrl")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if video_url.is_empty() {
            continue;
        }

        if let Some(path) = resolve_video_source_path(&state, video_url) {
            if let Ok(bytes) = fs::read(&path) {
                first_video_bytes = Some(bytes);
                break;
            }
        } else if video_url.starts_with("data:video/") {
            if let Some((_mime, bytes)) = parse_data_url(video_url) {
                first_video_bytes = Some(bytes);
                break;
            }
        } else if is_http_url(video_url) {
            if let Ok((bytes, _mime)) =
                resolve_source_bytes(&state, video_url, 250 * 1024 * 1024).await
            {
                first_video_bytes = Some(bytes);
                break;
            }
        }
    }

    let bytes = first_video_bytes.unwrap_or_else(|| PLACEHOLDER_VIDEO_16X9_BYTES.to_vec());
    let final_url = persist_video_bytes(
        &state,
        &format!("{}_final", project_id),
        Some("video/mp4"),
        "mp4",
        &bytes,
    )?;
    let duration = scenes
        .iter()
        .map(|item| item.get("duration").and_then(Value::as_f64).unwrap_or(0.0))
        .sum::<f64>()
        .max(2.0);

    Ok(Json(json!({
      "success": true,
      "data": {
        "videoUrl": final_url,
        "duration": duration,
        "size": bytes.len(),
        "sceneCount": scenes.len()
      },
      "latencyMs": 1
    })))
}

fn build_jianying_manifest(body: &Value) -> Value {
    let project_name = json_string(body.get("projectName"), "项目");
    let aspect_ratio = json_string(body.get("aspectRatio"), "16:9");
    let scenes = body
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
      "format": "asset-workbench-jianying-project",
      "generatedAt": now_iso(),
      "projectName": project_name,
      "aspectRatio": aspect_ratio,
      "sceneCount": scenes.len(),
      "scenes": scenes
    })
}

fn build_zip_bytes(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, ApiError> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, bytes) in files {
        writer
            .start_file(path, options)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        writer
            .write_all(&bytes)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let cursor = writer
        .finish()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(cursor.into_inner())
}

pub(super) async fn api_video_export_jianying(
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let project_name = json_string(body.get("projectName"), "项目");
    let manifest = build_jianying_manifest(&body);
    let archive_root = sanitize_file_component(&project_name);
    let readme = format!(
        "该压缩包由 Rust 本地后端生成。\n项目名：{}\n生成时间：{}\n",
        project_name,
        now_iso()
    );
    let zip_bytes = build_zip_bytes(vec![
        (
            format!("{}/asset-workbench-manifest.json", archive_root),
            serde_json::to_vec_pretty(&manifest).map_err(|error| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            })?,
        ),
        (format!("{}/README.txt", archive_root), readme.into_bytes()),
    ])?;
    let file_name = format!(
        "{}-剪映工程-{}.zip",
        sanitize_file_component(&project_name),
        Utc::now().format("%Y-%m-%d")
    );
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/zip"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename*=UTF-8''{}", file_name))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        zip_bytes,
    )
        .into_response())
}

#[derive(Clone, Debug)]
struct TosStorageConfig {
    enabled: bool,
    access_key_id: String,
    access_key_secret: String,
    security_token: Option<String>,
    region: String,
    endpoint: String,
    endpoint_protocol: String,
    bucket: String,
    key_prefix: Option<String>,
    public_base_url: Option<String>,
    is_custom_domain: bool,
}

fn parse_bool_env(key: &str) -> Option<bool> {
    let value = std::env::var(key).ok()?;
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if ["1", "true", "yes", "on"].contains(&normalized.as_str()) {
        return Some(true);
    }
    if ["0", "false", "no", "off"].contains(&normalized.as_str()) {
        return Some(false);
    }
    None
}

fn trim_slashes(value: &str) -> String {
    value.trim().trim_matches('/').to_string()
}

fn normalize_object_path(value: &str) -> String {
    trim_slashes(value)
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_protocol = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    Some(with_protocol.trim_end_matches('/').to_string())
}

fn normalize_endpoint(raw: &str) -> (String, String) {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return ("".to_string(), "https".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("http://") {
        return (trim_slashes(rest), "http".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("https://") {
        return (trim_slashes(rest), "https".to_string());
    }
    (trim_slashes(trimmed), "https".to_string())
}

fn load_tos_config() -> TosStorageConfig {
    let access_key_id = std::env::var("TOS_ACCESS_KEY").unwrap_or_default().trim().to_string();
    let access_key_secret = std::env::var("TOS_SECRET_KEY")
        .unwrap_or_default()
        .trim()
        .to_string();
    let security_token = std::env::var("TOS_SECURITY_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let region = std::env::var("TOS_REGION").unwrap_or_default().trim().to_string();
    let bucket = std::env::var("TOS_BUCKET").unwrap_or_default().trim().to_string();
    let key_prefix = std::env::var("TOS_KEY_PREFIX")
        .ok()
        .map(|value| normalize_object_path(&value))
        .filter(|value| !value.is_empty());
    let public_base_url = std::env::var("TOS_PUBLIC_BASE_URL")
        .ok()
        .and_then(|value| normalize_base_url(&value));
    let is_custom_domain = parse_bool_env("TOS_IS_CUSTOM_DOMAIN").unwrap_or(false);
    let (endpoint, endpoint_protocol) =
        normalize_endpoint(&std::env::var("TOS_ENDPOINT").unwrap_or_default());
    let enabled_by_env = parse_bool_env("TOS_ENABLED").unwrap_or(true);
    let has_required = !access_key_id.is_empty()
        && !access_key_secret.is_empty()
        && !region.is_empty()
        && !bucket.is_empty()
        && !endpoint.is_empty();

    TosStorageConfig {
        enabled: enabled_by_env && has_required,
        access_key_id,
        access_key_secret,
        security_token,
        region,
        endpoint,
        endpoint_protocol,
        bucket,
        key_prefix,
        public_base_url,
        is_custom_domain,
    }
}

fn tos_percent_encode(input: &str) -> String {
    let mut output = String::new();
    for byte in input.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == '~' {
            output.push(ch);
        } else {
            output.push('%');
            output.push_str(&format!("{:02X}", byte));
        }
    }
    output
}

fn build_tos_public_url(config: &TosStorageConfig, object_key: &str) -> String {
    let encoded_key = object_key
        .split('/')
        .map(tos_percent_encode)
        .collect::<Vec<_>>()
        .join("/");

    if let Some(base_url) = &config.public_base_url {
        return format!("{}/{}", base_url, encoded_key);
    }

    if config.is_custom_domain {
        return format!(
            "{}://{}/{}",
            config.endpoint_protocol, config.endpoint, encoded_key
        );
    }

    format!(
        "{}://{}.{}/{}",
        config.endpoint_protocol,
        config.bucket,
        config.endpoint,
        encoded_key
    )
}

pub(super) async fn api_tos_files(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let config = load_tos_config();
    if !config.enabled {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TOS 未启用或配置不完整（请检查 TOS_ENABLED / TOS_ACCESS_KEY / TOS_SECRET_KEY / TOS_REGION / TOS_ENDPOINT / TOS_BUCKET）",
        ));
    }

    let query_prefix = query
        .get("prefix")
        .map(|value| normalize_object_path(value))
        .filter(|value| !value.is_empty());
    let base_prefix = query_prefix.or_else(|| config.key_prefix.clone());
    let delimiter = query
        .get("delimiter")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let max_keys = query
        .get("maxKeys")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(100)
        .clamp(1, 1000);
    let continuation_token = query
        .get("continuationToken")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let list_prefix = if delimiter.is_some() {
        base_prefix
            .as_ref()
            .map(|value| format!("{}/", value.trim_end_matches('/')))
            .unwrap_or_default()
    } else {
        base_prefix.clone().unwrap_or_default()
    };

    let query_config = config.clone();
    let query_delimiter = delimiter.clone();
    let query_continuation_token = continuation_token.clone();
    let query_list_prefix = list_prefix.clone();
    let listing = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let endpoint = format!(
            "{}://{}",
            query_config.endpoint_protocol, query_config.endpoint
        );
        let mut builder = tos::builder()
            .connection_timeout(3000)
            .request_timeout(15000)
            .max_retry_count(1)
            .ak(query_config.access_key_id.clone())
            .sk(query_config.access_key_secret.clone())
            .region(query_config.region.clone())
            .endpoint(endpoint)
            .is_custom_domain(query_config.is_custom_domain);
        if let Some(token) = &query_config.security_token {
            builder = builder.security_token(token.clone());
        }
        let client = builder.build().map_err(|error| error.to_string())?;

        let mut input = ListObjectsType2Input::new(query_config.bucket.clone());
        input.set_list_only_once(true);
        input.set_fetch_meta(false);
        input.set_max_keys(max_keys as isize);
        if !query_list_prefix.is_empty() {
            input.set_prefix(query_list_prefix.clone());
        }
        if let Some(value) = &query_delimiter {
            input.set_delimiter(value.clone());
        }
        if let Some(value) = &query_continuation_token {
            input.set_continuation_token(value.clone());
        }

        let output = client
            .list_objects_type2(&input)
            .map_err(|error| error.to_string())?;
        let files = output
            .contents()
            .iter()
            .map(|item| {
                let storage_class = item
                    .storage_class()
                    .as_ref()
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default();
                json!({
                  "key": item.key(),
                  "size": item.size(),
                  "lastModified": item.last_modified().map(|value| value.to_rfc3339()).unwrap_or_default(),
                  "storageClass": storage_class,
                  "etag": item.etag().trim_matches('\"'),
                  "url": build_tos_public_url(&query_config, item.key())
                })
            })
            .collect::<Vec<_>>();
        let common_prefixes = output
            .common_prefixes()
            .iter()
            .map(|item| item.prefix().to_string())
            .collect::<Vec<_>>();
        let next_token = output.next_continuation_token().trim().to_string();

        Ok(json!({
          "bucket": output.name(),
          "prefix": output.prefix(),
          "delimiter": if output.delimiter().trim().is_empty() { query_delimiter } else { Some(output.delimiter().to_string()) },
          "maxKeys": output.max_keys(),
          "isTruncated": output.is_truncated(),
          "nextContinuationToken": if next_token.is_empty() { Value::Null } else { json!(next_token) },
          "commonPrefixes": common_prefixes,
          "files": files
        }))
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
    .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;

    Ok(Json(json!({
      "success": true,
      "data": listing
    })))
}

pub(super) async fn api_image_proxy(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let target = query
        .get("url")
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url 不能为空"))?;
    if !is_http_url(&target) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持 http/https 图片地址",
        ));
    }

    let response = http_client()
        .get(&target)
        .header(reqwest::header::ACCEPT, "image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("图片拉取失败: {}", response.status()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 25 * 1024 * 1024)
    {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "图片体积超过代理上限",
        ));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| value.starts_with("image/"))
        .unwrap_or_else(|| "image/png".to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error.to_string()))?
        .to_vec();
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "图片体积超过代理上限",
        ));
    }

    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_str(&mime)
                    .unwrap_or_else(|_| HeaderValue::from_static("image/png")),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
            (
                header::HeaderName::from_static("x-image-proxy"),
                HeaderValue::from_static("1"),
            ),
        ],
        bytes,
    )
        .into_response())
}
