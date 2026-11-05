use super::*;

fn catalog() -> &'static Value {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../shared/seedance-pricing.json"))
            .expect("seedance pricing catalog")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_seedance_prices() {
        let cases: Value =
            serde_json::from_str(include_str!("../../../shared/seedance-pricing-cases.json"))
                .unwrap();
        for entry in cases.as_array().unwrap() {
            assert_eq!(
                estimate(entry["model"].as_str().unwrap(), entry).map(|v| v.0),
                entry["expected"].as_i64(),
                "case: {entry}"
            );
        }
    }
    #[test]
    fn captures_terminal_usage_deduplicates_and_separates_currencies() {
        let raw = r#"{"id":"task1","model":"doubao-seedance-2-0-260128","status":"succeeded","resolution":"720p","duration":5,"usage":{"completion_tokens":108900}}"#;
        let request = json!({"billing":{"hasVideoInput":false}});
        let usage = capture(
            "volcengine",
            "ep-alias",
            "generateVideo",
            Some(&request),
            Some(raw),
        )
        .unwrap();
        assert_eq!(usage["costNanoCny"], 5_009_400_000i64);
        assert!(usage["costNanoUsd"].is_null());
        assert!(capture(
            "volcengine",
            "doubao-seedance-2-0",
            "generateVideo",
            Some(&request),
            Some(r#"{"id":"task1","status":"running"}"#)
        )
        .is_none());
        assert!(
            capture("volcengine", "ep-alias", "generateVideo", None, Some(raw)).unwrap()
                ["costNanoCny"]
                .is_null()
        );
        let id = event_id(
            "volcengine",
            Some("https://ark.example/api/v3/tasks/task1?secret=key"),
            Some("alice"),
            &usage,
        )
        .unwrap();
        assert_eq!(
            Some(id.clone()),
            event_id(
                "volcengine",
                Some("https://ark.example/api/v3/tasks/task1"),
                Some("alice"),
                &usage
            )
        );
        assert_ne!(
            Some(id.clone()),
            event_id(
                "volcengine",
                Some("https://ark.example/api/v3/tasks/task1"),
                Some("bob"),
                &usage
            )
        );
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let record = json!({"id":id,"provider":"volcengine","model":"doubao-seedance-2-0","operation":"generateVideo","createdAt":"2026-11-05T00:00:00Z","usage":usage});
        save(&conn, &record, Some("alice")).unwrap();
        save(&conn, &record, Some("alice")).unwrap();
        save(&conn,&json!({"id":"usd","provider":"openai","createdAt":"2026-11-05T00:00:00Z","usage":{"usageStatus":"reported","costNanoUsd":100,"currency":"USD"}}),Some("alice")).unwrap();
        let mixed = queries::query_data(&conn, "alice", &HashMap::new()).unwrap();
        assert_eq!(mixed["total"]["calls"], 2);
        assert_eq!(mixed["total"]["costNanoUsd"], 100);
        assert_eq!(mixed["total"]["costNanoCny"], 5_009_400_000i64);
        let cny = queries::query_data(
            &conn,
            "alice",
            &HashMap::from([("currency".into(), "CNY".into())]),
        )
        .unwrap();
        assert_eq!(cny["total"]["calls"], 1);
        assert_eq!(cny["total"]["costNanoUsd"], 0);
        assert_eq!(cny["total"]["averageCostNanoCny"], 5_009_400_000i64);
        let csv = queries::csv(&conn, "alice", &HashMap::new()).unwrap();
        assert!(csv.contains("\"5.009400000\",\"CNY\""));
    }
}

