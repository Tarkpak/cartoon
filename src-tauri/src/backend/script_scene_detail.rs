//! Small, bounded description-only passes after story/asset planning. A failed
//! pass never partially changes the result or falls back to the rough version.
use super::*;
use futures_util::StreamExt;
use regex::Regex;
use std::sync::OnceLock;

const GROUP_SIZE: usize = 3;
const CONCURRENCY: usize = 3;
const RULES: &str = include_str!("../../assets/default-prompts/script_scene_detail.txt");
pub(super) const INITIAL_RULES: &str = "\n\n【逐镜执行细节】\n每镜按用户指定格式写完整执行说明：明确出镜主体及相对站位/视线，动作的起始、过程和收束，景别/机位/运镜/对焦与光线，原话对应的时间段、语速停顿及声音衔接。固定镜头也应交代状态如何延续，不以‘自然表演’或‘同上’代替细节。时间轴从0秒连续覆盖本镜duration，子动作可以细分但不机械切镜。只展开原有动作，不扩写剧情、不增加时长，不以字数凑篇幅。紧凑JSON只指序列化，不得压缩description的执行细节。";

pub(super) fn director(conn: &rusqlite::Connection) -> Result<String, ApiError> {
    let preference = get_prompt_director_preferences(conn)?;
    Ok(if preference.trim().is_empty() {
        default_prompt_director_preferences().to_string()
    } else {
        preference
    })
}

fn timeline_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?m)^[^\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-—–~～至到]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)").unwrap())
}

fn validate_description(scene: &Value, description: &str) -> Result<(), String> {
    let duration = scene
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or("原分镜时长无效")?;
    let mut end = 0.0;
    let mut count = 0;
    for capture in timeline_regex().captures_iter(description) {
        let start = capture[1].parse::<f64>().map_err(|_| "时间轴起点无效")?;
        let next = capture[2].parse::<f64>().map_err(|_| "时间轴终点无效")?;
        if (start - end).abs() > 0.05 || next <= start || next > duration + 0.05 {
            return Err(format!(
                "时间轴必须从0秒连续覆盖{duration}秒，不得跳段、重叠或延长"
            ));
        }
        end = next;
        count += 1;
    }
    if count == 0 || (end - duration).abs() > 0.05 {
        return Err(format!("时间轴必须逐段独立起行，并完整覆盖0至{duration}秒"));
    }
    let result = json!({"scenes":[{"description":description}]});
    // Preserve quoted dialogue already assigned to this scene, including speech
    // embedded within prose rather than Markdown speaker lines.
    static QUOTES: OnceLock<Regex> = OnceLock::new();
    let quotes = QUOTES.get_or_init(|| Regex::new(r#"[“「『‘"]([^”」』’"\n]+)[”」』’"]"#).unwrap());
    let original = scene
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let spoken = quotes
        .captures_iter(original)
        .map(|capture| format!("**台词**：{}", &capture[1]))
        .collect::<Vec<_>>()
        .join("\n");
    script_parse_pipeline::validate_dialogue(&result, &spoken)?;
    if let Some(narration) = scene
        .get("narration")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        script_parse_pipeline::validate_dialogue(&result, &format!("**旁白**：{narration}"))?;
    }
    Ok(())
}

fn prompt(scenes: &[Value], start: usize, body: &Value, director: &str) -> String {
    let inputs = scenes
        .iter()
        .enumerate()
        .map(|(offset, scene)| json!({"index":start + offset + 1,"scene":scene}))
        .collect::<Vec<_>>();
    format!("【项目画风】\n{}\n\n【用户分镜描述风格（保留其排版与创作要求）】\n{director}\n\n{RULES}\n\n【待细化场景：事实、出镜、资产及总时长均已确定】\n{}",
        json_string(body.get("style"), "沿用原描述"), json!(inputs))
}

fn groups(
    scenes: &[Value],
    body: &Value,
    director: &str,
    input_budget: usize,
) -> Result<Vec<(usize, usize, String)>, String> {
    let mut groups = Vec::new();
    let mut start = 0;
    while start < scenes.len() {
        let mut end = (start + GROUP_SIZE).min(scenes.len());
        loop {
            let request = prompt(&scenes[start..end], start, body, director);
            if context_budget::check_with_limit(&request, input_budget).is_ok() || end == start + 1
            {
                context_budget::check_with_limit(&request, input_budget)?;
                groups.push((start, end, request));
                break;
            }
            end -= 1;
        }
        start = end;
    }
    Ok(groups)
}

fn patches(
    output: Value,
    scenes: &[Value],
    start: usize,
    end: usize,
) -> Result<Vec<(usize, String)>, String> {
    let items = output
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|items| items.len() == end - start)
        .ok_or("细化结果分镜数量与输入不一致")?;
    let mut patches = Vec::new();
    for item in items {
        let index = item
            .get("index")
            .and_then(Value::as_u64)
            .filter(|index| *index > start as u64 && *index <= end as u64)
            .ok_or("细化结果引用了未知分镜序号")? as usize
            - 1;
        if patches.iter().any(|(existing, _)| *existing == index) {
            return Err("细化结果包含重复分镜序号".into());
        }
        let description = item
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or("细化结果缺少完整描述")?;
        validate_description(&scenes[index], description)
            .map_err(|error| format!("第{}镜：{error}", index + 1))?;
        patches.push((index, description.to_string()));
    }
    Ok(patches)
}

