use super::*;

fn append_prompt_version(
    conn: &Connection,
    template_id: &str,
    content: &str,
    note: Option<String>,
) -> Result<(), ApiError> {
    let mut versions = get_all_prompt_versions(conn)?;
    versions.push(json!({
      "id": format!("v_{}_{}", Utc::now().timestamp_millis(), Uuid::new_v4().simple().to_string().chars().take(4).collect::<String>()),
      "templateId": template_id,
      "content": content,
      "createdAt": now_iso(),
      "note": note
    }));

    let mut template_versions = versions
        .iter()
        .filter(|item| item.get("templateId").and_then(Value::as_str) == Some(template_id))
        .cloned()
        .collect::<Vec<_>>();
    template_versions.sort_by_key(|item| {
        item.get("createdAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    });
    if template_versions.len() > 20 {
        let remove_count = template_versions.len().saturating_sub(20);
        let remove_ids = template_versions
            .into_iter()
            .take(remove_count)
            .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<HashSet<_>>();
        versions.retain(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|id| !remove_ids.contains(id))
                .unwrap_or(true)
        });
    }

    set_config_json(conn, PROMPT_VERSIONS_KEY, &Value::Array(versions))
}

fn get_prompt_versions(conn: &Connection, template_id: &str) -> Result<Vec<Value>, ApiError> {
    let mut versions = get_all_prompt_versions(conn)?
        .into_iter()
        .filter(|item| item.get("templateId").and_then(Value::as_str) == Some(template_id))
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| {
        right
            .get("createdAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(left.get("createdAt").and_then(Value::as_str).unwrap_or(""))
    });
    Ok(versions)
}

fn get_all_prompt_versions(conn: &Connection) -> Result<Vec<Value>, ApiError> {
    let all_versions = get_config_json(conn, PROMPT_VERSIONS_KEY)?.unwrap_or_else(|| json!([]));
    if let Some(list) = all_versions.as_array() {
        return Ok(list.clone());
    }
    if let Some(object) = all_versions.as_object() {
        let mut list = Vec::new();
        for versions in object.values() {
            if let Some(items) = versions.as_array() {
                list.extend(items.iter().cloned());
            }
        }
        return Ok(list);
    }
    Ok(Vec::new())
}

fn prompt_default_snapshot() -> Value {
    json!({
      "templates": default_prompt_templates(),
      "versions": []
    })
}

fn build_prompt_snapshot(conn: &Connection) -> Result<Value, ApiError> {
    Ok(json!({
      "templates": get_prompt_templates_config(conn)?,
      "versions": Value::Array(get_all_prompt_versions(conn)?)
    }))
}

fn normalize_profile_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(64).collect())
    }
}

fn normalize_profile_description(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().chars().take(200).collect::<String>())
        .filter(|value| !value.is_empty())
}

fn profile_list_from_state(state: &Value) -> Result<Vec<Value>, ApiError> {
    state
        .get("profiles")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profiles 数据结构错误"))
}

fn prompt_profile_result(state: &Value) -> Value {
    json!({
      "activeProfileId": state.get("activeProfileId").cloned().unwrap_or(json!("default")),
      "profiles": state.get("profiles").cloned().unwrap_or_else(|| json!([]))
    })
}

fn save_prompt_profile_state(conn: &Connection, state: &Value) -> Result<(), ApiError> {
    set_config_json(conn, PROMPT_PROFILE_STATE_KEY, state)?;
    set_config_json(conn, PROMPT_PROFILES_KEY, &prompt_profile_result(state))
}

