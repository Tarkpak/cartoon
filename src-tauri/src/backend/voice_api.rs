use super::*;

const VOLCENGINE_SPEECH_ENDPOINT: &str = "https://openspeech.bytedance.com";
const VOICE_GENERATION_MODEL: &str = "seed-audio-1.0";
const VOICE_INPUT_MAX_CHARS: usize = 3000;
const VOICE_REFERENCE_MAX_BYTES: usize = 10 * 1024 * 1024;

fn voice_api_key() -> Result<String, ApiError> {
    get_cloud_runtime_credentials()
        .and_then(|credentials| {
            provider_credential_field(&credentials, "volcengine", "speechApiKey")
        })
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "请先由管理员在后台供应商管理中配置豆包语音 API Key",
            )
        })
}

fn current_voice_owner_id() -> Option<String> {
    config_connection()
        .and_then(|conn| cloud_user_public(&conn))
        .and_then(|user| user.get("id").and_then(Value::as_str).map(str::to_string))
}

fn voice_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn voice_provider_error_message(message: &str) -> String {
    if message.contains("volc.megatts.timbre")
        && message
            .to_ascii_lowercase()
            .contains("resource not granted")
    {
        return "当前项目尚未开通后付费音色服务（volc.megatts.timbre）。请前往豆包语音控制台的“开通管理”，在“音色槽位”中开通后付费音色服务后重试；首次使用复刻音色正式生成语音时，将按火山引擎规则收取 138 元/个后付费音色槽位费，生成内容另按用量计费。".to_string();
    }
    message.to_string()
}

fn voice_profile_status(raw: i64) -> &'static str {
    match raw {
        1 => "training",
        2 => "ready",
        3 => "failed",
        4 => "active",
        _ => "not_found",
    }
}

fn voice_profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "id": row.get::<_, String>(0)?,
      "name": row.get::<_, String>(1)?,
      "provider": row.get::<_, String>(2)?,
      "speakerId": row.get::<_, String>(3)?,
      "customSpeakerId": row.get::<_, Option<String>>(4)?,
      "status": row.get::<_, String>(5)?,
      "language": row.get::<_, i64>(6)?,
      "sourceAssetId": row.get::<_, Option<String>>(7)?,
      "sourceAudioUrl": row.get::<_, Option<String>>(8)?,
      "previewAssetId": row.get::<_, Option<String>>(9)?,
      "previewAudioUrl": row.get::<_, Option<String>>(10)?,
      "errorMessage": row.get::<_, Option<String>>(11)?,
      "activatedAt": row.get::<_, Option<String>>(12)?,
      "createdAt": row.get::<_, String>(13)?,
      "updatedAt": row.get::<_, String>(14)?,
    }))
}

