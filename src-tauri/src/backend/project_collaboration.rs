use super::*;

fn collaboration_lease_key(id: &str, session_id: &str, kind: &str, resource_id: &str) -> String {
    // JSON tuples avoid collisions between IDs containing separators.
    format!(
        "project_collaboration_lease:{}",
        json!([id, session_id, kind, resource_id])
    )
}

fn ensure_collaboration_account(conn: &Connection, user_id: &str) -> Result<(), ApiError> {
    if current_project_owner_context(conn)?.user_id != user_id {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "账号已切换，请重新加载协作项目",
        ));
    }
    Ok(())
}

fn collaboration_scope(body: &Value) -> Result<(&str, &str), ApiError> {
    let kind = body.get("type").and_then(Value::as_str).unwrap_or("");
    let id = body.get("id").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "settings" | "directory" | "episode" | "character")
        || id.is_empty()
        || id.trim() != id
        || id.chars().count() > 128
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "协作对象标识无效"));
    }
    Ok((kind, id))
}

pub(super) fn collaboration_error_details(payload: &Value) -> Option<Value> {
    let data = payload.get("data")?;
    let (kind, id) = collaboration_scope(data).ok()?;
    let mut details = json!({"type": kind, "id": id});
    if let Some(revision) = data.get("revision").and_then(Value::as_u64) {
        details["revision"] = json!(revision);
    }
    if let Some(deleted) = data.get("deleted").and_then(Value::as_bool) {
        details["deleted"] = json!(deleted);
    }
    Some(details)
}

fn scoped_lease_token(
    conn: &Connection,
    id: &str,
    session_id: &str,
    kind: &str,
    resource_id: &str,
) -> Result<String, ApiError> {
    let cached = get_config_json(
        conn,
        &collaboration_lease_key(id, session_id, kind, resource_id),
    )?
    .unwrap_or(Value::Null);
    cached
        .get("token")
        .and_then(Value::as_str)
        .filter(|_| {
            cached.get("expiresAt").and_then(Value::as_i64).unwrap_or(0)
                > Utc::now().timestamp_millis()
        })
        .map(str::to_string)
        .ok_or_else(|| {
            let mut error = ApiError::new(
                StatusCode::LOCKED,
                "该集或资源的编辑权已失效，请重新取得编辑权",
            );
            error.data = Some(json!({"type": kind, "id": resource_id}));
            error
        })
}

fn remember_collaboration_mode(state: &BackendState, id: &str) -> Result<(), ApiError> {
    let conn = db_connection(state)?;
    set_config_json(
        &conn,
        &format!("project_collaboration_enabled:{id}"),
        &json!(true),
    )?;
    set_config_json(&conn, &format!("project_edit_session:{id}"), &json!({}))
}

// Learn the mode even when a snapshot is unchanged or local legacy edits prevent import.
// Never mark an unrelated project that happens to use the same local ID.
pub(super) fn remember_cloud_collaboration_mode(
    conn: &Connection,
    project: &Value,
) -> Result<(), ApiError> {
    if project.get("collaboration").and_then(Value::as_bool) != Some(true) {
        return Ok(());
    }
    let id = cloud_value_text(project, "localProjectId");
    let owner = cloud_value_text(project, "ownerUserId");
    if id.is_empty() || owner.is_empty() {
        return Ok(());
    }
    let matches: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND owner_user_id = ?2)",
            params![id, owner],
            |row| row.get(0),
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if matches {
        set_config_json(
            conn,
            &format!("project_collaboration_enabled:{id}"),
            &json!(true),
        )?;
        set_config_json(conn, &format!("project_edit_session:{id}"), &json!({}))?;
    }
    Ok(())
}

pub(super) fn require_legacy_project_mode(state: &BackendState, id: &str) -> Result<(), ApiError> {
    if get_config_json(
        &db_connection(state)?,
        &format!("project_collaboration_enabled:{id}"),
    )?
    .and_then(|value| value.as_bool())
        == Some(true)
    {
        return Err(ApiError::new(
            StatusCode::LOCKED,
            "项目已启用按集协作，请使用协作入口",
        ));
    }
    Ok(())
}

