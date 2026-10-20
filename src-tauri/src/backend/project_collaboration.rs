use super::*;

/// The default project entrance. Existing collaboration projects only require
/// view permission; legacy projects are backed up and migrated by their owner.
pub(super) async fn api_project_collaboration_prepare(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let (actor, owner, base) = {
        let conn = db_connection(&state)?;
        let actor = ensure_project_access(&conn, &id)?;
        let (owner, base): (String, Option<String>) = conn.query_row(
            "SELECT owner_user_id, cloud_base_updated_at FROM projects WHERE id = ?1",
            params![id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        (actor, owner, base)
    };
    match api_project_collaboration(Path(id.clone()), State(state.clone()), Json(json!({"action":"read"}))).await {
        Ok(Json(response)) if response.pointer("/data/enabled").and_then(Value::as_bool) == Some(true) => return Ok(Json(response)),
        Ok(_) => (),
        // A newly created local project may not have reached the cloud yet.
        Err(error) if error.status == StatusCode::NOT_FOUND && base.is_none() => (),
        Err(error) => return Err(error),
    }
    if actor.user_id != owner && !actor.is_admin {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "请项目所有者或管理员先打开此项目，完成协作迁移"));
    }
    {
        let _guard = interactive_cloud_session_guard().await?;
        ensure_collaboration_account(&db_connection(&state)?, &actor.user_id)?;
        let conn = db_connection(&state)?;
        let status: String = conn.query_row("SELECT cloud_sync_status FROM projects WHERE id = ?1", params![id], |row| row.get(0))
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let active: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM video_tasks JOIN scenes ON video_tasks.scene_id = scenes.id JOIN scripts ON scenes.script_id = scripts.id WHERE scripts.project_id = ?1 AND video_tasks.status NOT IN ('completed', 'failed', 'cancelled'))",
            params![id], |row| row.get(0),
        ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        drop(conn);
        if active { return Err(ApiError::new(StatusCode::CONFLICT, "请等待项目生成任务结束后重试协作迁移")); }
        if status == "conflict" { return Err(ApiError::new(StatusCode::CONFLICT, "请先在项目列表处理同步冲突，再重试协作迁移")); }
        if status == "pending" {
            if base.is_some() { acquire_conflict_edit_session(&state, &id).await?; }
            cloud_sync_project_by_id_locked(&state, &id).await?;
        }
    }
    let Json(preview) = api_project_collaboration(Path(id.clone()), State(state.clone()), Json(json!({"action":"migrationPreview"}))).await?;
    if preview.pointer("/data/enabled").and_then(Value::as_bool) == Some(true) { return Ok(Json(preview)); }
    ensure_collaboration_account(&db_connection(&state)?, &actor.user_id)?;
    api_project_collaboration(Path(id), State(state), Json(json!({
        "action":"enable", "expectedUpdatedAt":preview["data"]["expectedUpdatedAt"], "snapshotHash":preview["data"]["snapshotHash"]
    }))).await
}

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

pub(super) fn project_uses_collaboration(state: &BackendState, id: &str) -> Result<bool, ApiError> {
    Ok(get_config_json(
        &db_connection(state)?,
        &format!("project_collaboration_enabled:{id}"),
    )?
    .and_then(|value| value.as_bool())
        == Some(true))
}