fn ensure_prompt_profile_state(conn: &Connection) -> Result<Value, ApiError> {
    let now = now_iso();
    let fallback_snapshot = build_prompt_snapshot(conn)?;
    let mut state = get_config_json(conn, PROMPT_PROFILE_STATE_KEY)?.unwrap_or_else(|| {
        let mut snapshots = serde_json::Map::new();
        snapshots.insert("default".to_string(), prompt_default_snapshot());
        json!({
          "activeProfileId": "default",
          "profiles": [{
            "id": "default",
            "name": "默认配置",
            "createdAt": now,
            "updatedAt": now
          }],
          "snapshots": snapshots
        })
    });

    let object = state.as_object_mut().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "profile state 数据结构错误",
        )
    })?;
    let profile_ids = {
        let profiles = object
            .entry("profiles".to_string())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profiles 数据结构错误")
            })?;
        profiles.retain(|profile| {
            profile.get("id").and_then(Value::as_str) != Some("default_seedance")
        });
        if !profiles
            .iter()
            .any(|profile| profile.get("id").and_then(Value::as_str) == Some("default"))
        {
            profiles.insert(
                0,
                json!({
                  "id": "default",
                  "name": "默认配置",
                  "createdAt": now_iso(),
                  "updatedAt": now_iso()
                }),
            );
        }
        for profile in profiles.iter_mut() {
            if let Some(profile_obj) = profile.as_object_mut() {
                let id = profile_obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("default")
                    .to_string();
                profile_obj.insert("id".to_string(), json!(id.clone()));
                let name = profile_obj
                    .get("name")
                    .and_then(Value::as_str)
                    .and_then(normalize_profile_name)
                    .unwrap_or_else(|| {
                        if id == "default" {
                            "默认配置"
                        } else {
                            "未命名配置"
                        }
                        .to_string()
                    });
                profile_obj.insert("name".to_string(), json!(name));
                if !profile_obj.contains_key("createdAt") {
                    profile_obj.insert("createdAt".to_string(), json!(now_iso()));
                }
                if !profile_obj.contains_key("updatedAt") {
                    let created = profile_obj
                        .get("createdAt")
                        .cloned()
                        .unwrap_or_else(|| json!(now_iso()));
                    profile_obj.insert("updatedAt".to_string(), created);
                }
            }
        }
        profiles.sort_by_key(|profile| {
            if profile.get("id").and_then(Value::as_str) == Some("default") {
                0
            } else {
                1
            }
        });
        profiles
            .iter()
            .filter_map(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<Vec<_>>()
    };

    let snapshots = object
        .entry("snapshots".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "snapshots 数据结构错误")
        })?;
    snapshots.remove("default_seedance");
    snapshots.insert("default".to_string(), prompt_default_snapshot());
    for profile_id in &profile_ids {
        snapshots
            .entry(profile_id.clone())
            .or_insert_with(|| fallback_snapshot.clone());
    }
    for snapshot in snapshots.values_mut() {
        let templates = snapshot
            .get("templates")
            .cloned()
            .map(merge_prompt_templates_with_defaults)
            .unwrap_or_else(default_prompt_templates);
        if let Some(snapshot_object) = snapshot.as_object_mut() {
            snapshot_object.insert("templates".to_string(), templates);
            snapshot_object
                .entry("versions".to_string())
                .or_insert_with(|| json!([]));
        } else {
            *snapshot = json!({
              "templates": templates,
              "versions": []
            });
        }
    }

    let active = object
        .get("activeProfileId")
        .and_then(Value::as_str)
        .map(|value| {
            if value == "default_seedance" {
                "default"
            } else {
                value
            }
        })
        .unwrap_or("default")
        .to_string();
    let active_exists = profile_ids.iter().any(|profile_id| profile_id == &active);
    object.insert(
        "activeProfileId".to_string(),
        json!(if active_exists {
            active
        } else {
            "default".to_string()
        }),
    );

    save_prompt_profile_state(conn, &state)?;
    Ok(state)
}

fn apply_prompt_snapshot(conn: &Connection, snapshot: &Value) -> Result<(), ApiError> {
    let templates = snapshot
        .get("templates")
        .cloned()
        .map(merge_prompt_templates_with_defaults)
        .unwrap_or_else(default_prompt_templates);
    let versions = snapshot
        .get("versions")
        .cloned()
        .unwrap_or_else(|| json!([]));
    set_config_json(conn, PROMPT_TEMPLATES_KEY, &templates)?;
    set_config_json(conn, PROMPT_VERSIONS_KEY, &versions)
}

fn sync_active_prompt_profile_snapshot(conn: &Connection) -> Result<(), ApiError> {
    let mut state = ensure_prompt_profile_state(conn)?;
    let active = state
        .get("activeProfileId")
        .and_then(Value::as_str)
        .unwrap_or("default")
        .to_string();
    if active == "default" {
        return Ok(());
    }
    let snapshot = build_prompt_snapshot(conn)?;
    if let Some(object) = state.as_object_mut() {
        if let Some(snapshots) = object.get_mut("snapshots").and_then(Value::as_object_mut) {
            snapshots.insert(active.clone(), snapshot);
        }
        if let Some(profiles) = object.get_mut("profiles").and_then(Value::as_array_mut) {
            if let Some(profile) = profiles
                .iter_mut()
                .find(|profile| profile.get("id").and_then(Value::as_str) == Some(active.as_str()))
                .and_then(Value::as_object_mut)
            {
                profile.insert("updatedAt".to_string(), json!(now_iso()));
            }
        }
    }
    save_prompt_profile_state(conn, &state)
}

