//! Bounded episode parsing. Source ranges are assigned by code, never by the model.
use super::*;
use futures_util::StreamExt;

const BATCH_THRESHOLD: usize = 1_400;
const BATCH_TARGET: usize = 650;
const CONCURRENCY: usize = 3;

pub(super) fn should_batch(body: &Value) -> bool {
    json_string(body.get("scriptParseMode"), "premium_drama") != "origin_explainer"
        // An explicit scene count is a whole-episode constraint; keep its single-call semantics.
        && body.get("maxScenes").filter(|value| !value.is_null()).is_none()
        && body
            .get("text")
            .and_then(Value::as_str)
            .is_some_and(|text| {
                text.chars().count() >= BATCH_THRESHOLD && split_source(text).len() > 1
            })
}

// Prefer complete source lines (including speaker labels), keeping every byte exactly once.
// A single long line stays intact so we never split a spoken sentence between workers.
fn split_source(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut size = 0;
    for line in text.split_inclusive('\n') {
        let line_size = line.chars().count();
        if size >= BATCH_TARGET && !current.trim().is_empty() && !line.trim().is_empty() {
            chunks.push(std::mem::take(&mut current));
            size = 0;
        }
        current.push_str(line);
        size += line_size;
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    } else if let Some(last) = chunks.last_mut() {
        last.push_str(&current);
    }
    chunks
}

fn progress(step: &str, message: String, completed: usize, total: usize) {
    let _ = TEXT_STREAM_PROGRESS.try_with(|sender| {
        sender.send_replace(json!({
            "type": "progress", "payload": {
                "step": step, "message": message,
                "progress": if step == "completed" { 100 } else if step == "merging" { 97 } else if total == 0 { 3 } else { 10 + completed * 60 / total },
                "chunkIndex": completed, "chunkCount": total
            }
        }))
    });
}

// Model snapshot is resolved once for all batches; no config refresh or model switch mid-episode.
struct Model {
    provider: String,
    id: String,
    creds: Value,
}

impl Model {
    async fn generate(&self, prompt: &str) -> Result<Value, String> {
        // Keep token feedback local so concurrent calls cannot overwrite aggregate batch progress.
        let (sender, _receiver) = tokio::sync::watch::channel(Value::Null);
        let text = TEXT_STREAM_PROGRESS
            .scope(
                sender,
                run_text_model_test_remote(&self.provider, &self.id, prompt, &self.creds),
            )
            .await?;
        extract_json_from_text(&text)
    }
}

fn without_parentheticals(text: &str) -> String {
    let mut depth = 0usize;
    text.chars()
        .filter(|c| match c {
            '（' | '(' => {
                depth += 1;
                false
            }
            '）' | ')' => {
                depth = depth.saturating_sub(1);
                false
            }
            _ => depth == 0,
        })
        .collect()
}