fn prepare_collaboration_write(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    session_id: &str,
    body: &mut Value,
) -> Result<(), ApiError> {
    let transaction = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    prepare_collaboration_write_locked(&transaction, user_id, id, session_id, body)?;
    transaction
        .commit()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn prepare_collaboration_write_locked(
    conn: &Connection,
    user_id: &str,
    id: &str,
    session_id: &str,
    body: &mut Value,
) -> Result<(), ApiError> {
    let operation_id = body
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.trim() == *value && value.chars().count() <= 128)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "协作操作 ID 无效"))?
        .to_string();
    let mutations = body
        .get_mut("mutations")
        .and_then(Value::as_array_mut)
        .filter(|items| !items.is_empty() && items.len() <= 100)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "提交需要 1 至 100 个对象修改"))?;
    for mutation in mutations.iter_mut() {
        collaboration_scope(mutation)?;
        mutation.as_object_mut().unwrap().remove("leaseToken");
    }
    let bytes = serde_json::to_vec(body)
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?;
    let fingerprint = format!("{:x}", Sha256::digest(&bytes));
    let key = format!(
        "project_collaboration_operation:{}",
        json!([user_id, id, session_id, operation_id])
    );
    if let Some(cached) = get_config_json(conn, &key)? {
        if cached.get("fingerprint").and_then(Value::as_str) != Some(fingerprint.as_str()) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "操作 ID 已用于其他内容，请勿重复使用",
            ));
        }
        *body = cached.get("request").cloned().ok_or_else(|| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "本地待提交操作损坏")
        })?;
        return Ok(());
    }
    for mutation in body
        .get_mut("mutations")
        .and_then(Value::as_array_mut)
        .unwrap()
    {
        let (kind, resource_id) = collaboration_scope(mutation)?;
        mutation["leaseToken"] =
            json!(scoped_lease_token(conn, id, session_id, kind, resource_id)?);
    }
    // Persist before sending so a lost response can replay the exact operation,
    // including after lease expiry. The cloud checks deduplication before leases.
    set_config_json(
        conn,
        &key,
        &json!({"fingerprint": fingerprint, "request": body}),
    )?;
    Ok(())
}

fn cache_collaboration_lease_response(
    conn: &Connection,
    key: &str,
    request_id: &str,
    data: &Value,
) -> Result<(), ApiError> {
    let current = get_config_json(conn, key)?.unwrap_or(Value::Null);
    if current.get("requestId").and_then(Value::as_str) != Some(request_id) {
        return Ok(());
    }
    let mut cached = if data.get("editable").and_then(Value::as_bool) == Some(true) {
        data.clone()
    } else {
        json!({})
    };
    cached["requestId"] = json!(request_id);
    set_config_json(conn, key, &cached)
}