fn voice_profile_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, ApiError> {
    conn.query_row(
        "SELECT id, name, provider, speaker_id, custom_speaker_id, status, language,
                source_asset_id, source_audio_url, preview_asset_id, preview_audio_url,
                error_message, activated_at, created_at, updated_at
         FROM voice_profiles WHERE id = ?1 AND archived_at IS NULL LIMIT 1",
        params![id],
        voice_profile_from_row,
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn voice_task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let subtitle = row
        .get::<_, Option<String>>(12)?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    Ok(json!({
      "id": row.get::<_, String>(0)?,
      "name": row.get::<_, String>(1)?,
      "mode": row.get::<_, String>(2)?,
      "voiceProfileId": row.get::<_, Option<String>>(3)?,
      "prompt": row.get::<_, String>(4)?,
      "status": row.get::<_, String>(5)?,
      "progress": row.get::<_, i64>(6)?,
      "resultAssetId": row.get::<_, Option<String>>(7)?,
      "audioUrl": row.get::<_, Option<String>>(8)?,
      "durationMs": row.get::<_, Option<i64>>(9)?,
      "originalDurationMs": row.get::<_, Option<i64>>(10)?,
      "errorMessage": row.get::<_, Option<String>>(11)?,
      "subtitle": subtitle,
      "createdAt": row.get::<_, String>(13)?,
      "updatedAt": row.get::<_, String>(14)?,
      "completedAt": row.get::<_, Option<String>>(15)?,
    }))
}

fn voice_task_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, ApiError> {
    conn.query_row(
        "SELECT id, name, mode, voice_profile_id, prompt, status, progress, result_asset_id,
                audio_url, duration_ms, original_duration_ms, error_message, subtitle_json,
                created_at, updated_at, completed_at
         FROM voice_generation_tasks WHERE id = ?1 LIMIT 1",
        params![id],
        voice_task_from_row,
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn volcengine_voice_request(path: &str, body: &Value) -> Result<Value, ApiError> {
    let api_key = voice_api_key()?;
    let request_id = Uuid::new_v4().to_string();
    let response = llm_http_client()
        .post(format!("{VOLCENGINE_SPEECH_ENDPOINT}{path}"))
        .header("Content-Type", "application/json")
        .header("X-Api-Key", api_key)
        .header("X-Api-Request-Id", request_id)
        .timeout(Duration::from_secs(300))
        .json(body)
        .send()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("豆包语音请求失败: {error}"),
            )
        })?;
    let status = response.status();
    let log_id = response
        .headers()
        .get("x-tt-logid")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let text = response.text().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取豆包语音响应失败: {error}"),
        )
    })?;
    let mut payload = serde_json::from_str::<Value>(&text)
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "豆包语音响应格式无效"))?;
    if !status.is_success()
        || payload
            .get("code")
            .and_then(Value::as_i64)
            .is_some_and(|code| code != 0)
    {
        let message = voice_text(payload.get("message"))
            .unwrap_or_else(|| format!("豆包语音请求失败 ({status})"));
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            voice_provider_error_message(&message),
        ));
    }
    if let Some(log_id) = log_id {
        payload["logId"] = json!(log_id);
    }
    Ok(payload)
}

fn data_url_payload(source: &str, expected_prefix: &str) -> Result<(String, String), ApiError> {
    let (header, data) = source
        .split_once(',')
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "参考文件格式无效"))?;
    if !header.starts_with(expected_prefix) || !header.ends_with(";base64") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "参考文件必须使用 base64 dataURL",
        ));
    }
    let bytes = BASE64_STANDARD
        .decode(data.replace(|ch: char| ch.is_whitespace(), ""))
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "参考文件 base64 无效"))?;
    if bytes.len() > VOICE_REFERENCE_MAX_BYTES {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "单个参考文件不能超过 10 MB",
        ));
    }
    let mime = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .unwrap_or_default()
        .to_string();
    Ok((BASE64_STANDARD.encode(bytes), mime))
}

fn audio_format_from_mime(mime: &str) -> &'static str {
    match mime {
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" | "audio/opus" => "ogg",
        "audio/mp4" | "audio/m4a" => "m4a",
        "audio/aac" => "aac",
        "audio/pcm" => "pcm",
        _ => "mp3",
    }
}

fn profile_query_body(profile: &Value) -> Value {
    if let Some(custom_id) = voice_text(profile.get("customSpeakerId")) {
        json!({ "speaker_id": "custom_speaker_id", "custom_speaker_id": custom_id })
    } else {
        json!({ "speaker_id": profile.get("speakerId").cloned().unwrap_or(Value::Null) })
    }
}

