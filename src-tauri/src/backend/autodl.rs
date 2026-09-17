use super::*;

type AutodlPollState = tokio::sync::Mutex<Option<std::time::Instant>>;

fn autodl_poll_state(task_id: &str) -> std::sync::Arc<AutodlPollState> {
    static POLLS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, (std::sync::Arc<AutodlPollState>, std::time::Instant)>>> = std::sync::OnceLock::new();
    let mut polls = POLLS.get_or_init(Default::default).lock().unwrap_or_else(|error| error.into_inner());
    let now = std::time::Instant::now();
    // Expire idle entries without removing a task that is still being queried or saved.
    polls.retain(|_, (state, touched)| std::sync::Arc::strong_count(state) > 1 || now.duration_since(*touched).as_secs() < 60);
    let (state, touched) = polls.entry(task_id.to_string()).or_insert_with(|| (std::sync::Arc::new(AutodlPollState::new(None)), now));
    *touched = now;
    state.clone()
}

fn autodl_begin_poll(state: std::sync::Arc<AutodlPollState>) -> Option<tokio::sync::OwnedMutexGuard<Option<std::time::Instant>>> {
    let mut guard = state.try_lock_owned().ok()?;
    let now = std::time::Instant::now();
    if guard.is_some_and(|last| now.duration_since(last) < std::time::Duration::from_secs(5)) {
        return None;
    }
    *guard = Some(now);
    Some(guard)
}