fn canonical_dialogue(text: &str) -> String {
    without_parentheticals(text)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

// Accept both Markdown speaker labels and plain speaker:quoted-speech lines.
// Do not classify arbitrary prose/scene metadata containing a colon as dialogue.
fn dialogue_lines(source: &str) -> Vec<String> {
    source
        .lines()
        .filter_map(|line| {
            let raw = line.trim();
            let markdown = raw.starts_with("**");
            let line = without_parentheticals(raw);
            let (speaker, dialogue) = line.split_once('：').or_else(|| line.split_once(':'))?;
            let speaker = speaker.trim().trim_matches('*');
            if speaker.is_empty() || speaker.contains(['【', '#', '。', '，']) || speaker.chars().count() > 40 {
                return None;
            }
            let dialogue = dialogue.trim();
            if !markdown && !dialogue.starts_with(['“', '「', '『', '"']) {
                return None;
            }
            Some(dialogue.to_string())
        })
        .flat_map(|dialogue| {
            // Permit a long speech to span shots, with speaker/emotion labels between clauses.
            dialogue
                .split(['，', '。', '！', '？', '；', '…', ',', '.', '!', '?', ';'])
                .map(canonical_dialogue)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn validate_plan(plan: &Value) -> Result<(), String> {
    for field in ["visualStyle", "directing"] {
        if !plan
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
        {
            return Err(format!("全局规划缺少 {field}"));
        }
    }
    let characters = plan
        .get("characters")
        .and_then(Value::as_array)
        .ok_or("全局规划缺少角色列表")?;
    for character in characters {
        for field in ["name", "description"] {
            if !character
                .get(field)
                .and_then(Value::as_str)
                .is_some_and(|text| !text.trim().is_empty())
            {
                return Err(format!("全局规划角色缺少 {field}"));
            }
        }
    }
    Ok(())
}

fn validate_batch(value: &Value, source: &str, max_duration: u64) -> Result<(), String> {
    let scenes = value
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|scenes| !scenes.is_empty())
        .ok_or("分镜列表为空")?;
    for scene in scenes {
        if !scene
            .pointer("/setting/location")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
            || !scene.get("characters").is_some_and(Value::is_array)
            || !scene.get("props").is_some_and(Value::is_array)
        {
            return Err("分镜缺少地点、人物或道具列表".into());
        }
        scene
            .get("description")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or("分镜缺少画面描述")?;
        if !scene
            .get("duration")
            .and_then(Value::as_u64)
            .is_some_and(|duration| (4..=max_duration).contains(&duration))
        {
            return Err(format!("分镜时长必须为 4-{max_duration} 秒的整数"));
        }
    }
    validate_dialogue(value, source)
}

pub(super) fn validate_dialogue(value: &Value, source: &str) -> Result<(), String> {
    let data = value.get("data").unwrap_or(value);
    let output = data.get("scenes").and_then(Value::as_array).into_iter().flatten()
        .filter_map(|scene| scene.get("description").and_then(Value::as_str))
        .map(canonical_dialogue).collect::<String>();
    // Consume in sequence: repeated lines must appear repeatedly, and order must match the source.
    let mut rest = output.as_str();
    for dialogue in dialogue_lines(source) {
        let Some(offset) = rest.find(&dialogue) else {
            return Err("原文对白存在遗漏、改写或顺序错误，请完整保留输入正文的全部台词".to_string());
        };
        rest = &rest[offset + dialogue.len()..];
    }
    Ok(())
}

async fn retry_batch<F, Fut>(
    prompt: &str,
    source: &str,
    max_duration: u64,
    mut generate: F,
) -> Result<Value, String>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let mut failure = String::new();
    for attempt in 0..2 {
        let request = if attempt == 0 {
            prompt.to_string()
        } else {
            format!("{prompt}\n上一轮本批校验失败：{failure}。请修正并重新输出本批完整 JSON。")
        };
        match generate(request).await.and_then(|value| {
            validate_batch(&value, source, max_duration)?;
            Ok(value)
        }) {
            Ok(value) => return Ok(value),
            Err(error) => failure = error,
        }
    }
    Err(failure)
}

async fn collect_batches<F>(tasks: Vec<F>, total: usize) -> Result<Vec<(usize, Value)>, String>
where
    F: std::future::Future<Output = Result<(usize, Value), String>>,
{
    let mut pending = stream::iter(tasks).buffer_unordered(CONCURRENCY);
    let mut results = Vec::new();
    while let Some(result) = pending.next().await {
        results.push(result?);
        progress(
            "batch_generating",
            format!("详细分镜已完成 {} / {} 批", results.len(), total),
            results.len(),
            total,
        );
    }
    Ok(results)
}

fn merge_batches(mut batches: Vec<(usize, Value)>, plan: &Value, body: &Value) -> Result<Value, String> {
    batches.sort_by_key(|(index, _)| *index);
    let mut scenes = Vec::new();
    let characters = character_registry::merge_batch_characters(plan, &mut batches, body)?;
    for (_, batch) in batches {
        let batch_scenes = batch
            .get("scenes")
            .and_then(Value::as_array)
            .ok_or("分镜列表缺失")?;
        for (local_index, item) in batch_scenes.iter().enumerate() {
            let mut scene = item.as_object().cloned().ok_or("分镜结构无效")?;
            scene.insert("id".into(), json!(format!("scene_{:03}", scenes.len() + 1)));
            // A parallel batch cannot assert continuity against the actual preceding final frame.
            if local_index == 0 {
                scene.insert("usePreviousLastFrameAsFirstFrame".into(), json!(false));
                scene.insert("continuityLinkReason".into(), json!(""));
            }
            scenes.push(Value::Object(scene));
        }
    }
    Ok(json!({ "title": plan.get("title"), "characters": characters, "scenes": scenes }))
}

pub(super) async fn parse(state: &BackendState, body: &Value) -> Result<Value, ApiError> {
    let source = json_string(body.get("text"), "");
    let chunks = split_source(&source);
    let context = model_log_context_from_workflow_body(body, None, None);
    CURRENT_MODEL_LOG_CONTEXT
        .scope(context, async { parse_inner(state, body, &chunks).await })
        .await
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn parse_inner(
    state: &BackendState,
    body: &Value,
    chunks: &[String],
) -> Result<Value, String> {
    cloud_refresh_model_runtime_config(state)
        .await
        .map_err(|error| error.message)?;
    let (model, planning_prompt, batch_prompts, max_duration, director) = {
        let conn = db_connection(state).map_err(|error| error.message)?;
        let creds = load_provider_creds(&conn);
        let id = resolve_runtime_workflow_model_id(&conn, "script_parsing")?;
        let provider = resolve_model_provider_required_string(&id, &creds)?;
        let model = Model {
            provider,
            id,
            creds,
        };
        let template = build_script_parse_prompt(&conn, body).map_err(|error| error.message)?;
        let planning_prompt = format!(
            "{template}\n\n【本次调用任务覆盖】\n本次只做整集轻量规划，不生成详细分镜。\n\
             按上面的原文、角色/环境/道具锚点、画风和用户导演要求，制定统一视觉方案和节奏。\n\
             只输出紧凑 JSON：{{\"title\":\"集标题\",\"visualStyle\":\"全局视觉方案，不超过150字\",\"directing\":\"导演节奏，不超过150字\",\"characterIds\":[\"已有或新增角色id\"],\"newCharacters\":[{{\"id\":\"new_1\",\"name\":\"新增角色名\",\"aliases\":[],\"description\":\"稳定外观\",\"role\":\"角色定位\",\"gender\":\"性别\"}}]}}。已有角色只引用 id；没有新增角色时 newCharacters 为 []。\n\
             不输出 scenes，不复述原文，不扩写剧情。后续各批详细分镜会共享本方案。"
        );
        let prompts = chunks
            .iter()
            .map(|chunk| {
                let mut batch_body = body.clone();
                batch_body["text"] = json!(chunk);
                build_script_parse_prompt(&conn, &batch_body).map_err(|error| error.message)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let video_model =
            resolve_runtime_workflow_model_id(&conn, "video_generation").unwrap_or_default();
        let provider = resolve_model_provider(&video_model, &model.creds).unwrap_or_default();
        let (_, caps) = build_available_model_entry(&provider, &video_model);
        let max_duration = caps
            .get("maxDuration")
            .and_then(Value::as_u64)
            .unwrap_or(15)
            .min(30);
        (model, planning_prompt, prompts, max_duration, script_scene_detail::director(&conn).map_err(|error| error.message)?)
    };
    progress("planning", "正在制定全局视觉与角色方案".into(), 0, 0);
    let planning_started = std::time::Instant::now();
    let mut plan = model
        .generate(&planning_prompt)
        .await
        .map_err(|e| format!("全局规划失败：{e}"))?;
    plan = character_registry::expand(plan, body)?;
    let planning_ms = planning_started.elapsed().as_millis() as u64;
    if let Some(characters) = plan.get_mut("characters").and_then(Value::as_array_mut) {
        preserve_project_character_baselines(characters, body);
    }
    validate_plan(&plan)?;
    progress(
        "batch_generating",
        format!("全局方案已完成，正在并行生成 {} 批分镜", chunks.len()),
        0,
        chunks.len(),
    );
    let details_started = std::time::Instant::now();
    let tasks: Vec<_> = batch_prompts.iter().enumerate().map(|(index, prompt)| {
        let plan = &plan;
        let model = &model;
        async move {
            let before = if index == 0 { String::new() } else {
                chunks[index - 1].chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect()
            };
            let after: String = chunks.get(index + 1).map(|s| s.chars().take(200).collect()).unwrap_or_default();
            let prompt = format!(
                "{prompt}\n\n【分批执行协议（最高优先级）】\n\
                 当前为第 {}/{} 批。只生成【输入文本】的分镜，原文台词和事件不得遗漏、改写或重复。\n\
                 全局方案（只用于保持一致，不得原样写进 description）：{plan}\n\
                 前文衔接参考（不得生成）：{before}\n后文衔接参考（不得生成）：{after}\n\
                 本批首镜不引用上一批末帧。镜头编号从 scene_001 开始，后端统一重编号；description 不再写镜头编号。\n\
                 角色稳定外观沿用全局方案，scenes[].characters 使用 characterId 引用全局方案或项目身份表中的 id。\n\
                 顶层 newCharacters 只补充全局方案和项目身份表均未登记的新角色，不再输出顶层 characters；没有新增角色用 []。\n\
                 不输出全局风格分析和导演思路；JSON省略缩进，description仍须写完整的逐镜执行细节。",
                index + 1, chunks.len(),
            );
            let mut batch_context = body.clone();
            let mut baselines = body.get("characterBaselines").and_then(Value::as_array).cloned().unwrap_or_default();
            if let Some(characters) = plan.get("characters").and_then(Value::as_array) {
                for character in characters {
                    if let Some(existing) = baselines.iter_mut().find(|existing| {
                        existing.get("id").is_some_and(|id| Some(id) == character.get("id"))
                            || (existing.get("id").is_none() && existing.get("name") == character.get("name"))
                    }) {
                        // The expanded plan supplies IDs for old clients and fills empty placeholders.
                        *existing = character.clone();
                    } else {
                        baselines.push(character.clone());
                    }
                }
            }
            batch_context["characterBaselines"] = json!(baselines);
            let batch_context = &batch_context;
            let mut attempt = 0;
            let value = retry_batch(&prompt, &chunks[index], max_duration, |request| {
                attempt += 1;
                if attempt > 1 {
                    let _ = TEXT_STREAM_PROGRESS.try_with(|sender| {
                        let mut event = sender.borrow().clone();
                        event["payload"]["step"] = json!("batch_retry");
                        event["payload"]["message"] = json!(format!("第 {} 批正在重试，其他已完成批次保留", index + 1));
                        sender.send_replace(event);
                    });
                }
                async move {
                    let output = model.generate(&request).await?;
                    character_registry::expand(output, batch_context)
                }
            }).await.map_err(|failure| format!("第 {} 批分镜生成失败（已重试）：{failure}", index + 1))?;
            Ok((index, value))
        }
    }).collect();
    let results = collect_batches(tasks, chunks.len()).await?;
    let details_ms = details_started.elapsed().as_millis() as u64;
    let merged = merge_batches(results, &plan, body)?;
    let refinement_started = std::time::Instant::now();
    let merged = script_scene_detail::run(state, merged, body, &director, |prompt| {
        let model = &model;
        async move { model.generate(&prompt).await }
    }).await?;
    let refinement_ms = refinement_started.elapsed().as_millis() as u64;
    progress(
        "merging",
        "正在校验并合并分镜".into(),
        chunks.len(),
        chunks.len(),
    );
    let mut payload = normalize_model_script_result(merged, body);
    payload["parseStrategy"] =
        json!({ "segmented": true, "chunkCount": chunks.len(), "episodeCount": 1 });
    payload["usage"] =
        json!({ "modelProvider": model.provider, "modelId": model.id, "fallback": false });
    payload["usage"]["parseTiming"] =
        json!({"planningMs": planning_ms, "detailsMs": details_ms, "refinementMs": refinement_ms, "batchCount": chunks.len()});
    progress(
        "completed",
        "分镜解析完成，已按原文顺序合并".into(),
        chunks.len(),
        chunks.len(),
    );
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_batch(description: &str) -> Value {
        json!({"scenes":[{"description":description,"duration":8,"setting":{"location":"院子"},"characters":[],"props":[]}]})
    }

    #[test]
    fn rejects_incomplete_plan_and_scene_metadata() {
        let plan = json!({"visualStyle":"暖色", "directing":"循序渐进", "characters":[]});
        assert!(validate_plan(&plan).is_ok());
        assert!(validate_plan(&json!({"visualStyle":"", "characters":[]})).is_err());
        assert!(validate_plan(
            &json!({"visualStyle":"暖色", "directing":"叙事", "characters":[{"name":"甲"}]})
        )
        .is_err());
        let mut batch = valid_batch("画面");
        assert!(validate_batch(&batch, "", 15).is_ok());
        batch["scenes"][0]["setting"] = Value::Null;
        assert!(validate_batch(&batch, "", 15).is_err());
        batch = valid_batch("画面");
        batch["scenes"][0]["duration"] = json!(16);
        assert!(validate_batch(&batch, "", 15).is_err());
        batch["scenes"][0]["duration"] = json!(8.5);
        assert!(validate_batch(&batch, "", 15).is_err());
    }

    #[tokio::test]
    async fn retries_only_failed_batch_and_stops_after_one_retry() {
        let calls = std::cell::Cell::new(0);
        let value = retry_batch("prompt", "**甲**：你好。", 15, |_| {
            calls.set(calls.get() + 1);
            std::future::ready(Ok(if calls.get() == 1 {
                json!({"scenes": []})
            } else {
                valid_batch("你好。")
            }))
        })
        .await
        .unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(value["scenes"][0]["duration"], 8);
        calls.set(0);
        assert!(retry_batch("prompt", "", 15, |_| {
            calls.set(calls.get() + 1);
            std::future::ready(Err("断线".to_string()))
        })
        .await
        .is_err());
        assert_eq!(calls.get(), 2);
    }

    #[tokio::test]
    async fn limits_concurrency_and_collects_all_results() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let tasks = (0..8)
            .map(|index| {
                let active = &active;
                let peak = &peak;
                async move {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(count, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok((index, json!({})))
                }
            })
            .collect();
        assert_eq!(collect_batches(tasks, 8).await.unwrap().len(), 8);
        assert_eq!(peak.load(Ordering::SeqCst), CONCURRENCY);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn failure_cancels_in_flight_batches_without_detached_work() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        struct Guard(Arc<AtomicUsize>);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let active = Arc::new(AtomicUsize::new(0));
        let tasks = (0..6)
            .map(|index| {
                let active = active.clone();
                async move {
                    active.fetch_add(1, Ordering::SeqCst);
                    let _guard = Guard(active);
                    if index == 0 {
                        tokio::time::sleep(Duration::from_millis(2)).await;
                        return Err("本批失败".into());
                    }
                    std::future::pending::<()>().await;
                    Ok((index, json!({})))
                }
            })
            .collect();
        assert!(collect_batches(tasks, 6).await.is_err());
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn source_assignment_preserves_every_byte_and_whole_dialogue_lines() {
        let text = format!(
            "{}\r\n\r\n**甲**：{}\r\n尾声\n",
            "场景动作\n".repeat(150),
            "长台词".repeat(400)
        );
        let chunks = split_source(&text);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
        assert!(chunks
            .iter()
            .any(|chunk| chunk.contains(&format!("**甲**：{}", "长台词".repeat(400)))));
        assert_eq!(split_source("短文\n\n"), vec!["短文\n\n"]);
    }

    #[test]
    fn short_and_explainer_scripts_keep_single_request() {
        assert!(!should_batch(&json!({"text": "短文"})));
        let text = "文\n".repeat(BATCH_THRESHOLD);
        assert!(should_batch(&json!({"text": text})));
        assert!(!should_batch(&json!({"text": text, "maxScenes": 12})));
        assert!(!should_batch(
            &json!({"text": "文".repeat(BATCH_THRESHOLD)})
        ));
        assert!(!should_batch(
            &json!({"text": text, "scriptParseMode": "origin_explainer"})
        ));
    }

    #[test]
    fn validates_plain_quoted_dialogue_without_treating_metadata_as_speech() {
        let source = "老板娘：“三十八一份。”\n主人公（心声：先确认）：\"带米饭吗？\"\n老板娘：「带。」";
        assert_eq!(dialogue_lines(source), vec!["三十八一份", "带米饭吗", "带"]);
        assert!(validate_batch(&valid_batch("三十八一份。带米饭吗？带。"), source, 15).is_ok());
        assert!(validate_batch(&valid_batch("三十八一份。带。"), source, 15).is_err());
        assert!(validate_dialogue(&valid_batch("带米饭吗？三十八一份。带。"), source).is_err());
        assert!(dialogue_lines("场景：旧摊\n说明：午后。\n## 剧本：标题").is_empty());
    }

    #[test]
    fn rejects_missing_reordered_and_repeated_dialogue() {
        let source = "**甲**（心声）：你好！（微笑）\n**乙**：再见。\n**甲**：你好！";
        let batch = valid_batch;
        assert!(validate_batch(&batch("甲：你好！乙：再见。甲：你好！"), source, 15).is_ok());
        assert!(validate_batch(&batch("甲：你好！乙：再见。"), source, 15).is_err());
        assert!(validate_batch(&batch("再见。你好！你好！"), source, 15).is_err());
        assert_eq!(
            dialogue_lines("**甲**（心声：先想想，别急）：嗯，好。（微笑，挥手）"),
            vec!["嗯", "好"]
        );
        assert!(validate_batch(
            &batch("嗯，好。"),
            "**甲**（心声：先想想，别急）：嗯，好。",
            15
        )
        .is_ok());
        assert!(validate_batch(&json!({"scenes":[]}), source, 15).is_err());
    }

    #[test]
    fn merge_orders_results_assigns_unique_ids_and_resets_batch_continuity() {
        let batch = |title: &str| json!({"scenes":[{"id":"scene_001", "title":title,"description":"画面", "duration":8,"usePreviousLastFrameAsFirstFrame":true}],"characters":[{"name":"甲","description":"临时描述"},{"name":"乙"}]});
        let plan = json!({"title":"本集","characters":[{"name":"甲","description":"稳定外观"}]});
        let result = merge_batches(vec![(1, batch("后")), (0, batch("前"))], &plan, &json!({})).unwrap();
        assert_eq!(result["scenes"][0]["title"], "前");
        assert_eq!(result["scenes"][1]["id"], "scene_002");
        assert_eq!(
            result["scenes"][1]["usePreviousLastFrameAsFirstFrame"],
            false
        );
        assert_eq!(result["characters"].as_array().unwrap().len(), 2);
        assert_eq!(result["characters"][0]["description"], "稳定外观");
    }
}
