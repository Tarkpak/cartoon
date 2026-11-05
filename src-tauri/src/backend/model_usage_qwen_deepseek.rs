use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_official_price_cases() {
        let cases: Value = serde_json::from_str(include_str!("../../../shared/qwen-deepseek-pricing-cases.json")).unwrap();
        for entry in cases.as_array().unwrap() {
            assert_eq!(estimate(entry["provider"].as_str().unwrap(), entry["model"].as_str().unwrap(), entry["operation"].as_str().unwrap(), entry).map(|v|v.0), entry["expected"].as_i64(), "case: {entry}");
        }
    }
    #[test]
    fn captures_native_media_and_skips_nonterminal_video() {
        let endpoint = Some("https://dashscope.aliyuncs.com/api/v1/tasks/task-a");
        let video = r#"{"output":{"task_id":"task-a","task_status":"SUCCEEDED"},"usage":{"output_video_duration":10,"input_video_duration":3,"SR":720}}"#;
        let usage = capture_media("qwen", "wan3.0-video", "generateVideo", endpoint, None, Some(video)).unwrap();
        assert_eq!(usage["costNanoCny"], 7_800_000_000i64);
        assert!(usage["totalTokens"].is_null());
        assert_eq!(usage["billingUnit"], "seconds");
        assert!(capture_media("qwen", "wan3.0-video", "generateVideo", endpoint, None, Some(r#"{"output":{"task_id":"task-a","task_status":"RUNNING"}}"#)).is_none());
        let a = seedance::event_id("qwen", endpoint, Some("a"), &usage).unwrap();
        assert_eq!(a, seedance::event_id("qwen", endpoint, Some("a"), &usage).unwrap());
        assert_ne!(a, seedance::event_id("qwen", endpoint, Some("b"), &usage).unwrap());
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let record = json!({"id":a,"createdAt":"2026-11-05T00:00:00Z","provider":"qwen","usage":usage});
        save(&conn, &record, Some("a")).unwrap();
        save(&conn, &record, Some("a")).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM model_usage_records", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
        let image = capture_media("qwen", "qwen-image-2.1-pro", "generateImage", endpoint, None, Some(r#"{"usage":{"image_count":2}}"#)).unwrap();
        assert_eq!(image["costNanoCny"], 500_000_000);
        assert_eq!(image["usageStatus"], "reported");
        assert!(capture_media("qwen", "qwen-image-2.1-pro", "generateImage", endpoint, None, Some("{}")).unwrap()["costNanoCny"].is_null());
    }
    #[test]
    fn text_json_and_sse_cache_usage() {
        let qwen = capture("qwen", "qwen3.7-plus", "generateText", Some("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"), Some("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1000,\"completion_tokens\":100,\"prompt_tokens_details\":{\"cached_tokens\":500}}}\n\ndata: [DONE]")).unwrap();
        assert_eq!(qwen["costNanoCny"], 2_000_000);
        let deepseek = capture("deepseek", "deepseek-v4-pro", "generateText", None, Some(r#"{"usage":{"prompt_tokens":1000,"completion_tokens":100,"prompt_cache_hit_tokens":500,"prompt_cache_miss_tokens":500}}"#)).unwrap();
        assert_eq!(deepseek["cachedTokens"], 500);
        assert_eq!(deepseek["costNanoCny"], 7_350_000);
        assert!(deepseek["costNanoUsd"].is_null());
        assert_eq!(deepseek["currency"], "CNY");
        assert_eq!(deepseek["totalTokens"], 1100);
        assert_eq!(capture("deepseek", "deepseek-v4-pro", "generateText", None, None).unwrap()["usageStatus"], "unknown");
        assert_eq!(region(Some("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1")), "cn-beijing");
        assert_eq!(region(Some("https://dashscope.aliyuncs.com.evil.example/api/v1")), "unknown");
    }
}

fn catalog() -> &'static Value {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../../shared/qwen-deepseek-pricing.json")).expect("Qwen / DeepSeek pricing catalog"))
}

pub(super) fn region(endpoint: Option<&str>) -> &'static str {
    let host = endpoint.and_then(|v| url::Url::parse(v).ok()).and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
    if host == "dashscope.aliyuncs.com" || host.ends_with(".cn-beijing.maas.aliyuncs.com") { "cn-beijing" } else { "unknown" }
}

pub(super) fn estimate(provider: &str, model: &str, operation: &str, usage: &Value) -> Option<(i64, Value)> {
    if !matches!(provider, "qwen" | "deepseek") { return None; }
    if provider == "qwen" && usage["pricingRegion"] != "cn-beijing" { return None; }
    let model = normalize_model_id_for_remote(model);
    let c = catalog();
    let mut basis = "official-list-price";
    let cost: i128 = if operation == "generateText" {
        let input = usage["inputTokens"].as_i64().filter(|v| *v >= 0)?;
        let output = usage["outputTokens"].as_i64().filter(|v| *v >= 0)?;
        let cached = usage["cachedTokens"].as_i64().filter(|v| *v >= 0 && *v <= input)?;
        if usage["cacheWriteTokens"].as_i64().unwrap_or(0) > 0 || !matches!(usage["serviceTier"].as_str().unwrap_or("default"), "default" | "standard") { return None; }
        let row = c[provider][&model].as_array()?.iter().find(|r| r[0].as_i64().is_some_and(|max| input <= max))?;
        let cache_rate = if cached == 0 { 0 } else { row[2].as_i64()? };
        if provider == "deepseek" { basis = "official-peak-reference"; }
        (input - cached) as i128 * row[1].as_i64()? as i128 + cached as i128 * cache_rate as i128 + output as i128 * row[3].as_i64()? as i128
    } else if provider == "qwen" && operation == "generateImage" {
        let row = &c["imageNanoCny"][&model];
        let rate_in = row[0].as_i64()?;
        let input = if rate_in == 0 { 0 } else { usage["inputImages"].as_i64().filter(|v| *v >= 0)? };
        let output = usage["outputImages"].as_i64().filter(|v| *v >= 0)?;
        input as i128 * rate_in as i128 + output as i128 * row[1].as_i64()? as i128
    } else if provider == "qwen" && operation == "generateVideo" && usage["videoStatus"] == "SUCCEEDED" {
        let output = usage["durationSeconds"].as_f64().filter(|v| v.is_finite() && *v >= 0.0)?;
        let input = if model.starts_with("wan3.0-video") { usage["inputVideoSeconds"].as_f64().filter(|v| v.is_finite() && *v >= 0.0)? } else { 0.0 };
        let rate = c["videoNanoCnyPerSecond"][&model][usage["resolution"].as_str()?].as_i64()?;
        ((input + output) * rate as f64).round() as i128
    } else { return None; };
    if !(0..=9_007_199_254_740_991).contains(&cost) { return None; }
    Some((cost as i64, json!({"version":c["version"],"source":c["sources"][provider],"model":model,"currency":"CNY","basis":basis,"region":usage["pricingRegion"]})))
}

pub(super) fn price(provider: &str, model: &str, operation: &str, usage: &mut Value) {
    if let Some((cost, snapshot)) = estimate(provider, model, operation, usage) {
        usage["costNanoCny"] = json!(cost);
        usage["costNanoUsd"] = Value::Null;
        usage["currency"] = json!("CNY");
        usage["priceSnapshot"] = snapshot;
        usage["pricingStatus"] = json!("priced");
    }
}

pub(crate) fn capture_media(provider: &str, model: &str, operation: &str, endpoint: Option<&str>, request: Option<&Value>, raw: Option<&str>) -> Option<Value> {
    if provider != "qwen" || !matches!(operation, "generateImage" | "generateVideo" | "textToSpeech") { return None; }
    let payload = raw.and_then(usage_payload).unwrap_or(Value::Null);
    let request = request.unwrap_or(&Value::Null);
    let raw_usage = &payload["usage"];
    let status = payload["output"]["task_status"].as_str().unwrap_or("");
    // A task submission or polling HTTP error is not a completed generation.
    if operation == "generateVideo" && !matches!(status, "SUCCEEDED" | "FAILED" | "CANCELED") { return None; }
    let images = number(raw_usage, &["/image_count"]);
    let input_images = request["input"]["messages"].as_array().map(|messages| messages.iter().filter_map(|m| m["content"].as_array()).flatten().filter(|v| v.get("image").is_some()).count());
    let seconds = raw_usage["output_video_duration"].as_f64().or_else(|| raw_usage["duration"].as_f64()).filter(|v| v.is_finite() && *v >= 0.0);
    let input_seconds = raw_usage["input_video_duration"].as_f64().filter(|v| v.is_finite() && *v >= 0.0);
    let characters = number(raw_usage, &["/characters"]);
    let resolution = raw_usage["SR"].as_i64().map(|v| format!("{v}P"));
    let model = payload["model"].as_str().or(request["model"].as_str()).unwrap_or(model);
    let mut usage = json!({"usageStatus":if images.is_some() || seconds.is_some() || characters.is_some(){"reported"}else{"unknown"},
      "inputTokens":null,"outputTokens":null,"totalTokens":null,"cachedTokens":0,"model":model,"currency":"CNY","costNanoUsd":null,"costNanoCny":null,
      "pricingStatus":"unsupported_pricing","priceSnapshot":null,"pricingRegion":region(endpoint),"rawUsage":raw_usage,
      "billingUnit":match operation {"generateImage"=>"images","generateVideo"=>"seconds",_=>"characters"},
      "inputImages":input_images,"outputImages":images,"durationSeconds":seconds,"inputVideoSeconds":input_seconds,"characters":characters,
      "resolution":resolution,"videoStatus":if operation=="generateVideo"{json!(status)}else{Value::Null},
      "upstreamId":if operation=="generateVideo"{payload["output"]["task_id"].clone()}else{payload["request_id"].clone()}});
    price(provider, model, operation, &mut usage);
    Some(usage)
}