fn assert_active_prompt_profile_writable(conn: &Connection) -> Result<(), ApiError> {
    let state = ensure_prompt_profile_state(conn)?;
    if state.get("activeProfileId").and_then(Value::as_str) == Some("default") {
        Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "内置默认配置不可修改，请先新建并切换到其他配置方案",
        ))
    } else {
        Ok(())
    }
}

pub(super) async fn api_prompts_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let templates = get_prompt_templates_config(&conn)?;
    let profiles =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);

    Ok(Json(json!({
      "success": true,
      "data": {
        "templates": templates,
        "profiles": profiles.get("profiles").cloned().unwrap_or_else(|| json!([])),
        "activeProfileId": profiles.get("activeProfileId").cloned().unwrap_or(json!("default"))
      }
    })))
}

pub(super) async fn api_prompts_single_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模板 ID"));
    }
    let conn = db_connection(&state)?;
    let templates = get_prompt_templates_config(&conn)?;
    let found = templates
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;
    Ok(Json(json!({ "success": true, "data": found })))
}

pub(super) async fn api_prompts_single_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<PutPromptBody>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模板 ID"));
    }
    let conn = db_connection(&state)?;
    assert_active_prompt_profile_writable(&conn)?;
    let mut templates = get_prompt_templates_config(&conn)?;
    let list = templates
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "模板数据结构错误"))?;
    let item = list
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;
    let previous_content = item
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if let Some(obj) = item.as_object_mut() {
        obj.insert("content".to_string(), json!(body.content));
        obj.insert("isCustomized".to_string(), json!(true));
        obj.insert("updatedAt".to_string(), json!(now_iso()));
    }
    let updated = item.clone();
    append_prompt_version(&conn, &id, &previous_content, body.note)?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
    sync_active_prompt_profile_snapshot(&conn)?;
    Ok(Json(
        json!({ "success": true, "data": updated, "message": "模板更新成功" }),
    ))
}

pub(super) async fn api_prompts_versions_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模板 ID"));
    }
    let conn = db_connection(&state)?;
    let versions = get_prompt_versions(&conn, &id)?;
    Ok(Json(json!({
      "success": true,
      "data": {
        "templateId": id,
        "versions": versions,
        "count": versions.len()
      }
    })))
}

pub(super) async fn api_prompts_single_reset(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模板 ID"));
    }
    let conn = db_connection(&state)?;
    assert_active_prompt_profile_writable(&conn)?;
    let defaults = default_prompt_templates();
    let default_template = defaults
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;

    let mut templates = get_prompt_templates_config(&conn)?;
    let (previous_content, updated_template) = {
        let list = templates
            .as_array_mut()
            .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "模板数据结构错误"))?;
        let item = list
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;
        let previous_content = item
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        *item = default_template.clone();
        if let Some(obj) = item.as_object_mut() {
            obj.insert("updatedAt".to_string(), json!(now_iso()));
            obj.insert("isCustomized".to_string(), json!(false));
        }
        (previous_content, item.clone())
    };
    append_prompt_version(
        &conn,
        &id,
        &previous_content,
        Some("重置前的版本".to_string()),
    )?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
    sync_active_prompt_profile_snapshot(&conn)?;
    Ok(Json(json!({
      "success": true,
      "data": updated_template,
      "message": "模板已重置为默认值"
    })))
}

pub(super) async fn api_prompts_single_restore(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模板 ID"));
    }
    let version_id = body
        .get("versionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "版本 ID 不能为空"))?
        .to_string();

    let conn = db_connection(&state)?;
    assert_active_prompt_profile_writable(&conn)?;
    let versions = get_prompt_versions(&conn, &id)?;
    let target = versions
        .iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(version_id.as_str()))
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板或版本不存在"))?;
    let restore_content = target
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut templates = get_prompt_templates_config(&conn)?;
    let (previous_content, updated_template) = {
        let list = templates
            .as_array_mut()
            .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "模板数据结构错误"))?;
        let item = list
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;
        let previous_content = item
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        if let Some(obj) = item.as_object_mut() {
            obj.insert("content".to_string(), json!(restore_content));
            obj.insert("isCustomized".to_string(), json!(true));
            obj.insert("updatedAt".to_string(), json!(now_iso()));
        }
        (previous_content, item.clone())
    };
    append_prompt_version(
        &conn,
        &id,
        &previous_content,
        Some(format!("恢复到版本 {}", version_id)),
    )?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
    sync_active_prompt_profile_snapshot(&conn)?;
    Ok(Json(json!({
      "success": true,
      "data": updated_template,
      "message": "已恢复到指定版本"
    })))
}