async fn refresh_voice_profile(state: &BackendState, id: &str) -> Result<Value, ApiError> {
    let profile = {
        let conn = db_connection(state)?;
        voice_profile_by_id(&conn, id)?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "音色不存在"))?
    };
    let payload =
        volcengine_voice_request("/api/v3/tts/get_voice", &profile_query_body(&profile)).await?;
    let status = voice_profile_status(payload.get("status").and_then(Value::as_i64).unwrap_or(0));
    let demo_audio = payload
        .get("speaker_status")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find_map(|item| voice_text(item.get("demo_audio")))
        });
    let mut preview_asset_id = voice_text(profile.get("previewAssetId"));
    let mut preview_audio_url = voice_text(profile.get("previewAudioUrl"));
    if let Some(source) = demo_audio {
        let stable_url = persist_audio_source(state, &source, "voice_profile_preview").await?;
        let asset = super::library_api::create_generated_audio_library_asset(
            state,
            &format!(
                "{} · 试听",
                profile
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("复刻音色")
            ),
            "豆包语音复刻试听",
            "character_voice",
            &stable_url,
            None,
            Some(json!({ "voiceProfileId": id, "speakerId": profile["speakerId"] })),
        )
        .await?;
        preview_asset_id = voice_text(asset.get("id"));
        preview_audio_url = Some(stable_url);
    }
    let now = now_iso();
    let error_message = if status == "failed" {
        voice_text(payload.get("message"))
    } else {
        None
    };
    let conn = db_connection(state)?;
    conn.execute(
        "UPDATE voice_profiles SET status = ?1, preview_asset_id = ?2, preview_audio_url = ?3,
         provider_metadata_json = ?4, error_message = ?5, updated_at = ?6 WHERE id = ?7",
        params![
            status,
            preview_asset_id,
            preview_audio_url,
            payload.to_string(),
            error_message,
            now,
            id
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    voice_profile_by_id(&conn, id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "音色不存在"))
}

pub(super) async fn api_voice_health() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
      "success": true,
      "data": {
        "configured": voice_api_key().is_ok(),
        "provider": "volcengine",
        "endpoint": VOLCENGINE_SPEECH_ENDPOINT
      }
    })))
}

pub(super) async fn api_voice_preset_preview(
    Path(speaker_id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let valid_speaker_id = !speaker_id.is_empty()
        && speaker_id.len() <= 256
        && speaker_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'));
    if !valid_speaker_id {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "官方音色 ID 无效"));
    }
    let path = format!("/api/client/voice/previews/{speaker_id}");
    let payload = cloud_post_client_data_json(&state, &path, json!({})).await?;
    if payload.get("success").and_then(Value::as_bool) != Some(true) {
        let message = if payload.get("skipped").is_some() {
            "请先登录云端账号后再试听官方音色"
        } else {
            "云端音色试听服务暂不可用"
        };
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, message));
    }
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    Ok(Json(json!({ "success": true, "data": data })))
}

pub(super) async fn api_voice_profiles(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut statement = conn
        .prepare(
            "SELECT id, name, provider, speaker_id, custom_speaker_id, status, language,
                    source_asset_id, source_audio_url, preview_asset_id, preview_audio_url,
                    error_message, activated_at, created_at, updated_at
             FROM voice_profiles WHERE archived_at IS NULL ORDER BY updated_at DESC",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let items = statement
        .query_map([], voice_profile_from_row)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true, "data": { "items": items } })))
}

pub(super) async fn api_voice_profile_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let profile = voice_profile_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "音色不存在"))?;
    Ok(Json(
        json!({ "success": true, "data": { "profile": profile } }),
    ))
}

