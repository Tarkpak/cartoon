use super::*;

fn conflict_error(message: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, message)
}

fn local_conflict_version(state: &BackendState, id: &str) -> Result<(String, String), ApiError> {
    let conn = db_connection(state)?;
    ensure_project_permission(&conn, id, ProjectPermission::Edit)?;
    conn.query_row(
        "SELECT owner_user_id, updated_at FROM projects WHERE id = ?1 AND cloud_sync_status = 'conflict'",
        params![id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| conflict_error("项目已不处于冲突状态，请刷新列表"))
}

pub(super) async fn fetch_conflict_remote(
    state: &BackendState,
    id: &str,
    owner: &str,
) -> Result<Value, ApiError> {
    let (base_url, token) = {
        let conn = db_connection(state)?;
        let base_url = cloud_base_url(&conn)
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先配置云端"))?;
        let token = cloud_token(&conn)
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先登录云端"))?;
        (base_url, token)
    };
    let summaries =
        cloud_pull_paginated_items(&base_url, &token, "/api/client/projects", "projects", 100)
            .await?;
    let summary = summaries
        .iter()
        .find(|item| {
            cloud_value_text(item, "localProjectId") == id
                && cloud_value_text(item, "ownerUserId") == owner
        })
        .ok_or_else(|| conflict_error("云端项目不存在或已无访问权限，请联系项目所有者"))?;
    let response = cloud_data_request_json(
        &base_url,
        reqwest::Method::GET,
        &format!("/api/client/projects/{}", cloud_value_text(summary, "id")),
        Some(&token),
        None,
    )
    .await?;
    let project = response
        .get("data")
        .and_then(|data| data.get("project"))
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "云端返回缺少项目内容"))?;
    if cloud_value_text(&project, "localProjectId") != id
        || cloud_value_text(&project, "ownerUserId") != owner
    {
        return Err(conflict_error("云端项目身份不匹配"));
    }
    if !cloud_value_text(&project, "deletedAt").is_empty() {
        return Err(conflict_error(
            "云端项目已删除，请联系项目所有者恢复后再处理",
        ));
    }
    if !project.get("snapshot").is_some_and(Value::is_object)
        || cloud_value_text(&project, "localUpdatedAt").is_empty()
    {
        return Err(conflict_error("云端项目缺少可恢复的快照或版本"));
    }
    Ok(project)
}

fn backup_path(state: &BackendState, backup_id: &str) -> Result<PathBuf, ApiError> {
    let uuid = Uuid::parse_str(backup_id)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "备份编号无效"))?;
    Ok(state
        .data_dir
        .join("project-conflict-backups")
        .join(format!("{uuid}.json")))
}

fn read_backup(state: &BackendState, id: &str, backup_id: &str) -> Result<Value, ApiError> {
    ensure_project_permission(&db_connection(state)?, id, ProjectPermission::Edit)?;
    let bytes = fs::read(backup_path(state, backup_id)?)
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "备份不存在"))?;
    let backup: Value = serde_json::from_slice(&bytes)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if backup.get("projectId").and_then(Value::as_str) != Some(id) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "备份不属于当前项目"));
    }
    Ok(backup)
}

pub(super) async fn api_project_conflict_backup(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let _guard = cloud_session_operation_lock().lock().await;
    let (owner, _) = local_conflict_version(&state, &id)?;
    acquire_conflict_edit_session(&state, &id).await?;
    let remote = fetch_conflict_remote(&state, &id, &owner).await?;
    let Json(local) = api_project_get(Path(id.clone()), State(state.clone())).await?;
    let local = local.get("data").cloned().unwrap_or(Value::Null);
    let (_, current_version) = local_conflict_version(&state, &id)?;
    if local
        .get("project")
        .and_then(|p| p.get("updatedAt"))
        .and_then(Value::as_str)
        != Some(current_version.as_str())
    {
        return Err(conflict_error("本地项目正在变化，请稍后重试"));
    }
    let backup_id = Uuid::new_v4().to_string();
    let backup = json!({"format": "playlet.project-conflict-backup.v1", "projectId": id,
        "ownerUserId": owner, "createdAt": now_iso(), "local": local, "remote": remote});
    let path = backup_path(&state, &backup_id)?;
    fs::create_dir_all(path.parent().unwrap())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let bytes = serde_json::to_vec_pretty(&backup)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(
        json!({"success": true, "data": {"backupId": backup_id,
        "localUpdatedAt": current_version, "remoteUpdatedAt": cloud_value_text(&remote, "localUpdatedAt"),
        "localSceneCount": local.get("scenes").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "remoteSceneCount": remote.get("snapshot").and_then(|s| s.get("scenes")).and_then(Value::as_array).map(Vec::len).unwrap_or(0)}}),
    ))
}

