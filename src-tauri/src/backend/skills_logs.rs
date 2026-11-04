//! Durable, account-scoped skill execution telemetry. The body snapshot is also
//! the acknowledgement guard: an older upload cannot mark a newer state synced.
use super::*;

pub(in crate::backend) fn schedule(state: &BackendState) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        let state = state.clone();
        handle.spawn(async move {
            sync_pending(&state).await;
        });
    }
}

pub(in crate::backend) async fn sync_pending(state: &BackendState) {
    static SYNC: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    let Ok(_permit) = SYNC
        .get_or_init(|| tokio::sync::Semaphore::new(1))
        .try_acquire()
    else {
        return;
    };
    let pending = (|| -> Result<_, ApiError> {
        let conn = db_connection(state)?;
        let Some(owner) = cloud_user_id(&conn) else {
            return Ok(vec![]);
        };
        let mut stmt = conn.prepare("SELECT id, body, owner_user_id FROM skill_runs WHERE cloud_sync_status='pending' AND owner_user_id=?1 ORDER BY created_at LIMIT 100").map_err(|e| bad(e.to_string()))?;
        let rows = stmt
            .query_map(params![owner], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| bad(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| bad(e.to_string()))
    })();
    let Ok(pending) = pending else {
        return;
    };
    for (id, raw, owner) in pending {
        let credentials = db_connection(state).ok().and_then(|conn| {
            if cloud_user_id(&conn).as_deref() != Some(owner.as_str()) {
                return None;
            }
            Some((cloud_base_url(&conn)?, cloud_token(&conn)?))
        });
        let Some((base, token)) = credentials else {
            return;
        };
        let Ok(body) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if cloud_request_json(
            &base,
            reqwest::Method::POST,
            "/api/client/skill-runs",
            Some(&token),
            Some(body),
        )
        .await
        .is_err()
        {
            // Keep pending for the existing 30-second log retry loop.
            return;
        }
        if let Ok(conn) = db_connection(state) {
            let _ = acknowledge(&conn, &id, &raw, &owner);
        }
    }
}

fn acknowledge(conn: &Connection, id: &str, raw: &str, owner: &str) -> Result<usize, ApiError> {
    conn.execute("UPDATE skill_runs SET cloud_sync_status='synced' WHERE id=?1 AND body=?2 AND owner_user_id=?3", params![id,raw,owner]).map_err(|e| bad(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_upload_cannot_acknowledge_new_result_or_another_owner() {
        let fixture = super::super::tests::Fixture::new();
        let conn = db_connection(&fixture.0).unwrap();
        runs_table(&conn).unwrap();
        conn.execute("INSERT INTO skill_runs (id,project_id,created_at,body,owner_user_id,cloud_sync_status) VALUES ('run','p','now','finished','owner','pending')", []).unwrap();
        assert_eq!(acknowledge(&conn, "run", "running", "owner").unwrap(), 0);
        assert_eq!(acknowledge(&conn, "run", "finished", "other").unwrap(), 0);
        assert_eq!(acknowledge(&conn, "run", "finished", "owner").unwrap(), 1);
    }
    #[tokio::test]
    async fn skill_metadata_survives_cloud_pull_filters_and_owner_isolation() {
        let fixture = super::super::tests::Fixture::new();
        let state = BackendState {
            db_path: fixture.0.data_dir.join("logs.db"),
            ..fixture.0.clone()
        };
        init_database(&state).unwrap();
        let context = json!({"runId":"run-1","stage":"scene_detail","skills":[{"id":"writer","name":"human-writing","version":"v1"}],"batchStart":1,"batchEnd":3,"attempt":2});
        let logs = json!([
            {"id":"cloud-1","client_event_id":"local-1","user_id":"owner","provider":"openai","model_id":"test","operation":"generateText","status":"success","skill_context_json":context.to_string()},
            {"id":"cloud-2","user_id":"other","provider":"openai","model_id":"test","operation":"generateText","status":"success","skill_context_json":context.to_string()},
            {"id":"old","user_id":"owner","provider":"openai","model_id":"test","operation":"generateText","status":"success"}
        ]);
        assert_eq!(apply_cloud_model_call_logs(&state, &logs).unwrap(), 3);
        let conn = db_connection(&state).unwrap();
        set_config_json(
            &conn,
            CLOUD_ADMIN_SESSION_KEY,
            &json!({"token":"fixture","user":{"id":"owner","role":"user"}}),
        )
        .unwrap();
        let query = HashMap::from([
            ("skillRunId".into(), "run-1".into()),
            ("skill".into(), "human".into()),
        ]);
        let Json(result) = api_debug_logs_get(State(state.clone()), Query(query))
            .await
            .unwrap();
        assert_eq!(result["data"]["total"], 1);
        assert_eq!(result["data"]["logs"][0]["skillContext"], context);
        // An older server response must not erase an existing association.
        let mut old = logs[0].clone();
        old.as_object_mut().unwrap().remove("skill_context_json");
        apply_cloud_model_call_logs(&state, &json!([old])).unwrap();
        let Json(result) = api_debug_logs_get(
            State(state.clone()),
            Query(HashMap::from([("skillRunId".into(), "run-1".into())])),
        )
        .await
        .unwrap();
        assert_eq!(result["data"]["logs"][0]["skillContext"], context);
        let Json(result) = api_debug_logs_get(
            State(state),
            Query(HashMap::from([("skill".into(), "missing".into())])),
        )
        .await
        .unwrap();
        assert_eq!(result["data"]["total"], 0);
    }
}