pub(super) async fn api_voice_profile_clone(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let name = voice_text(body.get("name"))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "音色名称不能为空"))?;
    if body.get("consentConfirmed").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请先确认已获得声音使用授权",
        ));
    }
    let audio_data = voice_text(body.get("audioData"))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请上传声音样本"))?;
    let (base64_audio, mime) = data_url_payload(&audio_data, "data:audio/")?;
    let language = body
        .get("language")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .clamp(0, 21);
    let id = format!("voice_{}", Uuid::new_v4().simple());
    let custom_speaker_id = format!("custom_zh_{}", Uuid::new_v4().simple());
    let mut request = json!({
      "speaker_id": "custom_speaker_id",
      "custom_speaker_id": custom_speaker_id,
      "audio": { "data": base64_audio, "format": audio_format_from_mime(&mime) },
      "language": language,
      "extra_params": {
        "enable_audio_denoise": body.get("enableAudioDenoise").and_then(Value::as_bool).unwrap_or(false),
        "disable_volume_normalization": body.get("disableVolumeNormalization").and_then(Value::as_bool).unwrap_or(false)
      }
    });
    if let Some(text) = voice_text(body.get("referenceText")) {
        request["text"] = json!(text);
    }
    if let Some(demo_text) = voice_text(body.get("demoText")) {
        if !(4..=300).contains(&demo_text.chars().count()) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "试听文本需为 4 到 300 个字符",
            ));
        }
        request["extra_params"]["demo_text"] = json!(demo_text);
    }
    let response = volcengine_voice_request("/api/v3/tts/voice_clone", &request).await?;
    let status = voice_profile_status(response.get("status").and_then(Value::as_i64).unwrap_or(1));
    let now = now_iso();
    let conn = db_connection(&state)?;
    conn.execute(
        "INSERT INTO voice_profiles
          (id, owner_user_id, name, provider, speaker_id, custom_speaker_id, status, language,
           source_asset_id, source_audio_url, provider_metadata_json, consent_confirmed_at,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, 'volcengine', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            current_voice_owner_id(),
            name,
            custom_speaker_id,
            custom_speaker_id,
            status,
            language,
            None::<String>,
            None::<String>,
            response.to_string(),
            now,
            now,
            now,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    drop(conn);
    let profile = refresh_voice_profile(&state, &id)
        .await
        .unwrap_or_else(|_| {
            let conn = db_connection(&state).ok();
            conn.and_then(|conn| voice_profile_by_id(&conn, &id).ok().flatten())
                .unwrap_or_else(|| json!({ "id": id, "name": name, "status": status }))
        });
    Ok(Json(
        json!({ "success": true, "data": { "profile": profile } }),
    ))
}

pub(super) async fn api_voice_profile_refresh(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let profile = refresh_voice_profile(&state, &id).await?;
    Ok(Json(
        json!({ "success": true, "data": { "profile": profile } }),
    ))
}

pub(super) async fn api_voice_profile_archive(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let now = now_iso();
    let conn = db_connection(&state)?;
    let changed = conn
        .execute(
            "UPDATE voice_profiles SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND archived_at IS NULL",
            params![now, now, id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if changed == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "音色不存在"));
    }
    Ok(Json(json!({ "success": true })))
}

fn normalize_generation_references(
    body: &Value,
    profile: Option<&Value>,
) -> Result<Value, ApiError> {
    if let Some(profile) = profile {
        return Ok(json!([{ "speaker": profile["speakerId"] }]));
    }
    if let Some(speaker_id) = voice_text(body.get("speakerId")) {
        return Ok(json!([{ "speaker": speaker_id }]));
    }
    let references = body
        .get("references")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut normalized = Vec::new();
    let mut audio_count = 0usize;
    let mut image_count = 0usize;
    for reference in references {
        let source = voice_text(reference.get("data"))
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "参考资源内容为空"))?;
        if source.starts_with("data:audio/") {
            audio_count += 1;
            let (data, _) = data_url_payload(&source, "data:audio/")?;
            normalized.push(json!({ "audio_data": data }));
        } else if source.starts_with("data:image/") {
            image_count += 1;
            let (data, _) = data_url_payload(&source, "data:image/")?;
            normalized.push(json!({ "image_data": data }));
        } else {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "不支持的参考资源格式",
            ));
        }
    }
    if audio_count > 3 || image_count > 1 || (audio_count > 0 && image_count > 0) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "最多上传三段音频或一张图片，音频与图片不能混用",
        ));
    }
    Ok(Value::Array(normalized))
}

fn build_generation_request(body: &Value, profile: Option<&Value>) -> Result<Value, ApiError> {
    let prompt = voice_text(body.get("prompt"))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "生成内容不能为空"))?;
    if prompt.chars().count() > VOICE_INPUT_MAX_CHARS {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "生成内容不能超过 3000 个字符",
        ));
    }
    let references = normalize_generation_references(body, profile)?;
    let format = voice_text(body.get("format")).unwrap_or_else(|| "mp3".to_string());
    let sample_rate = body
        .get("sampleRate")
        .and_then(Value::as_i64)
        .unwrap_or(24000);
    if ![8000, 16000, 24000, 32000, 44100, 48000].contains(&sample_rate) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "输出采样率无效"));
    }
    Ok(json!({
      "model": VOICE_GENERATION_MODEL,
      "text_prompt": prompt,
      "references": references,
      "audio_config": {
        "format": format,
        "sample_rate": sample_rate,
        "speech_rate": body.get("speechRate").and_then(Value::as_i64).unwrap_or(0).clamp(-50, 100),
        "loudness_rate": body.get("loudnessRate").and_then(Value::as_i64).unwrap_or(0).clamp(-50, 100),
        "pitch_rate": body.get("pitchRate").and_then(Value::as_i64).unwrap_or(0).clamp(-50, 100),
        "enable_subtitle": body.get("enableSubtitle").and_then(Value::as_bool).unwrap_or(true)
      },
      "watermark": {}
    }))
}