pub(super) async fn api_prompts_reset_all(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    assert_active_prompt_profile_writable(&conn)?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &default_prompt_templates())?;
    set_config_json(&conn, PROMPT_VERSIONS_KEY, &json!([]))?;
    sync_active_prompt_profile_snapshot(&conn)?;
    let templates = get_prompt_templates_config(&conn)?;
    Ok(Json(
        json!({ "success": true, "data": templates, "message": "所有模板已重置为默认值" }),
    ))
}

pub(super) async fn api_prompt_profiles_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let state = ensure_prompt_profile_state(&conn)?;
    if state.get("activeProfileId").and_then(Value::as_str) == Some("default") {
        if let Some(snapshot) = state
            .get("snapshots")
            .and_then(|value| value.get("default"))
        {
            apply_prompt_snapshot(&conn, snapshot)?;
        }
    }
    Ok(Json(json!({
      "success": true,
      "data": prompt_profile_result(&state)
    })))
}

pub(super) async fn api_prompt_profiles_post(
    State(state): State<BackendState>,
    Json(body): Json<CreateProfileBody>,
) -> Result<Json<Value>, ApiError> {
    let Some(name) = normalize_profile_name(&body.name) else {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name 不能为空"));
    };
    if body.name.trim().chars().count() > 64 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "配置名称不能超过 64 个字符",
        ));
    }
    if body
        .description
        .as_deref()
        .unwrap_or("")
        .trim()
        .chars()
        .count()
        > 200
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "描述不能超过 200 个字符",
        ));
    }

    let conn = db_connection(&state)?;
    let mut profiles_payload = ensure_prompt_profile_state(&conn)?;
    let now = now_iso();
    let new_id = format!("profile_{}", Uuid::new_v4().simple());
    let source_id = body
        .clone_from_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            profiles_payload
                .get("snapshots")
                .and_then(|snapshots| snapshots.get(value))
                .map(|_| value.to_string())
        })
        .or_else(|| {
            profiles_payload
                .get("activeProfileId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "default".to_string());
    let mut snapshot = profiles_payload
        .get("snapshots")
        .and_then(|snapshots| snapshots.get(&source_id))
        .cloned()
        .unwrap_or_else(prompt_default_snapshot);
    if source_id == "default" {
        if let Some(templates) = snapshot.get_mut("templates").and_then(Value::as_array_mut) {
            for template in templates {
                if let Some(obj) = template.as_object_mut() {
                    obj.insert("isCustomized".to_string(), json!(false));
                }
            }
        }
    }
    let item = json!({
      "id": new_id,
      "name": name,
      "description": normalize_profile_description(body.description),
      "createdAt": now,
      "updatedAt": now
    });

    if let Some(obj) = profiles_payload.as_object_mut() {
        let list = obj
            .entry("profiles".to_string())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profiles 数据结构错误")
            })?;
        list.push(item);
        if let Some(snapshots) = obj.get_mut("snapshots").and_then(Value::as_object_mut) {
            snapshots.insert(new_id.clone(), snapshot);
        }
        if body.activate.unwrap_or(false) {
            let selected_snapshot = obj
                .get("snapshots")
                .and_then(|snapshots| snapshots.get(&new_id))
                .cloned()
                .ok_or_else(|| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profile 快照缺失")
                })?;
            apply_prompt_snapshot(&conn, &selected_snapshot)?;
            obj.insert("activeProfileId".to_string(), json!(new_id));
        }
    }

    save_prompt_profile_state(&conn, &profiles_payload)?;
    Ok(Json(json!({
      "success": true,
      "data": prompt_profile_result(&profiles_payload),
      "message": "提示词配置方案创建成功"
    })))
}