fn autodl_error(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn autodl_request(model_id: &str, config: &Value) -> Result<Value, ApiError> {
    if !manual_provider_seed_available_models("autodl")
        .iter()
        .any(|id| id == model_id)
    {
        return Err(autodl_error("不支持的 AutoDL 工作流"));
    }
    let prompt = json_string(config.get("prompt"), "");
    if prompt.trim().is_empty() || prompt.chars().count() > 10_000 {
        return Err(autodl_error("AutoDL 提示词长度必须为 1-10000 字符"));
    }
    let duration = config
        .get("duration")
        .and_then(Value::as_f64)
        .unwrap_or(5.0);
    let max_duration = if model_id == "minimax_h3_lightx2v" {
        10.0
    } else {
        15.0
    };
    if duration.fract() != 0.0 || !(1.0..=max_duration).contains(&duration) {
        return Err(autodl_error(format!(
            "AutoDL 当前工作流需要 1-{max_duration} 的整数秒时长"
        )));
    }
    // Existing scene generation defaults to 720p; H3's corresponding preset is 768p.
    let resolution = match config
        .get("resolution")
        .and_then(Value::as_str)
        .unwrap_or("768p")
    {
        "480p" => "480p",
        "720p" | "768p" => "768p",
        _ => return Err(autodl_error("AutoDL H3 仅支持 480p 或 768p")),
    };
    let orientation = match config
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or("16:9")
    {
        "16:9" => "横",
        "9:16" => "竖",
        "1:1" => "(1:1)",
        _ => return Err(autodl_error("AutoDL H3 画幅无效")),
    };
    if config
        .get("referenceVideos")
        .and_then(Value::as_array)
        .is_some_and(|v| !v.is_empty())
    {
        return Err(autodl_error("当前 AutoDL H3 工作流不支持参考视频"));
    }
    let mut body = json!({"prompt": prompt, "duration": duration as u32, "resolution": format!("{resolution}{orientation}")});
    let mut images = json_string_list(config.get("referenceImages"));
    let first = optional_trimmed_json_string(config.get("firstFrame"))
        .or_else(|| optional_trimmed_json_string(config.get("imageUrl")));
    let last = optional_trimmed_json_string(config.get("lastFrame"));
    let audios = config_audio_reference_urls(config);
    match model_id {
        "minimax_h3_lightx2v_no_pic" => {
            if !images.is_empty() || first.is_some() || last.is_some() || !audios.is_empty() {
                return Err(autodl_error(
                    "文生视频工作流不接受参考素材，请选择多图或首尾帧工作流",
                ));
            }
        }
        "minimax_h3_lightx2v" => {
            if !images.is_empty() || !audios.is_empty() {
                return Err(autodl_error("首尾帧工作流仅接受首帧和尾帧"));
            }
            body["first_frame"] =
                json!(first.ok_or_else(|| autodl_error("AutoDL 首尾帧工作流需要首帧"))?);
            body["last_frame"] =
                json!(last.ok_or_else(|| autodl_error("AutoDL 首尾帧工作流需要尾帧"))?);
        }
        _ => {
            if last.is_some() {
                return Err(autodl_error("多图工作流不支持指定尾帧，请选择首尾帧工作流"));
            }
            if let Some(first) = first {
                if !images.contains(&first) {
                    images.insert(0, first);
                }
            }
            if images.is_empty() || images.len() > 9 || audios.len() > 3 {
                return Err(autodl_error(
                    "AutoDL 多图工作流需要 1-9 张图片，最多 3 段音频",
                ));
            }
            for (index, image) in images.iter().enumerate() {
                body[format!("ref_image_{index}")] = json!(image);
            }
            for (index, audio) in audios.iter().enumerate() {
                body[format!("ref_audio_{index}")] = json!(audio);
            }
        }
    }
    if model_id != "minimax_h3_lightx2v_no_pic" {
        if let Some(seed) = config.get("seed").filter(|v| !v.is_null()) {
            if seed.as_i64().is_none() {
                return Err(autodl_error("AutoDL seed 必须为整数"));
            }
            body["seed"] = seed.clone();
        }
    }
    Ok(body)
}

pub(super) fn validate_autodl_config(model_id: &str, config: &Value) -> Result<(), ApiError> {
    autodl_request(model_id, config).map(|_| ())
}

async fn autodl_request_media(state: &BackendState, body: &mut Value) -> Result<(), ApiError> {
    for (key, value) in body.as_object_mut().expect("request object") {
        if !key.starts_with("ref_") && key != "first_frame" && key != "last_frame" {
            continue;
        }
        let source = value.as_str().unwrap_or("");
        let url = if key.starts_with("ref_audio_") {
            normalize_video_audio_reference_source(state, source, "autodl-audio").await?
        } else {
            normalize_video_image_url_for_provider(state, source).await?
        };
        if !is_http_url(&url) {
            return Err(autodl_error(
                "AutoDL 参考素材需要公网 URL；本地素材请先配置 TOS 云存储",
            ));
        }
        *value = json!(url);
    }
    Ok(())
}

async fn autodl_http(model_id: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let creds = current_provider_creds();
    let token = provider_credential_field(&creds, "autodl", "apiKey")
        .ok_or("请配置 AutoDL ComfyUI Token")?;
    let base = provider_sync_base_url("autodl", &creds).ok_or("AutoDL Base URL 无效")?;
    let endpoint = format!(
        "{}/api/v1/comfyui/comfyui_workflow/{}",
        base.trim_end_matches('/'),
        path
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let request = if let Some(body) = body {
        client.post(&endpoint).json(body)
    } else {
        client.get(&endpoint)
    };
    let started = Utc::now().timestamp_millis();
    let result = async {
        // AutoDL expects the raw ComfyUI token, without the Bearer prefix.
        let response = request
            .header("Authorization", token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let payload: Value = response
            .json()
            .await
            .map_err(|e| format!("AutoDL HTTP {status}: {e}"))?;
        if !status.is_success() || payload.get("code").and_then(Value::as_str) != Some("Success") {
            return Err(format!(
                "AutoDL HTTP {status}: {}",
                payload
                    .get("msg")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("请求失败")
            ));
        }
        Ok(payload)
    }
    .await;
    if body.is_some() || result.is_err() {
        llm_dev_write_db_log(
        "autodl",
        model_id,
        if body.is_some() {
            "submitVideo"
        } else {
            "queryVideo"
        },
        if result.is_ok() { "pending" } else { "error" },
        started,
        Some(&endpoint),
        body,
        result.as_ref().ok(),
        None,
        result.as_ref().err().map(String::as_str),
        );
    }
    result
}

fn autodl_result(payload: &Value) -> Result<Option<String>, String> {
    let data = payload.get("data").ok_or("AutoDL 响应缺少 data")?;
    let status = data
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    match status.as_str() {
        "SUCCESS" | "COMPLETED" => {
            let url = data
                .get("results")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        if item.get("type").and_then(Value::as_str) != Some("video") {
                            return None;
                        }
                        item.get("url")
                            .and_then(Value::as_str)
                            .filter(|url| is_http_url(url))
                            .map(str::to_string)
                    })
                })
                .ok_or("AutoDL 任务已完成但未返回视频 URL")?;
            Ok(Some(url))
        }
        "QUEUED" | "RUNNING" | "PENDING" | "PROCESSING" => Ok(None),
        "FAILED" | "ERROR" | "CANCELLED" | "CANCELED" => Err(data
            .get("message")
            .or_else(|| data.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("AutoDL 视频生成失败")
            .to_string()),
        _ => Err(format!("AutoDL 未知任务状态: {status}")),
    }
}

