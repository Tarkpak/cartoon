use super::*;
#[path = "model_usage_instance.rs"]
mod instance;
#[path = "model_usage_queries.rs"]
mod queries;
pub(super) use queries::{export, get};

#[path = "model_usage_official.rs"]
mod official;
#[path = "model_usage_qwen_deepseek.rs"]
mod qwen_deepseek;
pub(super) use qwen_deepseek::capture_media as capture_qwen_media;
#[path = "model_usage_seedance.rs"]
mod seedance;
pub(super) use seedance::{capture as capture_seedance, event_id as seedance_event_id};

tokio::task_local! {
    static ATTEMPT: std::cell::RefCell<Option<Attempt>>;
}

pub(super) async fn track<F: std::future::Future>(future: F) -> F::Output {
    ATTEMPT.scope(std::cell::RefCell::new(None), future).await
}

struct Attempt {
    record: Value,
    owner: Option<String>,
}

impl Drop for Attempt {
    fn drop(&mut self) {
        // If a request future is cancelled, persist an unknown outcome rather than zero.
        if let Some(conn) = config_connection() {
            if let Err(error) = save(&conn, &self.record, self.owner.as_deref()) {
                eprintln!("未完成调用的用量记录保存失败: {error}");
            }
        }
    }
}

pub(super) fn begin(provider: &str, model: &str, operation: &str, endpoint: &str, creds: &Value) {
    let Some(usage) = capture(provider, model, operation, Some(endpoint), None) else {
        return;
    };
    let context = current_model_log_context();
    let owner = context
        .owner_user_id
        .or_else(|| config_connection().and_then(|conn| cloud_user_id(&conn)));
    let instance = instance::instance(provider, creds);
    let record = json!({"id":format!("log_{}",Uuid::new_v4().simple()),"createdAt":now_iso(),"requestId":current_request_id(),
        "projectId":context.project_id,"sceneId":context.scene_id,"taskId":context.task_id,
        "providerInstanceId":instance["id"],"providerInstanceName":instance["label"],
        "stage":context.skill_context.as_ref().and_then(|v|v["stage"].as_str()).unwrap_or(operation),
        "provider":provider,"model":model,"operation":operation,"status":"unknown","usage":usage});
    let _ = ATTEMPT.try_with(|slot| {
        *slot.borrow_mut() = Some(Attempt {
            record,
            owner,
        })
    });
}

pub(super) fn decorate(record: &mut Value) {
    if matches!(record["provider"].as_str(), Some("volcengine" | "qwen" | "deepseek")) {
        if let Some(conn)=config_connection() {
            let provider = record["provider"].as_str().unwrap();
            let instance=instance::instance(provider,&load_provider_creds(&conn));
            record["providerInstanceId"]=instance["id"].clone();
            record["providerInstanceName"]=instance["label"].clone();
            record["stage"]=record["operation"].clone();
        }
    }
    let _ = ATTEMPT.try_with(|slot| {
        if let Some(attempt) = slot.borrow().as_ref() {
            for key in ["providerInstanceId", "providerInstanceName", "stage"] {
                record[key] = attempt.record[key].clone();
            }
        }
    });
}

pub(super) fn attempt_id() -> Option<String> {
    ATTEMPT
        .try_with(|slot| {
            slot.borrow()
                .as_ref()
                .and_then(|a| a.record["id"].as_str().map(str::to_string))
        })
        .ok()
        .flatten()
}

pub(super) fn finish(record: &Value) {
    let _ = ATTEMPT.try_with(|slot| {
        if let Some(mut attempt) = slot.borrow_mut().take() {
            attempt.record = record.clone();
        }
    });
}