pub(super) async fn api_prompt_profiles_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少配置 ID"));
    }
    if id == "default" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "内置默认配置不可修改，请先新建并切换到其他配置方案",
        ));
    }
    if body.name.is_none() && body.description.is_none() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "至少提供一个可更新字段",
        ));
    }
    if let Some(name) = body.name.as_deref() {
        if name.trim().is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "配置名称不能为空"));
        }
        if name.trim().chars().count() > 64 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "配置名称不能超过 64 个字符",
            ));
        }
    }
    if body
        .description
        .as_deref()
        .unwrap_or("")
        .trim()
        .chars()
        .count()
        > 200
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "描述不能超过 200 个字符",
        ));
    }
    let conn = db_connection(&state)?;
    let mut profiles_payload = ensure_prompt_profile_state(&conn)?;

    if let Some(obj) = profiles_payload.as_object_mut() {
        let list = obj
            .get_mut("profiles")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profiles 数据结构错误")
            })?;
        let profile = list
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "提示词配置方案不存在"))?;

        if let Some(profile_obj) = profile.as_object_mut() {
            if let Some(name) = body.name {
                profile_obj.insert(
                    "name".to_string(),
                    json!(normalize_profile_name(&name).unwrap_or(name)),
                );
            }
            if let Some(description) = body.description {
                profile_obj.insert(
                    "description".to_string(),
                    json!(normalize_profile_description(Some(description))),
                );
            }
            profile_obj.insert("updatedAt".to_string(), json!(now_iso()));
        }
    }
    save_prompt_profile_state(&conn, &profiles_payload)?;
    Ok(Json(
        json!({ "success": true, "data": prompt_profile_result(&profiles_payload), "message": "提示词配置方案已更新" }),
    ))
}

pub(super) async fn api_prompt_profiles_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少配置 ID"));
    }
    if id == "default" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "内置默认配置不可修改，请先新建并切换到其他配置方案",
        ));
    }
    let conn = db_connection(&state)?;
    let mut profiles_payload = ensure_prompt_profile_state(&conn)?;

    if let Some(obj) = profiles_payload.as_object_mut() {
        let active = obj
            .get("activeProfileId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let fallback_active = {
            let list = obj
                .get_mut("profiles")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profiles 数据结构错误")
                })?;
            if !list
                .iter()
                .any(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "删除失败，至少需要保留一个配置方案",
                ));
            }
            if list.len() <= 1 {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "删除失败，至少需要保留一个配置方案",
                ));
            }
            list.retain(|item| item.get("id").and_then(Value::as_str) != Some(id.as_str()));

            if active == id {
                Some(
                    list.first()
                        .and_then(|item| item.get("id").and_then(Value::as_str))
                        .unwrap_or("default")
                        .to_string(),
                )
            } else {
                None
            }
        };

        if let Some(snapshots) = obj.get_mut("snapshots").and_then(Value::as_object_mut) {
            snapshots.remove(&id);
        }

        if let Some(fallback) = fallback_active {
            let snapshot = obj
                .get("snapshots")
                .and_then(|snapshots| snapshots.get(&fallback))
                .cloned()
                .ok_or_else(|| {
                    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "profile 快照缺失")
                })?;
            apply_prompt_snapshot(&conn, &snapshot)?;
            obj.insert("activeProfileId".to_string(), json!(fallback));
        }
    }

    save_prompt_profile_state(&conn, &profiles_payload)?;
    Ok(Json(
        json!({ "success": true, "data": prompt_profile_result(&profiles_payload), "message": "提示词配置方案已删除" }),
    ))
}

pub(super) async fn api_prompt_profiles_activate(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少配置 ID"));
    }
    let conn = db_connection(&state)?;
    let mut profiles_payload = ensure_prompt_profile_state(&conn)?;
    let profiles = profile_list_from_state(&profiles_payload)?;
    if !profiles
        .iter()
        .any(|profile| profile.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "提示词配置方案不存在"));
    }
    let snapshot = profiles_payload
        .get("snapshots")
        .and_then(|snapshots| snapshots.get(&id))
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "提示词配置方案不存在"))?;
    apply_prompt_snapshot(&conn, &snapshot)?;
    if let Some(obj) = profiles_payload.as_object_mut() {
        obj.insert("activeProfileId".to_string(), json!(id));
        if let Some(profiles) = obj.get_mut("profiles").and_then(Value::as_array_mut) {
            if let Some(profile) = profiles
                .iter_mut()
                .find(|profile| profile.get("id").and_then(Value::as_str) == Some(id.as_str()))
                .and_then(Value::as_object_mut)
            {
                profile.insert("updatedAt".to_string(), json!(now_iso()));
            }
        }
    }
    save_prompt_profile_state(&conn, &profiles_payload)?;
    Ok(Json(
        json!({ "success": true, "data": prompt_profile_result(&profiles_payload), "message": "已切换提示词配置方案" }),
    ))
}