pub(super) async fn api_project_collaboration(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(mut body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !body.is_object() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "协作请求必须是对象"));
    }
    let action = body
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !matches!(
        action.as_str(),
        "read" | "changes" | "enable" | "lease" | "write"
    ) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "协作操作无效"));
    }
    let session_id = requested_session_id()?;
    let (owner, device_id, user_id) = {
        let conn = db_connection(&state)?;
        ensure_project_permission(
            &conn,
            &id,
            if matches!(action.as_str(), "read" | "changes") {
                ProjectPermission::View
            } else {
                ProjectPermission::Edit
            },
        )?;
        let owner: String = conn
            .query_row(
                "SELECT owner_user_id FROM projects WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        (
            owner,
            get_or_create_cloud_device_id(&conn)?,
            current_project_owner_context(&conn)?.user_id,
        )
    };
    body["ownerUserId"] = json!(owner);
    body["localProjectId"] = json!(id);
    body["deviceId"] = json!(device_id);
    body["sessionId"] = json!(session_id);

    // Only migration uses the legacy lock. Object writes are serialized and
    // version-checked at the cloud database, independently of project sync.
    let _migration_guard = if action == "enable" {
        Some(interactive_cloud_session_guard().await?)
    } else {
        None
    };
    if action == "enable" {
        // A previous migration may have committed while its response was lost.
        let mut read = body.clone();
        read["action"] = json!("read");
        let current =
            cloud_post_client_data_json(&state, "/api/client/project-collaboration", read).await?;
        if current.pointer("/data/enabled").and_then(Value::as_bool) == Some(true) {
            ensure_collaboration_account(&db_connection(&state)?, &user_id)?;
            remember_collaboration_mode(&state, &id)?;
            return Ok(Json(current));
        }
        let conn = db_connection(&state)?;
        let (status, base): (String, Option<String>) = conn
            .query_row(
                "SELECT cloud_sync_status, cloud_base_updated_at FROM projects WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if status != "synced" || base.as_deref().unwrap_or("").is_empty() {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "请先完成项目同步并处理本地冲突，再迁移到按集协作",
            ));
        }
        let active: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM video_tasks JOIN scenes ON video_tasks.scene_id = scenes.id JOIN scripts ON scenes.script_id = scripts.id WHERE scripts.project_id = ?1 AND video_tasks.status NOT IN ('completed', 'failed', 'cancelled'))",
            params![id], |row| row.get(0),
        ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if active {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "请等待项目生成任务结束后再迁移",
            ));
        }
        drop(conn);
        acquire_conflict_edit_session(&state, &id).await?;
        let lease = capture_project_edit_lease(&state, &id)?;
        body["expectedUpdatedAt"] = json!(base);
        body["leaseToken"] = lease.get("token").cloned().unwrap_or(Value::Null);
        // Retain an additional local backup before switching the cloud protocol.
        let Json(snapshot) = api_project_get(Path(id.clone()), State(state.clone())).await?;
        let path = state
            .data_dir
            .join("project-collaboration-backups")
            .join(format!("{}.json", Uuid::new_v4()));
        fs::create_dir_all(path.parent().unwrap())
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let bytes = serde_json::to_vec_pretty(
            &json!({"projectId": id, "createdAt": now_iso(), "snapshot": snapshot}),
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let mut lease_request_id = None;
    if action == "lease" {
        let (kind, resource_id) = collaboration_scope(&body)?;
        let mut cached = get_config_json(
            &db_connection(&state)?,
            &collaboration_lease_key(&id, &session_id, kind, resource_id),
        )?
        .unwrap_or_else(|| json!({}));
        // Fence delayed heartbeat/release responses before sending the next request.
        let request_id = Uuid::new_v4().to_string();
        cached["requestId"] = json!(request_id);
        set_config_json(
            &db_connection(&state)?,
            &collaboration_lease_key(&id, &session_id, kind, resource_id),
            &cached,
        )?;
        lease_request_id = Some(request_id);
        // Tokens remain in the local backend, never in the browser payload.
        body["token"] = cached.get("token").cloned().unwrap_or(Value::Null);
    }
    if action == "write" {
        let mut conn = db_connection(&state)?;
        prepare_collaboration_write(&mut conn, &user_id, &id, &session_id, &mut body)?;
    }
    let mut response =
        cloud_post_client_data_json(&state, "/api/client/project-collaboration", body.clone())
            .await?;
    ensure_collaboration_account(&db_connection(&state)?, &user_id)?;
    if response.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "云端尚未提供按集协作服务，请更新云端并登录",
        ));
    }
    let data = response
        .get_mut("data")
        .filter(|value| value.is_object())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "云端缺少协作响应"))?;
    if action == "lease" {
        let (kind, resource_id) = collaboration_scope(&body)?;
        let key = collaboration_lease_key(&id, &session_id, kind, resource_id);
        cache_collaboration_lease_response(
            &db_connection(&state)?,
            &key,
            lease_request_id.as_deref().unwrap(),
            data,
        )?;
        if let Some(object) = data.as_object_mut() {
            object.remove("token");
        }
    }
    if data.get("enabled").and_then(Value::as_bool) == Some(true) {
        remember_collaboration_mode(&state, &id)?;
    }
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_collaboration_mode_requires_a_matching_local_owner() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
            CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT);
            INSERT INTO projects VALUES ('p1', 'owner');",
        )
        .unwrap();
        let mut project =
            json!({"collaboration": true, "localProjectId": "p1", "ownerUserId": "other"});
        remember_cloud_collaboration_mode(&conn, &project).unwrap();
        assert!(get_config_json(&conn, "project_collaboration_enabled:p1")
            .unwrap()
            .is_none());
        project["ownerUserId"] = json!("owner");
        set_config_json(&conn, "project_edit_session:p1", &json!({"token":"legacy"})).unwrap();
        remember_cloud_collaboration_mode(&conn, &project).unwrap();
        assert_eq!(
            get_config_json(&conn, "project_collaboration_enabled:p1").unwrap(),
            Some(json!(true))
        );
        assert_eq!(
            get_config_json(&conn, "project_edit_session:p1").unwrap(),
            Some(json!({}))
        );
    }

    #[test]
    fn late_collaboration_lease_response_cannot_replace_a_newer_cached_token() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
        )
        .unwrap();
        set_config_json(
            &conn,
            "lease",
            &json!({"requestId":"new", "token":"new-token"}),
        )
        .unwrap();
        cache_collaboration_lease_response(
            &conn,
            "lease",
            "old",
            &json!({"editable":true, "token":"old-token"}),
        )
        .unwrap();
        assert_eq!(
            get_config_json(&conn, "lease").unwrap().unwrap()["token"],
            "new-token"
        );
        cache_collaboration_lease_response(&conn, "lease", "new", &json!({"editable":false}))
            .unwrap();
        assert!(get_config_json(&conn, "lease")
            .unwrap()
            .unwrap()
            .get("token")
            .is_none());
    }

    #[tokio::test]
    async fn cloud_conflicts_preserve_only_the_affected_resource_details() {
        let router = Router::new().route("/api/client/project-collaboration", post(|| async {
            (StatusCode::CONFLICT, Json(json!({"message": "对象已变化", "data": {
                "type": "episode", "id": "e1", "revision": 2, "deleted": false, "token": "must-not-leak"
            }})))
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let error = cloud_data_request_json(
            &format!("http://{addr}"),
            reqwest::Method::POST,
            "/api/client/project-collaboration",
            Some("test"),
            Some(json!({})),
        )
        .await
        .unwrap_err();
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body["data"],
            json!({"type": "episode", "id": "e1", "revision": 2, "deleted": false})
        );
        server.abort();
    }

    #[test]
    fn collaboration_cache_isolated_by_window_and_resource_and_checks_expiry() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
        )
        .unwrap();
        let key = collaboration_lease_key("p1", "window1", "episode", "e1");
        set_config_json(
            &conn,
            &key,
            &json!({"token": "current", "expiresAt": Utc::now().timestamp_millis() + 90_000}),
        )
        .unwrap();
        assert_eq!(
            scoped_lease_token(&conn, "p1", "window1", "episode", "e1").unwrap(),
            "current"
        );
        assert!(scoped_lease_token(&conn, "p1", "window2", "episode", "e1").is_err());
        assert!(scoped_lease_token(&conn, "p1", "window1", "episode", "e2").is_err());
        assert!(scoped_lease_token(&conn, "p2", "window1", "episode", "e1").is_err());
        set_config_json(&conn, &key, &json!({"token": "expired", "expiresAt": 1})).unwrap();
        assert!(scoped_lease_token(&conn, "p1", "window1", "episode", "e1").is_err());
        assert_ne!(
            collaboration_lease_key("a:b", "c", "episode", "d"),
            collaboration_lease_key("a", "b:c", "episode", "d")
        );
        set_config_json(
            &conn,
            CLOUD_ADMIN_SESSION_KEY,
            &json!({"user": {"id": "alice"}}),
        )
        .unwrap();
        assert!(ensure_collaboration_account(&conn, "alice").is_ok());
        set_config_json(
            &conn,
            CLOUD_ADMIN_SESSION_KEY,
            &json!({"user": {"id": "bob"}}),
        )
        .unwrap();
        assert_eq!(
            ensure_collaboration_account(&conn, "alice")
                .unwrap_err()
                .status,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn persisted_write_can_retry_after_expiry_but_cannot_reuse_an_operation_for_other_content() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
        )
        .unwrap();
        let key = collaboration_lease_key("p1", "window1", "episode", "e1");
        set_config_json(
            &conn,
            &key,
            &json!({"token": "current", "expiresAt": Utc::now().timestamp_millis() + 90_000}),
        )
        .unwrap();
        let request = json!({"action": "write", "operationId": "op-1", "mutations": [{"type": "episode", "id": "e1", "expectedRevision": 1, "body": {"text": "draft"}}]});
        let mut first = request.clone();
        prepare_collaboration_write(&mut conn, "alice", "p1", "window1", &mut first).unwrap();
        assert_eq!(first["mutations"][0]["leaseToken"], "current");
        set_config_json(&conn, &key, &json!({})).unwrap();
        let mut retry = request.clone();
        prepare_collaboration_write(&mut conn, "alice", "p1", "window1", &mut retry).unwrap();
        assert_eq!(retry, first);
        let mut changed = request.clone();
        changed["mutations"][0]["body"]["text"] = json!("different");
        assert_eq!(
            prepare_collaboration_write(&mut conn, "alice", "p1", "window1", &mut changed)
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        let mut fresh = request.clone();
        fresh["operationId"] = json!("new-operation");
        assert_eq!(
            prepare_collaboration_write(&mut conn, "alice", "p1", "window1", &mut fresh)
                .unwrap_err()
                .status,
            StatusCode::LOCKED
        );
        let mut other_account = request.clone();
        assert_eq!(
            prepare_collaboration_write(&mut conn, "bob", "p1", "window1", &mut other_account)
                .unwrap_err()
                .status,
            StatusCode::LOCKED
        );
        let mut other_window = request;
        assert_eq!(
            prepare_collaboration_write(&mut conn, "alice", "p1", "window2", &mut other_window)
                .unwrap_err()
                .status,
            StatusCode::LOCKED
        );
    }
}