pub(super) fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS model_usage_records (
        id TEXT PRIMARY KEY, owner_user_id TEXT, created_at TEXT NOT NULL,
        request_id TEXT, project_id TEXT, task_id TEXT, provider TEXT NOT NULL,
        record_json TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_usage_owner_date ON model_usage_records(owner_user_id, created_at);")?;
    let has_synced: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('model_usage_records') WHERE name='synced'",
        [],
        |row| row.get(0),
    )?;
    if has_synced == 0 {
        conn.execute(
            "ALTER TABLE model_usage_records ADD COLUMN synced INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    let rows = {
        let mut stmt = conn.prepare("SELECT id,record_json FROM model_usage_records WHERE provider='openai' AND json_extract(record_json,'$.usage.costNanoUsd') IS NULL")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (id, raw) in rows {
        let Ok(mut record) = serde_json::from_str::<Value>(&raw) else { continue; };
        let usage = &mut record["usage"];
        // Older records retain raw usage locally; preserve extra-charge exclusions.
        usage["cacheWriteTokens"] = json!(number(&usage["rawUsage"], &["/prompt_tokens_details/cache_write_tokens", "/input_tokens_details/cache_write_tokens"]).unwrap_or(usage["cacheWriteTokens"].as_i64().unwrap_or(0)));
        usage["textOutputTokens"] = json!(number(&usage["rawUsage"], &["/output_tokens_details/text_tokens"]).unwrap_or(usage["textOutputTokens"].as_i64().unwrap_or(0)));
        if let Some((cost, snapshot)) = official::estimate(record["usage"]["model"].as_str().or(record["model"].as_str()).unwrap_or(""), record["operation"].as_str().unwrap_or(""), &record["usage"]) {
            record["usage"]["costNanoUsd"] = json!(cost);
            record["usage"]["priceSnapshot"] = snapshot;
            record["usage"]["pricingStatus"] = json!("priced");
            conn.execute("UPDATE model_usage_records SET record_json=?1,synced=0 WHERE id=?2", params![record.to_string(),id])?;
        }
    }
    Ok(())
}

// Read usage independently of content: the final SSE chunk may have no choices.
fn usage_payload(raw: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        return Some(value);
    }
    raw.lines()
        .filter_map(|line| {
            serde_json::from_str::<Value>(line.trim().strip_prefix("data:")?.trim()).ok()
        })
        .filter(|value| value.get("usage").is_some_and(Value::is_object))
        .last()
}

fn number(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        value
            .pointer(key)
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
    })
}

pub(super) fn capture(
    provider: &str,
    model: &str,
    operation: &str,
    endpoint: Option<&str>,
    raw: Option<&str>,
) -> Option<Value> {
    if provider == "qwen" && operation != "generateText" {
        return qwen_deepseek::capture_media(provider, model, operation, endpoint, None, raw);
    }
    if !matches!(provider, "openai" | "custom_openai" | "qwen" | "deepseek")
        || !matches!(operation, "generateText" | "generateImage")
    {
        return None;
    }
    let payload = raw.and_then(usage_payload).unwrap_or(Value::Null);
    let usage = &payload["usage"];
    let input = number(usage, &["/prompt_tokens", "/input_tokens"]);
    let output = number(usage, &["/completion_tokens", "/output_tokens"]);
    let cached = number(
        usage,
        &[
            "/prompt_tokens_details/cached_tokens",
            "/input_tokens_details/cached_tokens",
            "/prompt_cache_hit_tokens",
        ],
    )
    .unwrap_or(0);
    let reasoning = number(
        usage,
        &[
            "/completion_tokens_details/reasoning_tokens",
            "/output_tokens_details/reasoning_tokens",
        ],
    );
    let text_input = number(usage, &["/input_tokens_details/text_tokens"]);
    let image_input = number(usage, &["/input_tokens_details/image_tokens"]);
    let text_output = number(usage, &["/output_tokens_details/text_tokens"]).unwrap_or(0);
    let actual_model = payload["model"].as_str().unwrap_or(model);
    let tier = payload["service_tier"].as_str().unwrap_or("default");
    let cache_write = number(usage, &["/prompt_tokens_details/cache_write_tokens", "/input_tokens_details/cache_write_tokens"]).unwrap_or(0);
    let normalized = json!({"inputTokens":input,"outputTokens":output,"cachedTokens":cached,"textInputTokens":text_input,"imageInputTokens":image_input,"textOutputTokens":text_output,"cacheWriteTokens":cache_write,"serviceTier":tier});
    // OpenAI supplier uses the official reference price even behind a configured proxy.
    let estimate = (provider == "openai").then(|| official::estimate(actual_model, operation, &normalized)).flatten();
    let (cost, price) = estimate.map(|(cost, price)| (Some(cost),price)).unwrap_or((None,Value::Null));
    let reason = if input.is_none() || output.is_none() { "missing_usage" } else { "unsupported_pricing" };
    let mut result =
        json!({"usageStatus":if input.is_some() && output.is_some() {"reported"} else {"unknown"},
        "inputTokens":input,"outputTokens":output,"totalTokens":input.zip(output).and_then(|(i,o)| i.checked_add(o)),
        "cachedTokens":cached,"reasoningTokens":reasoning,"textInputTokens":text_input,"imageInputTokens":image_input,
        "textOutputTokens":text_output,"cacheWriteTokens":cache_write,
        "model":actual_model,"serviceTier":tier,"upstreamId":payload["id"],"rawUsage":usage,
        "costNanoUsd":cost,"costNanoCny":null,"currency":if provider=="qwen"{"CNY"}else{"USD"},"pricingRegion":qwen_deepseek::region(endpoint),"pricingStatus":if cost.is_some() {"priced"} else {reason},"priceSnapshot":price});
    qwen_deepseek::price(provider, actual_model, operation, &mut result);
    Some(result)
}