pub(super) async fn api_project_conflict_backup_get(
    Path((id, backup_id)): Path<(String, String)>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    ensure_project_permission(&db_connection(&state)?, &id, ProjectPermission::Export)?;
    Ok(Json(read_backup(&state, &id, &backup_id)?))
}

fn validate_conflict_versions(
    backup: &Value,
    owner: &str,
    local_version: &str,
    remote_version: &str,
) -> Result<(), ApiError> {
    if backup.get("ownerUserId").and_then(Value::as_str) != Some(owner)
        || backup
            .pointer("/local/project/updatedAt")
            .and_then(Value::as_str)
            != Some(local_version)
        || backup
            .pointer("/remote/localUpdatedAt")
            .and_then(Value::as_str)
            != Some(remote_version)
    {
        return Err(conflict_error(
            "本地或云端项目已变化，请重新打开冲突处理并核对版本",
        ));
    }
    Ok(())
}

fn build_conflict_remote_body(remote: &Value) -> Result<Value, ApiError> {
    let snapshot = remote
        .get("snapshot")
        .filter(|value| value.is_object())
        .ok_or_else(|| conflict_error("云端快照无效"))?;
    if !snapshot.get("scenes").is_some_and(Value::is_array)
        || !snapshot.get("characters").is_some_and(Value::is_array)
    {
        return Err(conflict_error("云端快照缺少完整的分镜或人物数据"));
    }
    let mut body = build_cloud_project_put_body(snapshot, remote);
    let script = snapshot.get("script").unwrap_or(&Value::Null);
    for key in [
        "storyIdea",
        "novelText",
        "rawText",
        "selectedStyleId",
        "inputMode",
        "episodePlan",
        "assetWorkflow",
        "writingStudio",
    ] {
        body[key] = script.get(key).cloned().unwrap_or(Value::Null);
    }
    body["scriptTitle"] = script.get("title").cloned().unwrap_or(Value::Null);
    body["parsedData"] = script.get("parsedData").cloned().unwrap_or(Value::Null);
    for key in ["styleId", "aspectRatio", "scriptParseMode"] {
        if let Some(value) = remote
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            body[key] = json!(value);
        }
    }
    if let Some(characters) = body.get_mut("characters").and_then(Value::as_array_mut) {
        for character in characters {
            if let Some(character) = character.as_object_mut() {
                character.entry("voiceAsset").or_insert(Value::Null);
                character.entry("arkAsset").or_insert(Value::Null);
            }
        }
    }
    Ok(body)
}