pub(super) async fn refresh_autodl_video_task(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
    model_id: &str,
    upstream_id: &str,
) -> Result<bool, ApiError> {
    // Both background polling and UI status requests share this per-task gate.
    // Hold it through persistence so concurrent observers cannot finalize twice.
    let Some(_guard) = autodl_begin_poll(autodl_poll_state(task_id)) else {
        return Ok(false);
    };
    let task: Option<(String, String)> = db_connection(state)?
        .query_row(
            "SELECT status, COALESCE(metadata, '{}') FROM video_tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some((status, metadata)) = task else { return Ok(true); };
    if status != "processing" {
        return Ok(true);
    }
    let payload = autodl_http(
        model_id,
        &format!("result/{}", tos_percent_encode(upstream_id)),
        None,
    )
    .await
    .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, e))?;
    let outcome = autodl_result(&payload);
    let metadata: Value = serde_json::from_str(&metadata).unwrap_or_else(|_| json!({}));
    match outcome {
        Ok(Some(url)) => {
            complete_tracked_video_task(
                state,
                task_id,
                scene_id,
                "autodl",
                Some(model_id),
                &url,
                metadata.get("upstreamTask").cloned().unwrap_or_else(|| json!({"provider":"autodl", "taskId":upstream_id})),
            )
            .await?;
            llm_dev_write_db_log("autodl", model_id, "generateVideo", "success",
                Utc::now().timestamp_millis(), None, metadata.get("config"), Some(&payload), None, None);
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(error) => {
            fail_tracked_video_task(state, task_id, &error).await?;
            llm_dev_write_db_log("autodl", model_id, "generateVideo", "error",
                Utc::now().timestamp_millis(), None, metadata.get("config"), Some(&payload), None, Some(&error));
            Ok(true)
        }
    }
}