pub(super) fn estimate(model: &str, usage: &Value) -> Option<(i64, Value)> {
    let normalized = normalize_model_id_for_remote(model)
        .to_lowercase()
        .replace(['.', '_'], "-");
    let (id, rules) = catalog()["models"].as_object()?.iter().find(|(id, _)| {
        normalized == **id
            || normalized.strip_prefix(id.as_str()).is_some_and(|s| {
                s.starts_with('-') && s.len() == 7 && s[1..].chars().all(|c| c.is_ascii_digit())
            })
    })?;
    let status = usage["videoStatus"].as_str()?;
    if !matches!(status, "succeeded" | "failed" | "cancelled" | "expired") {
        return None;
    }
    let failed = status != "succeeded";
    let tokens = if failed {
        0
    } else {
        usage["outputTokens"].as_i64().filter(|v| *v >= 0)?
    };
    let mode = match usage["serviceTier"].as_str().unwrap_or("default") {
        "default" | "online" => "online",
        "flex" | "offline" => "offline",
        _ => "",
    };
    let resolution = usage["resolution"].as_str().unwrap_or("").to_lowercase();
    let resolution = if resolution == "2160p" {
        "4k"
    } else {
        &resolution
    };
    let rates = rules[mode].get(resolution).or_else(|| rules[mode].get("*"));
    let has_video = usage["hasVideoInput"].as_bool();
    let rate = rates.and_then(|r| match has_video {
        Some(v) => r[usize::from(v)].as_f64(),
        None if r[0] == r[1] => r[0].as_f64(),
        _ => None,
    });
    if !failed && (rate.is_none() || usage["draftSourceUnknown"] == true) {
        return None;
    }
    let cost = if failed {
        0
    } else {
        (tokens as i128) * (rate? * 1000.0).round() as i128
    };
    if cost > 9_007_199_254_740_991 {
        return None;
    }
    Some((
        cost as i64,
        json!({"version":catalog()["version"],"source":catalog()["source"],"model":id,"currency":"CNY","rateCnyPerMillion":rate,"resolution":resolution,"hasVideoInput":has_video,"serviceTier":mode,"basis":if failed {"official-failed-no-charge"}else{"official-completion-tokens"}}),
    ))
}

pub(crate) fn capture(
    provider: &str,
    model: &str,
    operation: &str,
    request: Option<&Value>,
    raw: Option<&str>,
) -> Option<Value> {
    if provider != "volcengine" || operation != "generateVideo" {
        return None;
    }
    let payload = raw.and_then(usage_payload)?;
    let model = payload["model"]
        .as_str()
        .filter(|v| !v.starts_with("ep-"))
        .unwrap_or(model);
    if !model.to_lowercase().contains("seedance") {
        return None;
    }
    let status = payload["status"].as_str()?;
    if !matches!(status, "succeeded" | "failed" | "cancelled" | "expired") {
        return None;
    }
    let request = request.unwrap_or(&Value::Null);
    let tokens = if status == "succeeded" {
        number(&payload["usage"], &["/completion_tokens"])
    } else {
        Some(0)
    };
    let has_video = request["billing"]["hasVideoInput"].as_bool().or_else(|| {
        request["content"]
            .as_array()
            .map(|items| items.iter().any(|v| v["type"] == "video_url"))
    });
    let resolution = payload
        .get("resolution")
        .or_else(|| request["billing"].get("resolution"))
        .or_else(|| request.get("resolution"))
        .cloned()
        .unwrap_or(Value::Null);
    let tier = payload
        .get("service_tier")
        .or_else(|| request["billing"].get("serviceTier"))
        .or_else(|| request.get("service_tier"))
        .cloned()
        .unwrap_or(json!("default"));
    let mut usage = json!({"usageStatus":if tokens.is_some(){"reported"}else{"unknown"},"inputTokens":null,"outputTokens":tokens,"totalTokens":tokens,
      "model":model,"currency":"CNY","costNanoUsd":null,"costNanoCny":null,"pricingStatus":"unsupported_pricing","videoStatus":status,
      "resolution":resolution,"hasVideoInput":has_video,"serviceTier":tier,"upstreamId":payload["id"],"rawUsage":payload["usage"],
      "durationSeconds":payload["duration"],"draftSourceUnknown":request["billing"]["draftSourceUnknown"].as_bool().unwrap_or(false),"priceSnapshot":null});
    if let Some((cost, snapshot)) = estimate(model, &usage) {
        usage["costNanoCny"] = json!(cost);
        usage["priceSnapshot"] = snapshot;
        usage["pricingStatus"] = json!("priced");
    }
    Some(usage)
}

pub(crate) fn event_id(
    provider: &str,
    endpoint: Option<&str>,
    owner: Option<&str>,
    usage: &Value,
) -> Option<String> {
    let task = usage["upstreamId"].as_str().filter(|v| !v.is_empty())?;
    let mut endpoint = url::Url::parse(endpoint?).ok()?;
    let _ = endpoint.set_username("");
    let _ = endpoint.set_password(None);
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    let key = json!([provider, endpoint.as_str(), owner, task]).to_string();
    Some(format!(
        "log_seedance_{}",
        hex::encode(Sha256::digest(key.as_bytes()))
    ))
}