fn progress(completed: usize, total: usize) {
    let _ = TEXT_STREAM_PROGRESS.try_with(|sender| sender.send_replace(json!({
        "type":"progress", "payload":{
            "step":"refining_details", "message":format!("正在完善逐镜动作、空间与台词节奏：{completed}/{total}批"),
            "progress":75 + completed * 20 / total.max(1), "chunkIndex":completed,"chunkCount":total
        }
    })));
}

/// Resolve installed skills once per execution; retain the existing bounded
/// generation and structural validation as the authoritative implementation.
pub(super) async fn run<F, Fut>(
    state: &BackendState,
    value: Value,
    body: &Value,
    director: &str,
    generate: F,
) -> Result<Value, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let mut execution =
        super::super::skills::begin(state, body, "scene_detail").map_err(|e| e.message)?;
    if execution.skills.is_empty() {
        execution
            .finish("skipped", json!({"message":"本项目未启用分镜细化技能"}))
            .map_err(|e| e.message)?;
        return Ok(value);
    }
    let instructions = execution.instructions();
    // Keep the original scene/director allowance; add only the validated skill
    // context. This does not expand budgets for parsing or unrelated workflows.
    let input_budget = context_budget::INPUT_BUDGET + instructions.len();
    let director = format!("{director}\n{instructions}");
    let result = CURRENT_MODEL_LOG_CONTEXT
        .scope(
            execution.model_log_context(),
            refine_with_budget(value, body, &director, input_budget, generate),
        )
        .await;
    match &result {
        Ok(value) => {
            let scenes = value.get("data").unwrap_or(value)["scenes"].as_array();
            execution.finish("succeeded", json!({"sceneCount":scenes.map(Vec::len).unwrap_or(0),"message":"已完成描述细化，时间轴与对白校验通过"})).map_err(|e| e.message)?;
        }
        Err(error) => {
            execution
                .finish(
                    "failed",
                    json!({"message": error.chars().take(500).collect::<String>()}),
                )
                .map_err(|e| e.message)?;
        }
    }
    result
}

#[cfg(test)]
async fn refine<F, Fut>(
    value: Value,
    body: &Value,
    director: &str,
    generate: F,
) -> Result<Value, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    refine_with_budget(
        value,
        body,
        director,
        context_budget::INPUT_BUDGET,
        generate,
    )
    .await
}

