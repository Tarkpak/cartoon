use super::*;

#[cfg(test)]
mod lease_fencing_tests {
    use super::*;

    #[test]
    fn task_write_requires_current_token_and_conflict_free_project() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT, cloud_sync_status TEXT);
             CREATE TABLE scripts (id TEXT, project_id TEXT);
             CREATE TABLE scenes (id TEXT, script_id TEXT);
             CREATE TABLE video_tasks (id TEXT, scene_id TEXT, config TEXT);
             CREATE TABLE system_config (key TEXT, value TEXT);
             INSERT INTO projects VALUES ('p1', 'pending');
             INSERT INTO scripts VALUES ('s1', 'p1');
             INSERT INTO scenes VALUES ('scene1', 's1');
             INSERT INTO video_tasks VALUES ('task1', 'scene1', '{\"projectEditLease\":{\"token\":\"current\"}}');
             INSERT INTO system_config VALUES ('project_edit_session:p1', '{\"token\":\"current\"}');",
        ).unwrap();
        assert!(task_matches_cached_edit_lease(&conn, "task1").unwrap());
        conn.execute("UPDATE video_tasks SET config = ?1", params![json!({"projectEditLease":{"token":"current"},"collaboration":{"projectId":"p1"}}).to_string()]).unwrap();
        assert!(!task_matches_cached_edit_lease(&conn, "task1").unwrap());
        conn.execute("UPDATE video_tasks SET config = ?1", params![json!({"projectEditLease":{"token":"current"}}).to_string()]).unwrap();
        conn.execute(
            "UPDATE system_config SET value = '{\"token\":\"replacement\"}'",
            [],
        )
        .unwrap();
        assert!(!task_matches_cached_edit_lease(&conn, "task1").unwrap());
        conn.execute(
            "UPDATE system_config SET value = '{\"token\":\"current\"}'",
            [],
        )
        .unwrap();
        conn.execute("UPDATE projects SET cloud_sync_status = 'conflict'", [])
            .unwrap();
        assert!(!task_matches_cached_edit_lease(&conn, "task1").unwrap());
        assert!(!task_matches_cached_edit_lease(&conn, "missing").unwrap());
    }
}

fn session_key(id: &str) -> String {
    format!("project_edit_session:{id}")
}

pub(super) fn cached_project_edit_session(
    state: &BackendState,
    id: &str,
) -> Result<Value, ApiError> {
    Ok(get_config_json(&db_connection(state)?, &session_key(id))?.unwrap_or_else(|| json!({})))
}

async fn operate_edit_session(
    state: &BackendState,
    id: &str,
    session_id: &str,
    action: &str,
) -> Result<Value, ApiError> {
    let (owner_id, device_id) = {
        let conn = db_connection(state)?;
        ensure_project_permission(&conn, id, ProjectPermission::Edit)
            .or_else(|_| ensure_project_permission(&conn, id, ProjectPermission::ManageMembers))
            .or_else(|_| ensure_project_permission(&conn, id, ProjectPermission::Delete))?;
        let owner: String = conn
            .query_row(
                "SELECT owner_user_id FROM projects WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        (owner, get_or_create_cloud_device_id(&conn)?)
    };
    let cached = cached_project_edit_session(state, id)?;
    let token = if cached.get("sessionId").and_then(Value::as_str) == Some(session_id) {
        cached.get("token").cloned()
    } else {
        None
    };
    let response = cloud_post_client_json(
        state,
        "/api/client/projects/edit-session",
        json!({
            "ownerUserId": owner_id, "localProjectId": id, "deviceId": device_id,
            "sessionId": session_id, "action": action, "token": token
        }),
    )
    .await?;
    let mut data = response
        .get("data")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "云端未提供编辑会话服务，请先更新云端并登录",
            )
        })?;
    data["sessionId"] = json!(session_id);
    if !matches!(action, "acquire" | "takeover")
        && cached.get("sessionId").and_then(Value::as_str) == Some(session_id)
        && cached.get("releaseWhenIdle").and_then(Value::as_bool) == Some(true)
    {
        data["releaseWhenIdle"] = json!(true);
    }
    if data.get("editable").and_then(Value::as_bool) == Some(true) {
        set_config_json(&db_connection(state)?, &session_key(id), &data)?;
    } else if cached.get("sessionId").and_then(Value::as_str) == Some(session_id) {
        // Never erase another window's valid lease when this window is rejected.
        set_config_json(&db_connection(state)?, &session_key(id), &json!({}))?;
    }
    Ok(data)
}