pub(super) fn require_legacy_project_mode(state: &BackendState, id: &str) -> Result<(), ApiError> {
    if project_uses_collaboration(state, id)? {
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
    let normalized = |value: &Value| {
        let mut value = value.clone();
        if let Some(object) = value.as_object_mut() { object.remove("deviceId"); object.remove("sessionId"); }
        if let Some(mutations) = value["mutations"].as_array_mut() {
            for mutation in mutations { if let Some(object) = mutation.as_object_mut() { object.remove("leaseToken"); } }
        }
        value
    };
    let key = format!("project_collaboration_operation:{}", json!([user_id, id, operation_id]));
    let mut cached = get_config_json(conn, &key)?;
    if cached.is_none() {
        // Preserve outboxes written by the window-scoped protocol before a reload/upgrade.
        let tuple = json!([user_id, id]).to_string();
        let prefix = format!("project_collaboration_operation:{},", tuple.trim_end_matches(']'));
        let pattern = format!("{}%", prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut statement = conn.prepare("SELECT key, value FROM system_config WHERE key LIKE ?1 ESCAPE '\\'")
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let rows = statement.query_map(params![pattern], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?)))
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        for row in rows {
            let (old_key, raw) = row.map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            let tuple = old_key.strip_prefix("project_collaboration_operation:").and_then(|raw| serde_json::from_str::<Value>(raw).ok());
            if tuple.as_ref().and_then(Value::as_array).is_some_and(|parts| parts.len() == 4 && parts[0] == user_id && parts[1] == id && parts[3] == operation_id) {
                cached = Some(serde_json::from_str(&raw).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "本地待提交操作损坏"))?);
                break;
            }
        }
    }
    if let Some(cached) = &cached {
        let request = cached.get("request").filter(|request| request.is_object()).ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "本地待提交操作损坏"))?;
        if normalized(request) != normalized(body) { return Err(ApiError::new(StatusCode::CONFLICT, "操作 ID 已用于其他内容，请勿重复使用")); }
    }
    // Fresh tokens may change across reconnection. Payload, revisions and operation ID cannot.
    // Without fresh leases, replay the original request to confirm a possibly committed receipt.
    let tokens: Result<Vec<String>, ApiError> = body["mutations"].as_array().unwrap().iter().map(|mutation| {
        let (kind, resource_id) = collaboration_scope(mutation)?;
        scoped_lease_token(conn, id, session_id, kind, resource_id)
    }).collect();
    match tokens {
        Ok(tokens) => for (mutation, token) in body["mutations"].as_array_mut().unwrap().iter_mut().zip(tokens) { mutation["leaseToken"] = json!(token); },
        Err(error) => {
            if let Some(cached) = cached { *body = cached["request"].clone(); }
            else { return Err(error); }
        }
    }
    let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&normalized(body)).map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?));
    set_config_json(conn, &key, &json!({"fingerprint":fingerprint,"request":body}))?;
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
        "read"
            | "changes"
            | "enable"
            | "lease"
            | "write"
            | "members"
            | "memberPut"
            | "memberRemove"
            | "delete"
            | "generationCheck"
            | "migrationPreview"
            | "presence"
    ) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "协作操作无效"));
    }
    let session_id = requested_session_id()?;
    let (owner, device_id, user_id) = {
        let conn = db_connection(&state)?;
        ensure_project_permission(
            &conn,
            &id,
            match action.as_str() {
                "read" | "changes" | "members" | "presence" => ProjectPermission::View,
                "memberPut" | "memberRemove" => ProjectPermission::ManageMembers,
                "delete" => ProjectPermission::Delete,
                "generationCheck" => ProjectPermission::Generate,
                _ => ProjectPermission::Edit,
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
    if action == "enable" || action == "migrationPreview" {
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
        if action == "enable" && body["expectedUpdatedAt"].as_str() != base.as_deref() {
            return Err(ApiError::new(StatusCode::CONFLICT, "预检后的本地版本已变化，请重新预检迁移"));
        }
        body["expectedUpdatedAt"] = json!(base);
        if action == "enable" {
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
    if action == "generationCheck" {
        let (kind, resource_id) = collaboration_scope(&body)?;
        body["token"] = json!(scoped_lease_token(&db_connection(&state)?, &id, &session_id, kind, resource_id)?);
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
    if matches!(action.as_str(), "members" | "memberPut" | "memberRemove")
        || (matches!(action.as_str(), "read" | "changes") && data.get("members").is_some_and(Value::is_array))
    {
        if !data.get("members").is_some_and(Value::is_array) {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "云端缺少项目成员列表",
            ));
        }
        apply_cloud_project_members(&state, &id, data)?;
        remember_collaboration_mode(&state, &id)?;
    }
    if action == "delete" {
        if data.get("deleted").and_then(Value::as_bool) != Some(true) {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "云端尚未确认项目删除",
            ));
        }
        let mut conn = db_connection(&state)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        ensure_collaboration_account(&tx, &user_id)?;
        remember_deleted_project_tombstone(&tx, &id)?;
        delete_local_project_rows(&tx, &id, &owner)?;
        tx.commit()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
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

fn draft_results_key(project_id: &str, actor_id: &str) -> String {
    format!("project_collaboration_draft_results:{}", json!([actor_id, project_id]))
}

pub(super) fn save_collaboration_draft_result(state: &BackendState, project_id: &str, actor_id: &str, response: &Value) -> Result<(), ApiError> {
    save_collaboration_result(state, project_id, actor_id, response, "draft")
}

pub(super) fn save_collaboration_media_result(state: &BackendState, project_id: &str, actor_id: &str, response: &Value) -> Result<(), ApiError> {
    save_collaboration_result(state, project_id, actor_id, response, "media")
}

fn save_collaboration_result(state: &BackendState, project_id: &str, actor_id: &str, response: &Value, kind: &str) -> Result<(), ApiError> {
    let mut conn = db_connection(state)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    ensure_collaboration_account(&tx, actor_id)?;
    let key = if kind == "draft" { draft_results_key(project_id, actor_id) } else { format!("project_collaboration_media_results:{}", json!([actor_id, project_id])) };
    let mut results = get_config_json(&tx, &key)?.and_then(|value| value.as_array().cloned()).unwrap_or_default();
    results.push(response.clone());
    if results.len() > 20 { results.drain(..results.len() - 20); }
    set_config_json(&tx, &key, &json!(results))?;
    tx.commit().map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) async fn api_project_collaboration_draft_results(Path(id): Path<String>, State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let actor = current_project_owner_context(&db_connection(&state)?)?.user_id;
    // Reauthorize online before returning cached results, including membership revocation/deletion.
    let _ = api_project_collaboration(Path(id.clone()), State(state.clone()), Json(json!({"action":"read"}))).await?;
    let conn = db_connection(&state)?;
    ensure_collaboration_account(&conn, &actor)?;
    let results = get_config_json(&conn, &draft_results_key(&id, &actor))?.unwrap_or_else(|| json!([]));
    Ok(Json(json!({"success": true, "data": results})))
}

pub(super) async fn api_project_collaboration_media_results(Path(id): Path<String>, State(state): State<BackendState>) -> Result<Json<Value>, ApiError> {
    let actor = current_project_owner_context(&db_connection(&state)?)?.user_id;
    let _ = api_project_collaboration(Path(id.clone()), State(state.clone()), Json(json!({"action":"read"}))).await?;
    let conn = db_connection(&state)?;
    ensure_collaboration_account(&conn, &actor)?;
    let key = format!("project_collaboration_media_results:{}", json!([actor, id]));
    let mut results = get_config_json(&conn, &key)?.and_then(|value| value.as_array().cloned()).unwrap_or_default();
    let mut stmt = conn.prepare("SELECT id, status, progress, error, video_data, config, created_at FROM video_tasks WHERE json_extract(config, '$.collaboration.projectId') = ?1 AND json_extract(config, '$.collaboration.actorId') = ?2 ORDER BY created_at DESC LIMIT 30")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let rows = stmt.query_map(params![id, actor], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?)))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    for row in rows {
        let (task_id,status,progress,error,url,config,created_at) = row.map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let mut config: Value = serde_json::from_str(&config).unwrap_or(Value::Null);
        if status == "completed" && config["collaborationVoiceContext"].is_object() && config["collaborationVoiceExtraction"].is_null() {
            if let Some(url) = url.as_deref() {
                trigger_character_voice_asset_extraction(&state, config["collaboration"]["sceneId"].as_str().unwrap_or(""), &task_id, url);
                let raw: Option<String> = conn.query_row("SELECT json_extract(config, '$.collaborationVoiceExtraction') FROM video_tasks WHERE id=?1", params![task_id], |row| row.get(0)).unwrap_or(None);
                config["collaborationVoiceExtraction"] = raw.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or(Value::Null);
            }
        }
        results.push(json!({"id":task_id,"kind":"video","status":status,"progress":progress,"error":error,"url":url,"createdAt":created_at,"collaboration":config.get("collaboration"),"voiceExtraction":config.get("collaborationVoiceExtraction")}));
    }
    Ok(Json(json!({"success":true,"data":results})))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ManagementProject(BackendState);
    impl ManagementProject {
        fn new(user_id: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "playlet-collaboration-management-{}",
                Uuid::new_v4()
            ));
            fs::create_dir_all(&dir).unwrap();
            let state = BackendState {
                db_path: dir.join("test.sqlite"),
                data_dir: dir.clone(),
                public_dir: dir.clone(),
                web_dir: dir,
                xiaohongshu_dynamic_fetcher: None,
            };
            init_database(&state).unwrap();
            let conn = db_connection(&state).unwrap();
            set_config_json(
                &conn,
                CLOUD_ADMIN_SESSION_KEY,
                &json!({"token":"test", "user":{"id":user_id, "role":"user"}}),
            )
            .unwrap();
            conn.execute("INSERT INTO projects (id, name, project_type, style_id, aspect_ratio, status, created_at, updated_at, owner_user_id, cloud_sync_status) VALUES ('p1', '保留内容', 'script_writing', '', '9:16', 'draft', 'v1', 'v1', 'owner', 'synced')", []).unwrap();
            conn.execute(r#"INSERT INTO project_members (project_id, user_id, account, display_name, role, permissions_json, created_at, updated_at) VALUES ('p1','manager','manager','Manager','custom','["view","manage_members"]','v1','v1')"#, []).unwrap();
            remember_collaboration_mode(&state, "p1").unwrap();
            Self(state)
        }
    }
    impl Drop for ManagementProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0.data_dir);
        }
    }

    #[test]
    fn collaboration_draft_results_are_durable_bounded_and_actor_scoped() {
        let test = ManagementProject::new("owner");
        for index in 0..22 {
            save_collaboration_draft_result(&test.0, "p1", "owner", &json!({"id":index,"data":{"draft":"保留结果"}})).unwrap();
        }
        let conn = db_connection(&test.0).unwrap();
        let saved = get_config_json(&conn, &draft_results_key("p1", "owner")).unwrap().unwrap();
        assert_eq!(saved.as_array().unwrap().len(), 20);
        assert_eq!(saved[0]["id"], 2);
        assert!(get_config_json(&conn, &draft_results_key("p1", "other")).unwrap().is_none());
        assert!(get_config_json(&conn, &draft_results_key("other", "owner")).unwrap().is_none());
        set_config_json(&conn, CLOUD_ADMIN_SESSION_KEY, &json!({"token":"test", "user":{"id":"other","role":"user"}})).unwrap();
        assert!(save_collaboration_draft_result(&test.0, "p1", "owner", &json!({"id":"wrong"})).is_err());
    }

    #[tokio::test]
    async fn collaboration_poll_refreshes_cached_permissions_before_the_next_write() {
        let test = ManagementProject::new("manager");
        let upgraded = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let served = upgraded.clone();
        let router = Router::new().route("/api/client/project-collaboration", post(move || {
            let editable = served.load(std::sync::atomic::Ordering::SeqCst);
            async move {
                let (role, permissions) = if editable {
                    ("editor", json!(["view", "edit", "generate", "export"]))
                } else { ("viewer", json!(["view"])) };
                Json(json!({"success":true,"data":{
                    "changes":[],"cursor":0,"hasMore":false,"editable":editable,
                    "members":[{"userId":"manager","role":role,"permissions":permissions}],
                    "access":{"role":role,"isOwner":false,"permissions":permissions}
                }}))
            }
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
        set_config_json(&db_connection(&test.0).unwrap(), CLOUD_ADMIN_CONFIG_KEY, &json!({"baseUrl":format!("http://{addr}")})).unwrap();
        assert!(ensure_project_permission(&db_connection(&test.0).unwrap(), "p1", ProjectPermission::Edit).is_err());
        for editable in [true, false] {
            upgraded.store(editable, std::sync::atomic::Ordering::SeqCst);
            let Json(response) = CURRENT_EDIT_SESSION.scope(Some("window-poll".to_string()), api_project_collaboration(
                Path("p1".to_string()), State(test.0.clone()), Json(json!({"action":"changes","after":0}))
            )).await.unwrap();
            assert_eq!(response["data"]["editable"], editable);
            for permission in [ProjectPermission::Edit, ProjectPermission::Generate, ProjectPermission::Export] {
                assert_eq!(ensure_project_permission(&db_connection(&test.0).unwrap(), "p1", permission).is_ok(), editable);
            }
        }
        server.abort();
    }

    #[tokio::test]
    async fn collaboration_member_routes_use_cloud_permissions_without_a_project_edit_lease() {
        let test = ManagementProject::new("manager");
        assert!(ensure_project_permission(
            &db_connection(&test.0).unwrap(),
            "p1",
            ProjectPermission::Edit
        )
        .is_err());
        let calls = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
        let captured = calls.clone();
        let router = Router::new().route("/api/client/project-collaboration", post(move |Json(body): Json<Value>| {
            captured.lock().unwrap().push(body.clone());
            async move {
                let mut members = vec![json!({"userId":"manager", "account":"manager", "displayName":"Manager", "role":"custom", "permissions":["view","manage_members"], "createdAt":"v1", "updatedAt":"v1"})];
                if body["action"] != "memberRemove" { members.push(json!({"userId":"target", "account":"canonical", "displayName":"Canonical", "role":"viewer", "permissions":["view"], "createdAt":"v2", "updatedAt":"v2"})); }
                Json(json!({"success":true, "data":{"collaboration":true,"members":members}}))
            }
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        set_config_json(
            &db_connection(&test.0).unwrap(),
            CLOUD_ADMIN_CONFIG_KEY,
            &json!({"baseUrl":format!("http://{addr}")}),
        )
        .unwrap();
        let _ = CURRENT_EDIT_SESSION
            .scope(
                Some("window".into()),
                api_project_member_put(
                    Path(("p1".into(), "target".into())),
                    State(test.0.clone()),
                    Json(
                        serde_json::from_value(
                            json!({"role":"viewer","account":"spoofed","expectedUpdatedAt":null}),
                        )
                        .unwrap(),
                    ),
                ),
            )
            .await
            .unwrap();
        let conn = db_connection(&test.0).unwrap();
        let account: String = conn
            .query_row(
                "SELECT account FROM project_members WHERE user_id = 'target'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(account, "canonical");
        let status: String = conn
            .query_row(
                "SELECT cloud_sync_status FROM projects WHERE id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "synced");
        let _ = CURRENT_EDIT_SESSION
            .scope(
                Some("window".into()),
                api_project_member_delete(
                    Path(("p1".into(), "target".into())),
                    State(test.0.clone()),
                    Query(HashMap::from([("expectedUpdatedAt".into(), "v2".into())])),
                ),
            )
            .await
            .unwrap();
        assert_eq!(calls.lock().unwrap()[0]["action"], "memberPut");
        assert_eq!(calls.lock().unwrap()[1]["expectedUpdatedAt"], "v2");
        assert_eq!(calls.lock().unwrap()[0]["ownerUserId"], "owner");
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM project_members WHERE user_id = 'target'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        server.abort();
    }

    #[tokio::test]
    async fn collaboration_delete_keeps_local_data_until_cloud_acknowledges_and_never_queues_a_snapshot(
    ) {
        let test = ManagementProject::new("owner");
        let accepted = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let captured = accepted.clone();
        let router = Router::new().route(
            "/api/client/project-collaboration",
            post(move || {
                let deleted = captured.load(std::sync::atomic::Ordering::SeqCst);
                async move { Json(json!({"success":true,"data":{"deleted":deleted}})) }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        set_config_json(
            &db_connection(&test.0).unwrap(),
            CLOUD_ADMIN_CONFIG_KEY,
            &json!({"baseUrl":format!("http://{addr}")}),
        )
        .unwrap();
        let rejected = CURRENT_EDIT_SESSION
            .scope(
                Some("window".into()),
                api_project_delete(Path("p1".into()), State(test.0.clone())),
            )
            .await;
        assert_eq!(rejected.unwrap_err().status, StatusCode::BAD_GATEWAY);
        assert!(local_project_updated_at_for_owner(
            &db_connection(&test.0).unwrap(),
            "p1",
            "owner"
        )
        .unwrap()
        .is_some());
        accepted.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = CURRENT_EDIT_SESSION
            .scope(
                Some("window".into()),
                api_project_delete(Path("p1".into()), State(test.0.clone())),
            )
            .await
            .unwrap();
        let conn = db_connection(&test.0).unwrap();
        assert!(local_project_updated_at_for_owner(&conn, "p1", "owner")
            .unwrap()
            .is_none());
        assert!(is_deleted_project_tombstone(&conn, "p1").unwrap());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM cloud_project_deletions", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        server.abort();
    }

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
    fn collaboration_old_window_outbox_can_confirm_receipts_and_refresh_credentials() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE system_config (key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)").unwrap();
        let original = json!({"action":"write","deviceId":"device","sessionId":"old-window","operationId":"op","mutations":[{"type":"episode","id":"e","expectedRevision":1,"body":{"text":"keep"},"leaseToken":"expired"}]});
        set_config_json(&conn, &format!("project_collaboration_operation:{}", json!(["actor","p","old-window","op"])), &json!({"request":original,"fingerprint":"old-format"})).unwrap();
        let mut retry = original.clone();
        retry["sessionId"] = json!("new-window");
        prepare_collaboration_write(&mut conn, "actor", "p", "new-window", &mut retry).unwrap();
        assert_eq!(retry, original);
        set_config_json(&conn, &collaboration_lease_key("p","new-window","episode","e"), &json!({"token":"new-token","expiresAt":Utc::now().timestamp_millis()+90_000})).unwrap();
        let mut renewed = original.clone();
        renewed["sessionId"] = json!("new-window");
        prepare_collaboration_write(&mut conn, "actor", "p", "new-window", &mut renewed).unwrap();
        assert_eq!(renewed["sessionId"], "new-window");
        assert_eq!(renewed["mutations"][0]["leaseToken"], "new-token");
        assert_eq!(renewed["mutations"][0]["body"], original["mutations"][0]["body"]);
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
        prepare_collaboration_write(&mut conn, "alice", "p1", "window2", &mut other_window).unwrap();
        assert_eq!(other_window, first);
        set_config_json(&conn, &collaboration_lease_key("p1", "window2", "episode", "e1"), &json!({"token":"renewed","expiresAt":Utc::now().timestamp_millis()+90_000})).unwrap();
        prepare_collaboration_write(&mut conn, "alice", "p1", "window2", &mut other_window).unwrap();
        assert_eq!(other_window["mutations"][0]["leaseToken"], "renewed");
    }
}