async fn refine_with_budget<F, Fut>(
    mut value: Value,
    body: &Value,
    director: &str,
    input_budget: usize,
    generate: F,
) -> Result<Value, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    let scenes = value
        .get("data")
        .unwrap_or(&value)
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|scenes| !scenes.is_empty())
        .ok_or("分镜列表为空，无法细化")?;
    let groups = groups(scenes, body, director, input_budget)?;
    let total = groups.len();
    progress(0, total);
    let tasks = groups.into_iter().map(|(start, end, prompt)| {
        let generate = &generate;
        async move {
            let mut error = String::new();
            for attempt in 0..2 {
                let request = if attempt == 0 {
                    prompt.clone()
                } else {
                    format!("{prompt}\n上次细化未通过校验：{error}。请修正并完整返回本组所有描述。")
                };
                context_budget::check_with_limit(&request, input_budget)?;
                // Isolate token events so concurrent calls cannot reset aggregate progress.
                let (sender, _receiver) = tokio::sync::watch::channel(Value::Null);
                let mut context = current_model_log_context();
                if let Some(skill) = context.skill_context.as_mut() {
                    skill["batchStart"] = json!(start + 1);
                    skill["batchEnd"] = json!(end);
                    skill["attempt"] = json!(attempt + 1);
                }
                let result = CURRENT_MODEL_LOG_CONTEXT
                    .scope(context, async {
                        TEXT_STREAM_PROGRESS.scope(sender, generate(request)).await
                    })
                    .await;
                match result.and_then(|output| patches(output, scenes, start, end)) {
                    Ok(patches) => return Ok(patches),
                    Err(failure) => error = failure,
                }
            }
            Err(format!(
                "第{}至{}镜细化失败（已重试）：{error}",
                start + 1,
                end
            ))
        }
    });
    let mut pending = stream::iter(tasks).buffer_unordered(CONCURRENCY);
    let mut replacements = Vec::new();
    let mut completed = 0;
    while let Some(result) = pending.next().await {
        replacements.extend(result?);
        completed += 1;
        progress(completed, total);
    }
    drop(pending);
    let data = if value.get("data").is_some() {
        &mut value["data"]
    } else {
        &mut value
    };
    for (index, description) in replacements {
        data["scenes"][index]["description"] = json!(description);
    }
    // Also retain the original source-order guarantee across group boundaries.
    script_parse_pipeline::validate_dialogue(&value, &json_string(body.get("text"), ""))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scene() -> Value {
        json!({"id":"scene_a","title":"熟客","description":"0-5秒，老板娘说：“老样子，五十。”\n5-12秒，主人公点头。旁白：“我吃了三年。”", "duration":12,
            "characters":[{"name":"主人公","assetId":"char:1"},{"name":"老板娘","assetId":"char:2"}],
            "setting":{"location":"原炒鸡摊","timeOfDay":"深夜"},"props":[{"name":"饭盒"}],"narration":"我吃了三年。"})
    }

    const DETAIL: &str = "0—4.6秒｜中景双人镜头。主人公在台外左前景，老板娘在右后景台内；机位位于同轴侧前方，平视固定，摊灯从右上方照亮两人。老板娘先照看锅内，再抬眼说：‘老样子，五十。’主人公先听完，不抢话，锅铲声在对白时减弱。\n4.6—8.2秒｜切主人公中近景，视线仍朝右侧画外老板娘，保持轴线和暖光方向。主人公轻轻点头，呼出一口气，肩膀缓缓下沉；画外旁白：‘我吃了三年。’嘴部不配合旁白，燃气灶低鸣延续。\n8.2—12秒｜延续中近景，不切镜。主人公放松后自然站定，只有呼吸和眨眼，目光仍落向老板娘方向，不新增接餐或离开的动作；旁白结束后留环境声。";

    #[test]
    fn accepts_fractional_beats_and_rejects_changed_timing_or_speech() {
        assert!(validate_description(&scene(), DETAIL).is_ok());
        assert!(
            validate_description(&scene(), &DETAIL.replace("0—4.6秒", "【镜头1】0—4.6秒")).is_ok()
        );
        for invalid in [
            DETAIL.replace("8.2—12", "9—12"),
            DETAIL.replace("8.2—12", "8.2—15"),
            DETAIL.replace("老样子，五十", "三十八"),
            DETAIL.replace("我吃了三年", "我吃了两年"),
            "普通概述".into(),
        ] {
            assert!(validate_description(&scene(), &invalid).is_err());
        }
        // A continuous take need not be split just to satisfy a shot-count quota.
        assert!(validate_description(
            &json!({"duration":4,"description":"静物"}),
            "0-4s: 固定特写，茶杯居中，晨光从左侧照入，蒸汽缓缓升起；只保留室内底噪。"
        )
        .is_ok());
    }

    #[test]
    fn rejects_missing_duplicate_and_foreign_scene_indices() {
        let scenes = vec![scene(), scene()];
        for output in [
            json!({"scenes":[]}),
            json!({"scenes":[{"index":0,"description":DETAIL}]}),
            json!({"scenes":[{"index":3,"description":DETAIL}]}),
            json!({"scenes":[{"index":1,"description":DETAIL},{"index":1,"description":DETAIL}]}),
        ] {
            assert!(patches(output, &scenes, 0, 2).is_err());
        }
    }

    #[tokio::test]
    async fn replaces_only_descriptions_and_preserves_every_planning_field() {
        let original = json!({"data":{"characters":[{"id":"char:1","name":"主人公"}],"scenes":[scene()]},"title":"测试"});
        let result = refine(original.clone(), &json!({"text":"老板娘：“老样子，五十。”"}), "自定义布局", |request| {
            assert!(request.contains("自定义布局"));
            std::future::ready(Ok(json!({"scenes":[{"index":1,"description":DETAIL,"duration":99,"characters":[]}]})))
        }).await.unwrap();
        let mut expected = original;
        expected["data"]["scenes"][0]["description"] = json!(DETAIL);
        assert_eq!(result, expected);
    }

    #[tokio::test]
    async fn retries_a_failed_group_once_and_never_accepts_an_incomplete_result() {
        let calls = AtomicUsize::new(0);
        let result = refine(json!({"scenes":[scene()]}), &json!({}), "", |request| {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            if call == 1 {
                assert!(request.contains("上次细化未通过校验"));
            }
            std::future::ready(Ok(if call == 0 {
                json!({"scenes":[]})
            } else {
                json!({"scenes":[{"index":1,"description":DETAIL}]})
            }))
        })
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(result["scenes"][0]["duration"], 12);
        calls.store(0, Ordering::SeqCst);
        assert!(refine(json!({"scenes":[scene()]}), &json!({}), "", |_| {
            calls.fetch_add(1, Ordering::SeqCst);
            std::future::ready(Err("上游断线".into()))
        })
        .await
        .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn bounds_concurrency_and_keeps_source_order_when_calls_finish_out_of_order() {
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let input = json!({"scenes":(0..10).map(|index| json!({"id":index,"description":"静物","duration":4})).collect::<Vec<_>>()});
        let result = refine(input, &json!({}), "", |request| {
            let active = &active;
            let peak = &peak;
            async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(count, Ordering::SeqCst);
                let inputs: Vec<Value> = serde_json::from_str(request.rsplit_once('\n').unwrap().1).unwrap();
                tokio::time::sleep(Duration::from_millis(12 - inputs[0]["index"].as_u64().unwrap())).await;
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(json!({"scenes":inputs.into_iter().rev().map(|item| json!({"index":item["index"],"description":format!("0-4秒｜固定镜头，静物{}居中，保持晨光和室内底噪。",item["index"])})).collect::<Vec<_>>()}))
            }
        }).await.unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), CONCURRENCY);
        for (index, scene) in result["scenes"].as_array().unwrap().iter().enumerate() {
            assert_eq!(scene["id"], index);
            assert!(scene["description"]
                .as_str()
                .unwrap()
                .contains(&format!("静物{}", index + 1)));
        }
    }

    #[tokio::test]
    async fn final_failure_cancels_other_groups_without_detached_calls() {
        use std::sync::Arc;
        struct Guard(Arc<AtomicUsize>);
        impl Drop for Guard {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let active = Arc::new(AtomicUsize::new(0));
        let input = json!({"scenes":(0..10).map(|_| scene()).collect::<Vec<_>>()});
        let result = refine(input, &json!({}), "", |request| {
            let active = active.clone();
            async move {
                active.fetch_add(1, Ordering::SeqCst);
                let _guard = Guard(active);
                let inputs: Vec<Value> = serde_json::from_str(
                    request.lines().find(|line| line.starts_with('[')).unwrap(),
                )
                .unwrap();
                let first_group = inputs[0]["index"] == 1;
                tokio::time::sleep(Duration::from_millis(if first_group { 1 } else { 100 })).await;
                Err("上游失败".to_string())
            }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn splits_large_groups_without_truncating_any_scene() {
        let large = json!({"description":"画面".repeat(4000),"duration":12});
        let scenes = vec![large.clone(), large.clone(), large];
        let groups = groups(&scenes, &json!({}), "", context_budget::INPUT_BUDGET).unwrap();
        assert_eq!(groups.len(), 3);
        assert!(groups
            .iter()
            .all(|(_, _, prompt)| prompt.contains(&"画面".repeat(4000))));
        assert!(super::groups(
            &[json!({"description":"x".repeat(context_budget::INPUT_BUDGET)})],
            &json!({}),
            "",
            context_budget::INPUT_BUDGET
        )
        .is_err());
    }
    #[tokio::test]
    async fn skill_log_context_tracks_concurrent_batches_and_retries() {
        let fixture = super::super::super::skills::tests::Fixture::new();
        let captured = std::sync::Mutex::new(Vec::new());
        let scenes = (0..4)
            .map(|_| json!({"duration":8,"description":"抬头"}))
            .collect::<Vec<_>>();
        run(&fixture.0,json!({"scenes":scenes}),&json!({"projectId":"p"}),"",|_| {
            let context = current_model_log_context();
            let skill = context.skill_context.unwrap();
            assert_eq!(context.project_id.as_deref(),Some("p"));
            captured.lock().unwrap().push(skill.clone());
            async move {
                let start = skill["batchStart"].as_u64().unwrap();
                let end = skill["batchEnd"].as_u64().unwrap();
                if start == 1 && skill["attempt"] == 1 { return Err("retry fixture".into()); }
                Ok(json!({"scenes":(start..=end).map(|index|json!({"index":index,"description":"0–8秒：主体缓慢抬头，固定中景。"})).collect::<Vec<_>>()}))
            }
        }).await.unwrap();
        let contexts = captured.into_inner().unwrap();
        assert_eq!(contexts.len(), 3);
        assert!(contexts
            .iter()
            .all(|c| c["runId"] == contexts[0]["runId"] && c["skills"][0]["name"] == "分镜细化"));
        assert!(contexts
            .iter()
            .any(|c| c["batchStart"] == 1 && c["attempt"] == 2));
        assert!(contexts
            .iter()
            .any(|c| c["batchStart"] == 4 && c["attempt"] == 1));
        assert!(current_model_log_context().skill_context.is_none());
    }

    #[tokio::test]
    async fn installed_large_skill_runs_without_consuming_scene_budget() {
        let fixture = super::super::super::skills::tests::Fixture::new();
        let Json(installed) = super::super::super::skills::api_install(
            State(fixture.0.clone()),
            Json(json!({"files": {
                "SKILL.md": "---\nname: writer\ndescription: writing\nstages: [scene_detail]\n---\n保持人物动作自然",
                "references/story.md": format!("{}完整参考结尾", "中".repeat(23000)),
                "scripts/check.py": "do_not_execute_or_inject",
                "agents/openai.yaml": "display_name: writer",
                "VERSION": "1.0"
            }})),
        ).await.unwrap();
        let id = installed["skill"]["id"].as_str().unwrap();
        let _ = super::super::super::skills::api_project_put(
            Path("p".into()),
            State(fixture.0.clone()),
            Json(json!({"selectedIds":[id]})),
        )
        .await
        .unwrap();
        let original = json!({"scenes":[{"duration":8,"description":"抬头"}]});
        let result = run(
            &fixture.0,
            original.clone(),
            &json!({"projectId":"p"}),
            "",
            |prompt| async move {
                assert!(prompt.len() > context_budget::INPUT_BUDGET);
                assert!(prompt.contains("完整参考结尾"));
                assert!(!prompt.contains("do_not_execute_or_inject"));
                Ok(json!({"scenes":[{"index":1,"description":"0–8秒：主体缓慢抬头，固定中景。"}]}))
            },
        )
        .await
        .unwrap();
        assert_eq!(result["scenes"][0]["duration"], 8);
        // Large skills do not remove the original scene/director limit.
        assert!(run(
            &fixture.0,
            original,
            &json!({"projectId":"p"}),
            &"x".repeat(context_budget::INPUT_BUDGET),
            |_| async {
                panic!("oversized scene context must not reach model");
                #[allow(unreachable_code)]
                Ok(Value::Null)
            }
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn skill_runner_injects_instructions_and_records_success_failure_and_skip() {
        let fixture = super::super::super::skills::tests::Fixture::new();
        let state = &fixture.0;
        let original =
            json!({"scenes":[{"id":"s1","duration":8,"description":"抬头","characters":["c1"]}]});
        let result = run(state, original.clone(), &json!({"projectId":"p"}), "导演要求", |prompt| async move {
            assert!(prompt.contains("【技能：分镜细化"));
            Ok(json!({"scenes":[{"index":1,"description":"0–8秒：主体缓慢抬头，固定中景，窗光照亮面部。"}]}))
        }).await.unwrap();
        assert_eq!(result["scenes"][0]["duration"], 8);
        assert_eq!(result["scenes"][0]["characters"], json!(["c1"]));
        assert!(run(
            state,
            original.clone(),
            &json!({"projectId":"p"}),
            "",
            |_| async { Err("fixture failure".into()) }
        )
        .await
        .is_err());
        let _ = super::super::super::skills::api_project_put(
            Path("p".into()),
            State(state.clone()),
            Json(json!({"selectedIds":[]})),
        )
        .await
        .unwrap();
        let skipped = run(
            state,
            original.clone(),
            &json!({"projectId":"p"}),
            "",
            |_| async {
                panic!("disabled skills must not call model");
                #[allow(unreachable_code)]
                Ok(Value::Null)
            },
        )
        .await
        .unwrap();
        assert_eq!(skipped, original);
        let Json(history) =
            super::super::super::skills::api_runs(Path("p".into()), State(state.clone()))
                .await
                .unwrap();
        let runs = history["runs"].as_array().unwrap();
        for status in ["succeeded", "failed", "skipped"] {
            assert!(runs.iter().any(|run| run["status"] == status));
        }
    }
}