pub(super) fn save(conn: &Connection, record: &Value, owner: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO model_usage_records(id,owner_user_id,created_at,request_id,project_id,task_id,provider,record_json)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json
        WHERE model_usage_records.owner_user_id IS excluded.owner_user_id
        AND (json_extract(model_usage_records.record_json, '$.usage.usageStatus') != 'reported'
        OR (COALESCE(json_extract(model_usage_records.record_json,'$.usage.costNanoUsd'),json_extract(model_usage_records.record_json,'$.usage.costNanoCny')) IS NULL
            AND COALESCE(json_extract(excluded.record_json,'$.usage.costNanoUsd'),json_extract(excluded.record_json,'$.usage.costNanoCny')) IS NOT NULL))",
        params![record["id"].as_str(),owner,record["createdAt"].as_str(),record["requestId"].as_str(),record["projectId"].as_str(),record["taskId"].as_str(),record["provider"].as_str(),record.to_string()])?;
    Ok(())
}

fn db_error(error: rusqlite::Error) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

pub(super) async fn pull(state: &BackendState, base: &str, token: &str) -> Result<(), ApiError> {
    // Full pagination also recovers records whose associated debug logs were deleted.
    let owner = cloud_user_id(&db_connection(state)?)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "未登录"))?;
    let mut page = 1;
    loop {
        let response = cloud_data_request_json(
            base,
            reqwest::Method::GET,
            &format!("/api/client/model-usage?page={page}&pageSize=100"),
            Some(token),
            None,
        )
        .await?;
        let data = &response["data"];
        let conn = db_connection(state)?;
        if cloud_user_id(&conn).as_deref() != Some(owner.as_str()) {
            return Err(ApiError::new(StatusCode::UNAUTHORIZED, "账号已切换"));
        }
        if let Some(items) = data["records"].as_array() {
            for item in items {
                save(&conn, item, Some(&owner)).map_err(db_error)?;
                conn.execute(
                    "UPDATE model_usage_records SET synced=1 WHERE id=?1 AND owner_user_id=?2",
                    params![item["id"].as_str(), owner],
                )
                .map_err(db_error)?;
            }
        }
        if page >= data["totalPages"].as_i64().unwrap_or(1) {
            break;
        }
        page += 1;
    }
    Ok(())
}