pub(super) fn requested_session_id() -> Result<String, ApiError> {
    CURRENT_EDIT_SESSION
        .try_with(Clone::clone)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::LOCKED, "请更新客户端并重新进入项目以取得编辑权"))
}

pub(super) fn capture_project_edit_lease(
    state: &BackendState,
    id: &str,
) -> Result<Value, ApiError> {
    require_legacy_project_mode(state, id)?;
    let session_id = requested_session_id()?;
    let cached = cached_project_edit_session(state, id)?;
    if cached.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
        || cached.get("token").and_then(Value::as_str).is_none()
        || cached.get("expiresAt").and_then(Value::as_i64).unwrap_or(0)
            <= Utc::now().timestamp_millis()
    {
        return Err(ApiError::new(
            StatusCode::LOCKED,
            "编辑会话已变化，请重新取得编辑权",
        ));
    }
    Ok(cached)
}

pub(super) async fn ensure_project_edit_session(
    state: &BackendState,
    id: &str,
) -> Result<(), ApiError> {
    require_legacy_project_mode(state, id)?;
    let session_id = requested_session_id()?;
    let data = operate_edit_session(state, id, &session_id, "check").await?;
    if data.get("editable").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::LOCKED,
            format!(
                "项目编辑权已失效或正在由 {} 编辑，本地内容已保留",
                data.get("holderName")
                    .and_then(Value::as_str)
                    .unwrap_or("其他成员")
            ),
        ));
    }
    Ok(())
}

pub(super) async fn acquire_conflict_edit_session(
    state: &BackendState,
    id: &str,
) -> Result<(), ApiError> {
    let session_id = requested_session_id()?;
    let data = operate_edit_session(state, id, &session_id, "acquire").await?;
    if data.get("editable").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::LOCKED,
            "其他编辑会话正在使用项目，请等待释放或接管编辑权",
        ));
    }
    Ok(())
}

pub(super) async fn api_project_edit_session(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_project_access(&db_connection(&state)?, &id)?;
    let session_id = requested_session_id()?;
    let action = body
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("acquire");
    if !matches!(action, "acquire" | "heartbeat" | "release" | "takeover") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "编辑会话操作无效"));
    }
    if get_config_json(
        &db_connection(&state)?,
        &format!("project_collaboration_enabled:{id}"),
    )?
    .and_then(|value| value.as_bool())
        == Some(true)
    {
        return Ok(Json(json!({"success": true, "data": {
            "editable": false, "canTakeover": false, "collaboration": true,
            "reason": "项目已启用按集协作，请使用协作入口"
        }})));
    }
    let _guard = interactive_cloud_session_guard().await?;
    if ensure_project_permission(&db_connection(&state)?, &id, ProjectPermission::Edit).is_err() {
        return Ok(Json(
            json!({"success": true, "data": {"editable": false, "canTakeover": false, "reason": "当前账号仅有查看权限"}}),
        ));
    }
    if action == "release" {
        let cached = cached_project_edit_session(&state, &id)?;
        if cached.get("sessionId").and_then(Value::as_str) == Some(session_id.as_str()) {
            let _ = cloud_sync_project_by_id_locked(&state, &id).await;
        }
    }
    if action == "release" && has_active_project_tasks(&state, &id)? {
        let mut cached = cached_project_edit_session(&state, &id)?;
        if cached.get("sessionId").and_then(Value::as_str) == Some(session_id.as_str()) {
            cached["releaseWhenIdle"] = json!(true);
            set_config_json(&db_connection(&state)?, &session_key(&id), &cached)?;
            return Ok(Json(
                json!({"success": true, "data": {"editable": false, "reason": "后台生成完成后自动释放编辑权"}}),
            ));
        }
    }
    let mut data = operate_edit_session(&state, &id, &session_id, action).await?;
    if matches!(action, "acquire" | "takeover")
        && data.get("editable").and_then(Value::as_bool) == Some(true)
    {
        let status: String = db_connection(&state)?
            .query_row(
                "SELECT cloud_sync_status FROM projects WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if status == "conflict" {
            data["editable"] = json!(false);
            data["reason"] = json!("本地项目存在同步冲突，请先在项目列表处理冲突");
        } else {
            if status == "pending" {
                if let Err(error) = cloud_sync_project_by_id_locked(&state, &id).await {
                    data["editable"] = json!(false);
                    data["reason"] = json!(error.message);
                }
            }
            if data.get("editable").and_then(Value::as_bool) == Some(true) {
                let owner: String = db_connection(&state)?
                    .query_row(
                        "SELECT owner_user_id FROM projects WHERE id = ?1",
                        params![id],
                        |row| row.get(0),
                    )
                    .map_err(|error| {
                        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
                    })?;
                let remote = fetch_conflict_remote(&state, &id, &owner).await?;
                apply_cloud_project_snapshot(&state, &remote).await?;
            }
        }
    }
    // The bearer lease token remains in the local backend, never in the browser.
    if let Some(object) = data.as_object_mut() {
        object.remove("token");
    }
    Ok(Json(json!({"success": true, "data": data})))
}