pub(super) async fn api_project_conflict_resolve(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let strategy = body.get("strategy").and_then(Value::as_str).unwrap_or("");
    if !matches!(strategy, "local" | "remote") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "请选择保留本地或使用云端版本",
        ));
    }
    let backup_id = body.get("backupId").and_then(Value::as_str).unwrap_or("");
    let _guard = cloud_session_operation_lock().lock().await;
    let backup = read_backup(&state, &id, backup_id)?;
    ensure_project_edit_session(&state, &id).await?;
    let (owner, _) = local_conflict_version(&state, &id)?;
    let remote = fetch_conflict_remote(&state, &id, &owner).await?;
    let (current_owner, local_version) = local_conflict_version(&state, &id)?;
    let remote_version = cloud_value_text(&remote, "localUpdatedAt");
    validate_conflict_versions(&backup, &current_owner, &local_version, &remote_version)?;
    if strategy == "local" {
        let resolved_version = now_iso();
        let changed = db_connection(&state)?.execute(
            "UPDATE projects SET cloud_base_updated_at = ?1, updated_at = ?4, cloud_sync_status = 'pending', cloud_sync_error = NULL WHERE id = ?2 AND updated_at = ?3 AND cloud_sync_status = 'conflict'",
            params![remote_version, id, local_version, resolved_version],
        ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if changed != 1 {
            return Err(conflict_error("本地项目已变化，请重新打开冲突处理"));
        }
        if let Err(error) = cloud_sync_project_by_id_locked(&state, &id).await {
            // Keep a retryable, visible conflict rather than letting background retries overwrite later.
            let _ = db_connection(&state)?.execute(
                "UPDATE projects SET cloud_sync_status = 'conflict', cloud_sync_error = ?1 WHERE id = ?2 AND updated_at = ?3",
                params![error.message, id, resolved_version],
            );
            return Err(error);
        }
    } else {
        let put_body = build_conflict_remote_body(&remote)?;
        let _ = api_project_put_inner(
            Path(id.clone()),
            State(state.clone()),
            Json(put_body),
            ProjectPutOptions {
                skip_cloud_sync: true,
                skip_access_check: false,
                preserve_updated_at: Some(remote_version.clone()),
                expected_updated_at: Some(local_version),
            },
        )
        .await?;
    }
    Ok(Json(
        json!({"success": true, "data": {"backupId": backup_id, "strategy": strategy}}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeping_local_uses_reviewed_cloud_version_and_preserves_conflict_on_rejection() {
        for accepted in [true, false] {
            let test = TestProject::new();
            let uploads = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
            let captured = uploads.clone();
            let remote = json!({"id": "cloud-p1", "localProjectId": "p1", "ownerUserId": "owner", "localUpdatedAt": "remote-v1", "snapshot": {
                "project": {"name": "云端"}, "scenes": [], "characters": []
            }});
            let router = Router::new()
                .route("/api/client/projects/edit-session", post(|| async { Json(json!({"success": true, "data": {"editable": true, "canTakeover": true, "token": "test-lease", "expiresAt": Utc::now().timestamp_millis() + 90_000}})) }))
                .route("/api/client/projects", get(|| async { Json(json!({"data": {"projects": [{"id": "cloud-p1", "localProjectId": "p1", "ownerUserId": "owner"}], "pagination": {"totalPages": 1}}})) }))
                .route("/api/client/projects/cloud-p1", get(move || { let remote = remote.clone(); async move { Json(json!({"data": {"project": remote}})) } }))
                .route("/api/client/projects/sync", post(move |Json(body): Json<Value>| {
                    captured.lock().unwrap().push(body);
                    async move { Json(json!({"success": true, "data": {"synced": [{"localProjectId": "p1", "status": if accepted { "synced" } else { "skipped" }, "reason": "stale_local_update"}]}})) }
                }));
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            set_config_json(
                &db_connection(&test.0).unwrap(),
                CLOUD_ADMIN_CONFIG_KEY,
                &json!({"baseUrl": format!("http://{addr}")}),
            )
            .unwrap();
            let Json(prepared) = CURRENT_EDIT_SESSION
                .scope(
                    Some("test-session".into()),
                    api_project_conflict_backup(Path("p1".into()), State(test.0.clone())),
                )
                .await
                .unwrap();
            let backup_id = prepared
                .pointer("/data/backupId")
                .and_then(Value::as_str)
                .unwrap();
            assert!(backup_path(&test.0, backup_id).unwrap().exists());
            let result = CURRENT_EDIT_SESSION
                .scope(
                    Some("test-session".into()),
                    api_project_conflict_resolve(
                        Path("p1".into()),
                        State(test.0.clone()),
                        Json(json!({"strategy": "local", "backupId": backup_id})),
                    ),
                )
                .await;
            assert_eq!(result.is_ok(), accepted);
            let uploads = uploads.lock().unwrap();
            assert_eq!(uploads.len(), 1);
            assert_eq!(uploads[0]["baseUpdatedAt"], "remote-v1");
            assert_eq!(uploads[0]["snapshot"]["project"]["name"], "本地");
            let conn = db_connection(&test.0).unwrap();
            let status: String = conn
                .query_row(
                    "SELECT cloud_sync_status FROM projects WHERE id = 'p1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, if accepted { "synced" } else { "conflict" });
            assert!(read_backup(&test.0, "p1", backup_id).is_ok());
            server.abort();
        }
    }

    struct TestProject(BackendState);

    impl TestProject {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("playlet-conflict-test-{}", Uuid::new_v4()));
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
                &json!({"token": "test", "user": {"id": "owner", "role": "admin"}}),
            )
            .unwrap();
            conn.execute("INSERT INTO projects (id, name, project_type, style_id, aspect_ratio, status, created_at, updated_at, owner_user_id, cloud_sync_status) VALUES ('p1', '本地', 'script_writing', '', '9:16', 'draft', 'local-v1', 'local-v1', 'owner', 'conflict')", []).unwrap();
            Self(state)
        }
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0.data_dir);
        }
    }

    #[tokio::test]
    async fn remote_restore_commits_content_and_sync_version_together() {
        let test = TestProject::new();
        let body = build_conflict_remote_body(&json!({"snapshot": {
            "project": {"name": "云端", "status": "draft"},
            "script": {"rawText": "云端内容"}, "scenes": [], "characters": []
        }}))
        .unwrap();
        let _ = api_project_put_inner(
            Path("p1".into()),
            State(test.0.clone()),
            Json(body),
            ProjectPutOptions {
                skip_cloud_sync: true,
                expected_updated_at: Some("local-v1".into()),
                preserve_updated_at: Some("remote-v1".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let conn = db_connection(&test.0).unwrap();
        let project: (String, String, String) = conn.query_row("SELECT name, cloud_sync_status, cloud_base_updated_at FROM projects WHERE id = 'p1'", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!(
            project,
            ("云端".into(), "synced".into(), "remote-v1".into())
        );
        let raw: String = conn
            .query_row(
                "SELECT raw_text FROM scripts WHERE project_id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&raw).unwrap()["rawText"],
            "云端内容"
        );
    }

    #[tokio::test]
    async fn invalid_remote_restore_rolls_back_project_and_script() {
        let test = TestProject::new();
        let result = api_project_put_inner(Path("p1".into()), State(test.0.clone()), Json(json!({
            "name": "不应保存", "rawText": "不应保存", "scenes": [{"id": "scene-1", "description": 123}]
        })), ProjectPutOptions {
            skip_cloud_sync: true, expected_updated_at: Some("local-v1".into()),
            preserve_updated_at: Some("remote-v1".into()), ..Default::default()
        }).await;
        assert!(result.is_err());
        let conn = db_connection(&test.0).unwrap();
        let project: (String, String, String) = conn
            .query_row(
                "SELECT name, cloud_sync_status, updated_at FROM projects WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            project,
            ("本地".into(), "conflict".into(), "local-v1".into())
        );
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM scripts WHERE project_id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn restore_rejects_changed_local_version_before_writing() {
        let test = TestProject::new();
        let result = api_project_put_inner(
            Path("p1".into()),
            State(test.0.clone()),
            Json(json!({"name": "不应保存"})),
            ProjectPutOptions {
                skip_cloud_sync: true,
                expected_updated_at: Some("stale".into()),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(result.unwrap_err().status, StatusCode::CONFLICT);
        let conn = db_connection(&test.0).unwrap();
        let name: String = conn
            .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "本地");
    }

    #[test]
    fn remote_restore_clears_absent_local_voice_and_script_metadata() {
        let remote = json!({"styleId": "style-1", "aspectRatio": "9:16", "snapshot": {
            "project": {"name": "云端"}, "script": {"rawText": "云端剧本"},
            "scenes": [], "characters": [{"id": "char-1", "name": "阿青"}]
        }});
        let body = build_conflict_remote_body(&remote).unwrap();
        assert_eq!(body["rawText"], "云端剧本");
        assert_eq!(body["styleId"], "style-1");
        assert!(body["assetWorkflow"].is_null());
        assert!(body["writingStudio"].is_null());
        assert!(body["characters"][0]["voiceAsset"].is_null());
        assert!(body["characters"][0]["arkAsset"].is_null());
        assert!(build_conflict_remote_body(&json!({"snapshot": {"scenes": []}})).is_err());
    }

    #[test]
    fn conflict_resolution_requires_both_reviewed_versions_and_owner() {
        let backup = json!({"ownerUserId": "owner", "local": {"project": {"updatedAt": "local-v1"}}, "remote": {"localUpdatedAt": "remote-v1"}});
        assert!(validate_conflict_versions(&backup, "owner", "local-v1", "remote-v1").is_ok());
        assert!(validate_conflict_versions(&backup, "owner", "local-v2", "remote-v1").is_err());
        assert!(validate_conflict_versions(&backup, "owner", "local-v1", "remote-v2").is_err());
        assert!(validate_conflict_versions(&backup, "other", "local-v1", "remote-v1").is_err());
    }
}