fn mark_voice_task_failed(state: &BackendState, id: &str, message: &str) {
    if let Ok(conn) = db_connection(state) {
        let now = now_iso();
        let _ = conn.execute(
            "UPDATE voice_generation_tasks SET status = 'failed', progress = 100,
             error_message = ?1, updated_at = ?2, completed_at = ?3 WHERE id = ?4",
            params![message, now, now, id],
        );
    }
}

async fn run_voice_generation(state: BackendState, task_id: String) -> Result<(), ApiError> {
    let (request, name, category, profile_id) = {
        let conn = db_connection(&state)?;
        let raw = conn
            .query_row(
                "SELECT references_json, name, audio_config_json, voice_profile_id
             FROM voice_generation_tasks WHERE id = ?1",
                params![task_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .map_err(|error| ApiError::new(StatusCode::NOT_FOUND, error.to_string()))?;
        let request = serde_json::from_str::<Value>(&raw.0)
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "生成任务参数损坏"))?;
        let meta = serde_json::from_str::<Value>(&raw.2).unwrap_or_else(|_| json!({}));
        let category = voice_text(meta.get("category")).unwrap_or_else(|| "narration".to_string());
        (request, raw.1, category, raw.3)
    };
    {
        let conn = db_connection(&state)?;
        conn.execute(
            "UPDATE voice_generation_tasks SET status = 'generating', progress = 20, updated_at = ?1 WHERE id = ?2",
            params![now_iso(), task_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let payload = volcengine_voice_request("/api/v3/tts/create", &request).await?;
    let source = voice_text(payload.get("audio"))
        .map(|audio| format!("data:audio/mpeg;base64,{audio}"))
        .or_else(|| voice_text(payload.get("url")))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "豆包语音未返回音频"))?;
    let audio_url = persist_audio_source(&state, &source, "voice_generation").await?;
    let duration_ms = payload
        .get("duration")
        .and_then(Value::as_f64)
        .map(|value| (value * 1000.0).round() as i64);
    let original_duration_ms = payload
        .get("original_duration")
        .and_then(Value::as_f64)
        .map(|value| (value * 1000.0).round() as i64);
    let asset = super::library_api::create_generated_audio_library_asset(
        &state,
        &name,
        "豆包语音生成",
        &category,
        &audio_url,
        duration_ms,
        Some(json!({ "voiceProfileId": profile_id, "generationTaskId": task_id })),
    )
    .await?;
    let now = now_iso();
    let conn = db_connection(&state)?;
    conn.execute(
        "UPDATE voice_generation_tasks SET status = 'completed', progress = 100, result_asset_id = ?1,
         audio_url = ?2, duration_ms = ?3, original_duration_ms = ?4, subtitle_json = ?5,
         error_message = NULL, updated_at = ?6, completed_at = ?7 WHERE id = ?8",
        params![
            asset.get("id").and_then(Value::as_str),
            audio_url,
            duration_ms,
            original_duration_ms,
            payload.get("subtitle").filter(|value| !value.is_null()).map(Value::to_string),
            now,
            now,
            task_id,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if let Some(profile_id) = profile_id {
        conn.execute(
            "UPDATE voice_profiles SET status = 'active', activated_at = COALESCE(activated_at, ?1), updated_at = ?2 WHERE id = ?3",
            params![now, now, profile_id],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(())
}

fn spawn_voice_generation(state: BackendState, task_id: String) {
    tokio::spawn(async move {
        if let Err(error) = run_voice_generation(state.clone(), task_id.clone()).await {
            mark_voice_task_failed(&state, &task_id, &error.message);
        }
    });
}

fn validate_voice_profile_for_generation(
    profile: &Value,
    allow_profile_activation: bool,
) -> Result<(), ApiError> {
    if !matches!(
        profile.get("status").and_then(Value::as_str),
        Some("ready" | "active")
    ) {
        return Err(ApiError::new(StatusCode::CONFLICT, "复刻音色尚未训练完成"));
    }
    if profile.get("activatedAt").is_none_or(Value::is_null) && !allow_profile_activation {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "该复刻音色尚未启用，请先在音色复刻页确认槽位费用并启用音色",
        ));
    }
    Ok(())
}

fn enqueue_voice_generation(
    state: &BackendState,
    body: &Value,
    allow_profile_activation: bool,
) -> Result<Value, ApiError> {
    voice_api_key()?;
    let mode = voice_text(body.get("mode")).unwrap_or_else(|| "prompt".to_string());
    if !matches!(
        mode.as_str(),
        "preset" | "prompt" | "reference_audio" | "reference_image" | "profile"
    ) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "声音生成模式无效"));
    }
    if mode == "preset" {
        let speaker_id = voice_text(body.get("speakerId"))
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请选择官方音色"))?;
        let valid_speaker_id = speaker_id.len() <= 256
            && !speaker_id.starts_with("custom_")
            && speaker_id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'));
        if !valid_speaker_id {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "官方音色 ID 无效"));
        }
    }
    let profile = if mode == "profile" {
        let profile_id = voice_text(body.get("voiceProfileId"))
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "请选择复刻音色"))?;
        let conn = db_connection(&state)?;
        let profile = voice_profile_by_id(&conn, &profile_id)?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "复刻音色不存在"))?;
        validate_voice_profile_for_generation(&profile, allow_profile_activation)?;
        Some(profile)
    } else {
        None
    };
    let request = build_generation_request(&body, profile.as_ref())?;
    let id = format!("voice_task_{}", Uuid::new_v4().simple());
    let name = voice_text(body.get("name"))
        .unwrap_or_else(|| format!("声音生成 {}", &id[id.len().saturating_sub(6)..]));
    let category = voice_text(body.get("category")).unwrap_or_else(|| "narration".to_string());
    if !matches!(
        category.as_str(),
        "character_voice" | "narration" | "sfx" | "bgm"
    ) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "素材分类无效"));
    }
    let prompt = voice_text(body.get("prompt")).unwrap_or_default();
    let now = now_iso();
    let request_id = Uuid::new_v4().to_string();
    let conn = db_connection(state)?;
    conn.execute(
        "INSERT INTO voice_generation_tasks
          (id, owner_user_id, name, mode, voice_profile_id, prompt, references_json,
           audio_config_json, status, progress, request_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 0, ?9, ?10, ?11)",
        params![
            id,
            current_voice_owner_id(),
            name,
            mode,
            profile
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str),
            prompt,
            request.to_string(),
            json!({ "category": category }).to_string(),
            request_id,
            now,
            now,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let task = voice_task_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "生成任务创建失败"))?;
    drop(conn);
    spawn_voice_generation(state.clone(), id);
    Ok(task)
}