pub(super) async fn api_project_edit_backup(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_project_access(&db_connection(&state)?, &id)?;
    let dir = state.data_dir.join("project-edit-backups");
    fs::create_dir_all(&dir)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let backup_id = Uuid::new_v4().to_string();
    let path = dir.join(format!("{backup_id}.json"));
    let bytes = serde_json::to_vec_pretty(
        &json!({"projectId": id, "createdAt": now_iso(), "snapshot": body}),
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({"success": true, "backupId": backup_id})))
}

pub(super) async fn api_project_edit_backup_get(
    Path((id, backup_id)): Path<(String, String)>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    ensure_project_permission(&db_connection(&state)?, &id, ProjectPermission::Export)?;
    let uuid = Uuid::parse_str(&backup_id)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "备份编号无效"))?;
    let bytes = fs::read(
        state
            .data_dir
            .join("project-edit-backups")
            .join(format!("{uuid}.json")),
    )
    .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "备份不存在"))?;
    let backup: Value = serde_json::from_slice(&bytes)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if backup.get("projectId").and_then(Value::as_str) != Some(id.as_str()) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "备份不属于当前项目"));
    }
    Ok(Json(backup))
}

pub(super) async fn task_can_write_project(
    state: &BackendState,
    task_id: &str,
    scene_id: &str,
) -> Result<bool, ApiError> {
    let (project_id, config) = {
        let conn = db_connection(state)?;
        let row: Option<(String, String)> = conn.query_row(
            "SELECT scripts.project_id, video_tasks.config FROM video_tasks JOIN scenes ON scenes.id = video_tasks.scene_id JOIN scripts ON scripts.id = scenes.script_id WHERE video_tasks.id = ?1 AND scenes.id = ?2",
            params![task_id, scene_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let Some(row) = row else {
            return Ok(false);
        };
        row
    };
    let config: Value = serde_json::from_str(&config).unwrap_or(Value::Null);
    if config.get("collaboration").is_some() { return Ok(false); }
    let lease = config.get("projectEditLease").unwrap_or(&Value::Null);
    let cached = cached_project_edit_session(state, &project_id)?;
    if lease.get("token").and_then(Value::as_str).is_none()
        || cached.get("token") != lease.get("token")
    {
        return Ok(false);
    }
    let Some(session_id) = lease.get("sessionId").and_then(Value::as_str) else {
        return Ok(false);
    };
    match operate_edit_session(state, &project_id, session_id, "check").await {
        Ok(data) => Ok(data.get("editable").and_then(Value::as_bool) == Some(true)),
        Err(_) => Ok(false),
    }
}

pub(super) fn task_matches_cached_edit_lease(
    conn: &Connection,
    task_id: &str,
) -> Result<bool, ApiError> {
    let row: Option<(String, String, String)> = conn.query_row(
        "SELECT scripts.project_id, video_tasks.config, projects.cloud_sync_status FROM video_tasks JOIN scenes ON scenes.id = video_tasks.scene_id JOIN scripts ON scripts.id = scenes.script_id JOIN projects ON projects.id = scripts.project_id WHERE video_tasks.id = ?1",
        params![task_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let Some((id, config, status)) = row else {
        return Ok(false);
    };
    if status == "conflict" {
        return Ok(false);
    }
    let config: Value = serde_json::from_str(&config).unwrap_or(Value::Null);
    if config.get("collaboration").is_some() { return Ok(false); }
    let token = config
        .pointer("/projectEditLease/token")
        .and_then(Value::as_str);
    let cached = get_config_json(conn, &session_key(&id))?.unwrap_or(Value::Null);
    Ok(token.is_some() && token == cached.get("token").and_then(Value::as_str))
}

fn has_active_project_tasks(state: &BackendState, id: &str) -> Result<bool, ApiError> {
    let lease = cached_project_edit_session(state, id)?;
    let token = lease.get("token").and_then(Value::as_str).unwrap_or("");
    db_connection(state)?.query_row(
        "SELECT EXISTS(SELECT 1 FROM video_tasks JOIN scenes ON video_tasks.scene_id = scenes.id JOIN scripts ON scenes.script_id = scripts.id WHERE scripts.project_id = ?1 AND json_extract(video_tasks.config, '$.projectEditLease.token') = ?2 AND video_tasks.status NOT IN ('completed', 'failed', 'cancelled'))",
        params![id, token], |row| row.get(0),
    ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) fn start_task_edit_lease_renewal(state: &BackendState, project_id: &str) {
    static WORKERS: OnceLock<std::sync::Mutex<HashSet<String>>> = OnceLock::new();
    let state = state.clone();
    let id = project_id.to_string();
    let Ok(lease) = cached_project_edit_session(&state, &id) else {
        return;
    };
    let Some(session_id) = lease
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let workers = WORKERS.get_or_init(|| std::sync::Mutex::new(HashSet::new()));
    let worker_key = format!(
        "{}:{id}:{}",
        state.db_path.display(),
        lease.get("token").and_then(Value::as_str).unwrap_or("")
    );
    if !workers.lock().unwrap().insert(worker_key.clone()) {
        return;
    }
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let Ok(cached) = cached_project_edit_session(&state, &id) else {
                break;
            };
            if cached.get("token") != lease.get("token") {
                break;
            }
            if !has_active_project_tasks(&state, &id).unwrap_or(false) {
                if cached.get("releaseWhenIdle").and_then(Value::as_bool) == Some(true) {
                    // Upload background changes before relinquishing the lease.
                    let _guard = cloud_session_operation_lock().lock().await;
                    let _ = cloud_sync_project_by_id_locked(&state, &id).await;
                    let _ = operate_edit_session(&state, &id, &session_id, "release").await;
                }
                break;
            }
            match operate_edit_session(&state, &id, &session_id, "heartbeat").await {
                Ok(data) if data.get("editable").and_then(Value::as_bool) == Some(true) => (),
                _ => break,
            }
        }
        workers.lock().unwrap().remove(&worker_key);
    });
}

pub(super) async fn acquire_deleted_project_lease(
    state: &BackendState,
    id: &str,
    owner_id: &str,
) -> Result<(), ApiError> {
    let cached = cached_project_edit_session(state, id)?;
    let session_id = cached
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let device_id = get_or_create_cloud_device_id(&db_connection(state)?)?;
    let response = cloud_post_client_json(
        state,
        "/api/client/projects/edit-session",
        json!({
            "ownerUserId": owner_id, "localProjectId": id, "sessionId": session_id,
            "deviceId": device_id, "token": cached.get("token"), "action": "acquire"
        }),
    )
    .await?;
    let mut lease = response.get("data").cloned().unwrap_or_else(|| json!({}));
    if lease.get("editable").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::LOCKED,
            "项目正在被其他会话编辑，云端删除将等待编辑权释放",
        ));
    }
    lease["sessionId"] = json!(session_id);
    set_config_json(&db_connection(state)?, &session_key(id), &lease)?;
    Ok(())
}