pub(super) async fn push_pending(state: &BackendState) -> Result<(), ApiError> {
    let (base, token, owner, records) = {
        let conn = db_connection(state)?;
        let (Some(base), Some(token), Some(owner)) = (
            cloud_base_url(&conn),
            cloud_token(&conn),
            cloud_user_id(&conn),
        ) else {
            return Ok(());
        };
        let mut stmt=conn.prepare("SELECT record_json FROM model_usage_records WHERE owner_user_id=?1 AND synced=0 LIMIT 100").map_err(db_error)?;
        let rows = stmt
            .query_map(params![owner], |r| r.get::<_, String>(0))
            .map_err(db_error)?;
        let records = rows
            .filter_map(Result::ok)
            .filter_map(|s| serde_json::from_str::<Value>(&s).ok())
            .collect::<Vec<_>>();
        (base, token, owner, records)
    };
    if records.is_empty() {
        return Ok(());
    }
    cloud_request_json(
        &base,
        reqwest::Method::POST,
        "/api/client/model-usage",
        Some(&token),
        Some(json!({"records":records})),
    )
    .await?;
    let conn = db_connection(state)?;
    for record in records {
        conn.execute(
            "UPDATE model_usage_records SET synced=1 WHERE id=?1 AND owner_user_id=?2",
            params![record["id"].as_str(), owner],
        )
        .map_err(db_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn openai_proxy_and_unpriced_history_use_reference_prices() {
        let usage = capture("openai", "gpt-5", "generateText", Some("https://proxy.example/v1/chat/completions"), Some(r#"{"usage":{"prompt_tokens":1000,"completion_tokens":100}}"#)).unwrap();
        assert_eq!(usage["costNanoUsd"], 2_250_000);
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let mut record = json!({"id":"old","provider":"openai","model":"gpt-5","operation":"generateText","createdAt":"2026-11-05T00:00:00Z","usage":usage});
        record["usage"]["costNanoUsd"] = Value::Null;
        save(&conn, &record, Some("owner")).unwrap();
        init(&conn).unwrap();
        init(&conn).unwrap();
        let raw: String = conn.query_row("SELECT record_json FROM model_usage_records WHERE id='old'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["usage"]["costNanoUsd"], 2_250_000);
    }
    #[test]
    fn stream_usage_and_cached_cost() {
        let raw="data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10000,\"completion_tokens\":1000,\"prompt_tokens_details\":{\"cached_tokens\":8000},\"completion_tokens_details\":{\"reasoning_tokens\":400}}}\n\ndata: [DONE]";
        let u = capture(
            "openai",
            "gpt-4.1",
            "generateText",
            Some("https://api.openai.com/v1/chat/completions"),
            Some(raw),
        )
        .unwrap();
        assert_eq!(u["totalTokens"], 11000);
        assert_eq!(u["costNanoUsd"], 16000000);
    }
    #[test]
    fn missing_and_proxy_are_not_free() {
        let u = capture("openai", "gpt-4.1", "generateText", None, None).unwrap();
        assert_eq!(u["usageStatus"], "unknown");
        assert!(u["costNanoUsd"].is_null());
        let u = capture(
            "custom_openai",
            "gpt-4.1",
            "generateText",
            Some("https://proxy/v1/chat/completions"),
            Some(r#"{"usage":{"prompt_tokens":1,"completion_tokens":1}}"#),
        )
        .unwrap();
        assert_eq!(u["usageStatus"], "reported");
        assert!(u["costNanoUsd"].is_null());
    }
    #[test]
    fn image_modalities_and_idempotence() {
        let u=capture("openai","gpt-image-2","generateImage",Some("https://api.openai.com/v1/images/edits"),Some(r#"{"usage":{"input_tokens":30,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":20}}}"#)).unwrap();
        assert_eq!(u["costNanoUsd"], 3210000);
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let record =
            json!({"id":"one","createdAt":"2026-11-05T00:00:00Z","provider":"openai","usage":u});
        save(&conn, &record, Some("a")).unwrap();
        save(&conn, &record, Some("a")).unwrap();
        save(&conn, &record, Some("b")).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM model_usage_records", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT owner_user_id FROM model_usage_records", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "a"
        );
    }
}