pub(super) async fn api_voice_profile_activate(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if body.get("confirmCharge").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请确认支付 138 元/个后付费音色槽位费后再启用",
        ));
    }
    let profile = {
        let conn = db_connection(&state)?;
        voice_profile_by_id(&conn, &id)?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "复刻音色不存在"))?
    };
    if profile
        .get("activatedAt")
        .is_some_and(|value| !value.is_null())
    {
        return Err(ApiError::new(StatusCode::CONFLICT, "该复刻音色已经启用"));
    }
    if !matches!(
        profile.get("status").and_then(Value::as_str),
        Some("ready" | "active")
    ) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "音色训练尚未完成，暂时不能启用",
        ));
    }
    {
        let conn = db_connection(&state)?;
        let activation_pending = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM voice_generation_tasks
                    WHERE voice_profile_id = ?1 AND status IN ('queued', 'generating')
                )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if activation_pending {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "该音色已有启用任务正在处理，请勿重复提交",
            ));
        }
    }
    let name = profile
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("复刻音色");
    let activation_body = json!({
      "mode": "profile",
      "voiceProfileId": id,
      "name": format!("{name} · 启用音频"),
      "prompt": "你好，这是我的声音。",
      "category": "character_voice",
      "format": "mp3",
      "sampleRate": 24000,
      "enableSubtitle": false
    });
    let task = enqueue_voice_generation(&state, &activation_body, true)?;
    Ok(Json(json!({ "success": true, "data": { "task": task } })))
}