pub(super) async fn run_autodl_video_task_background(
    state: BackendState,
    task_id: String,
    scene_id: String,
    model_id: String,
    config: Value,
) {
    let result = async {
        update_video_task_progress(&state, &task_id, "processing", 10, None, None, None)?;
        let mut request = autodl_request(&model_id, &config)?;
        autodl_request_media(&state, &mut request).await?;
        let payload = autodl_http(&model_id, &model_id, Some(&request)).await.map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, e))?;
        let upstream_id = payload.pointer("/data/task_id").and_then(Value::as_str).filter(|s| !s.is_empty())
            .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "AutoDL 未返回 task_id"))?;
        let metadata = json!({"provider":"autodl", "modelId":model_id, "config":config, "duration":request["duration"], "resolution":if request["resolution"].as_str().unwrap_or("").starts_with("480p") { "480p" } else { "768p" }, "aspectRatio":config.get("aspectRatio").and_then(Value::as_str).unwrap_or("16:9"), "upstreamTask":{"provider":"autodl", "taskId":upstream_id, "request":request}});
        update_video_task_progress(&state, &task_id, "processing", 30, None, None, Some(&metadata))?;
        let mut errors = 0;
        for _ in 0..720 {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            match refresh_autodl_video_task(&state, &task_id, &scene_id, &model_id, upstream_id).await {
                Ok(true) => return Ok::<(), ApiError>(()),
                Ok(false) => errors = 0,
                Err(_) => {
                    errors += 1;
                    // Keep the persisted upstream task recoverable by later status requests.
                    if errors >= 5 { return Ok(()); }
                }
            }
        }
        Ok(())
    }.await;
    if let Err(error) = result {
        let _ = fail_tracked_video_task(&state, &task_id, &error.message).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autodl_poll_gate_shares_throttle_and_excludes_inflight_requests() {
        let state = autodl_poll_state("poll-gate-test");
        let mut guard = autodl_begin_poll(state.clone()).unwrap();
        assert!(autodl_begin_poll(autodl_poll_state("poll-gate-test")).is_none());
        assert!(autodl_begin_poll(autodl_poll_state("independent-task")).is_some());
        *guard = Some(std::time::Instant::now() - std::time::Duration::from_secs(6));
        assert!(autodl_begin_poll(state.clone()).is_none());
        drop(guard);
        let guard = autodl_begin_poll(state.clone()).unwrap();
        drop(guard);
        assert!(autodl_begin_poll(state).is_none());
    }

    #[test]
    fn autodl_maps_reference_media_and_resolution() {
        let request = autodl_request("minimax_h3_zm_u24", &json!({"prompt":"test", "duration":15, "resolution":"768p", "aspectRatio":"1:1", "referenceImages":["https://example.com/a.png"], "audioReferences":["https://example.com/a.mp3"]})).unwrap();
        assert_eq!(request["resolution"], "768p(1:1)");
        assert_eq!(request["ref_image_0"], "https://example.com/a.png");
        assert_eq!(request["ref_audio_0"], "https://example.com/a.mp3");
    }

    #[test]
    fn autodl_rejects_missing_frames_and_invalid_duration() {
        assert!(autodl_request(
            "minimax_h3_lightx2v",
            &json!({"prompt":"test", "firstFrame":"https://example.com/a.png"})
        )
        .is_err());
        assert!(autodl_request("minimax_h3_zm_u24", &json!({"prompt":"test"})).is_err());
        assert!(autodl_request(
            "minimax_h3_lightx2v_no_pic",
            &json!({"prompt":"test", "duration":1.5})
        )
        .is_err());
        assert!(autodl_request(
            "minimax_h3_lightx2v_no_pic",
            &json!({"prompt":"test", "duration":1})
        )
        .is_ok());
    }

    #[test]
    fn autodl_handles_both_success_statuses_and_failure() {
        for status in ["SUCCESS", "completed"] {
            assert_eq!(autodl_result(&json!({"data":{"status":status,"results":[{"type":"video","url":"https://example.com/a.mp4"}]}})).unwrap(), Some("https://example.com/a.mp4".into()));
        }
        assert!(autodl_result(&json!({"data":{"status":"RUNNING"}}))
            .unwrap()
            .is_none());
        assert!(autodl_result(&json!({"data":{"status":"FAILED"}})).is_err());
        assert!(autodl_result(&json!({"data":{"status":"SUCCESS","results":[]}})).is_err());
    }

    #[test]
    fn autodl_catalog_and_scene_references_match_transport() {
        for id in manual_provider_seed_available_models("autodl") {
            let (kind, caps) = build_available_model_entry("autodl", &id);
            assert_eq!(kind, AvailableModelKind::Video);
            assert_eq!(infer_model_provider(&id).as_deref(), Some("autodl"));
            assert_eq!(
                caps["maxDuration"],
                if id == "minimax_h3_lightx2v" { 10 } else { 15 }
            );
        }
        let mut config = json!({"prompt":"test", "references":{"environmentImage":"https://example.com/env.png", "characterImages":["https://example.com/person.png"]}});
        apply_scene_video_reference_inputs(&mut config, &json!({}), "autodl", "minimax_h3_zm_u24");
        let request = autodl_request("minimax_h3_zm_u24", &config).unwrap();
        assert_eq!(request["ref_image_0"], "https://example.com/env.png");
        assert_eq!(request["ref_image_1"], "https://example.com/person.png");
    }

    #[test]
    fn autodl_scene_continuity_respects_workflow_limits() {
        let references = json!({"continuityFirstFrame":"https://example.com/first.png", "environmentImage":"https://example.com/env.png", "characterImages":(0..9).map(|i| format!("https://example.com/{i}.png")).collect::<Vec<_>>()});
        let mut text = json!({"prompt":"test", "references":references});
        apply_scene_video_reference_inputs(&mut text, &json!({}), "autodl", "minimax_h3_lightx2v_no_pic");
        assert!(autodl_request("minimax_h3_lightx2v_no_pic", &text).is_ok());
        let mut multi = json!({"prompt":"test", "references":references});
        apply_scene_video_reference_inputs(&mut multi, &json!({}), "autodl", "minimax_h3_zm_u24");
        let request = autodl_request("minimax_h3_zm_u24", &multi).unwrap();
        assert_eq!(request["ref_image_0"], "https://example.com/first.png");
        assert!(request.get("ref_image_8").is_some());
        assert!(request.get("ref_image_9").is_none());
    }

    #[test]
    fn autodl_workflow_quality_reaches_upstream_request() {
        for quality in ["480p", "768p"] {
            let options = json!({"autodl":{"quality":quality}});
            assert!(validate_workflow_model_options("video_generation", &options).is_ok());
            let mut config = json!({"prompt":"test", "aspectRatio":"9:16"});
            apply_workflow_video_generation_options(&mut config, &json!({"video_generation":options}), "autodl", "minimax_h3_lightx2v_no_pic");
            let request = autodl_request("minimax_h3_lightx2v_no_pic", &config).unwrap();
            assert_eq!(request["resolution"], format!("{quality}竖"));
        }
        assert!(validate_workflow_model_options("video_generation", &json!({"autodl":{"quality":"1080p"}})).is_err());
        let mut config = json!({"prompt":"test"});
        apply_workflow_video_generation_options(&mut config, &json!({}), "autodl", "minimax_h3_lightx2v_no_pic");
        assert_eq!(config["resolution"], "768p");
    }

    #[test]
    fn autodl_inferred_provider_accepts_one_second() {
        let mut config = json!({"prompt":"test", "modelId":"minimax_h3_lightx2v_no_pic", "duration":1});
        assert!(validate_video_generation_config(&mut config).is_ok());
        config["provider"] = json!("qwen");
        assert!(validate_video_generation_config(&mut config).is_err());
    }
}