pub(super) async fn api_voice_generation_create(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let task = enqueue_voice_generation(&state, &body, false)?;
    Ok(Json(json!({ "success": true, "data": { "task": task } })))
}

pub(super) async fn api_voice_generations(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut statement = conn
        .prepare(
            "SELECT id, name, mode, voice_profile_id, prompt, status, progress, result_asset_id,
                    audio_url, duration_ms, original_duration_ms, error_message, subtitle_json,
                    created_at, updated_at, completed_at
             FROM voice_generation_tasks ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let items = statement
        .query_map([], voice_task_from_row)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({ "success": true, "data": { "items": items } })))
}

pub(super) async fn api_voice_generation_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let task = voice_task_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "生成任务不存在"))?;
    Ok(Json(json!({ "success": true, "data": { "task": task } })))
}

pub(super) async fn api_voice_generation_retry(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    voice_api_key()?;
    let conn = db_connection(&state)?;
    let task = voice_task_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "生成任务不存在"))?;
    if task.get("status").and_then(Value::as_str) != Some("failed") {
        return Err(ApiError::new(StatusCode::CONFLICT, "只有失败任务可以重试"));
    }
    conn.execute(
        "UPDATE voice_generation_tasks SET status = 'queued', progress = 0, error_message = NULL,
         completed_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![now_iso(), id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let task = voice_task_by_id(&conn, &id)?.unwrap_or(task);
    drop(conn);
    spawn_voice_generation(state, id);
    Ok(Json(json!({ "success": true, "data": { "task": task } })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_status_mapping_matches_provider_contract() {
        assert_eq!(voice_profile_status(0), "not_found");
        assert_eq!(voice_profile_status(1), "training");
        assert_eq!(voice_profile_status(2), "ready");
        assert_eq!(voice_profile_status(3), "failed");
        assert_eq!(voice_profile_status(4), "active");
    }

    #[test]
    fn audio_format_is_inferred_from_mime() {
        assert_eq!(audio_format_from_mime("audio/wav"), "wav");
        assert_eq!(audio_format_from_mime("audio/mpeg"), "mp3");
    }

    #[test]
    fn preset_voice_is_forwarded_as_speaker_reference() {
        let request = build_generation_request(
            &json!({
                "prompt": "欢迎来到声音工作台",
                "speakerId": "zh_female_vv_uranus_bigtts"
            }),
            None,
        )
        .expect("preset voice request should be valid");

        assert_eq!(
            request["references"][0]["speaker"],
            "zh_female_vv_uranus_bigtts"
        );
        assert_eq!(request["model"], VOICE_GENERATION_MODEL);
    }

    #[test]
    fn voice_clone_entitlement_error_is_actionable() {
        let message = voice_provider_error_message(
            "[resource_id=volc.megatts.timbre] requested resource not granted",
        );
        assert!(message.contains("尚未开通后付费音色服务"));
        assert!(message.contains("音色槽位"));
        assert!(message.contains("首次使用复刻音色正式生成语音"));
        assert!(message.contains("138 元/个"));
        assert!(message.contains("另按用量计费"));
    }

    #[test]
    fn unknown_provider_error_is_preserved() {
        assert_eq!(
            voice_provider_error_message("provider unavailable"),
            "provider unavailable"
        );
    }

    #[test]
    fn unactivated_profile_is_blocked_from_normal_generation() {
        let profile = json!({ "status": "ready", "activatedAt": null });
        assert!(validate_voice_profile_for_generation(&profile, false).is_err());
        assert!(validate_voice_profile_for_generation(&profile, true).is_ok());
    }

    #[test]
    fn activated_profile_is_available_for_normal_generation() {
        let profile = json!({ "status": "active", "activatedAt": "2026-08-04T00:00:00Z" });
        assert!(validate_voice_profile_for_generation(&profile, false).is_ok());
    }
}
