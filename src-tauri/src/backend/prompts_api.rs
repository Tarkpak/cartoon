use super::*;

fn append_prompt_version(
    conn: &Connection,
    template_id: &str,
    content: &str,
    note: Option<String>,
) -> Result<(), ApiError> {
    let mut all_versions = get_config_json(conn, PROMPT_VERSIONS_KEY)?.unwrap_or_else(|| json!({}));
    if !all_versions.is_object() {
        all_versions = json!({});
    }

    let versions_obj = all_versions.as_object_mut().ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "提示词版本存储结构错误")
    })?;
    let list_value = versions_obj
        .entry(template_id.to_string())
        .or_insert_with(|| json!([]));
    if !list_value.is_array() {
        *list_value = json!([]);
    }

    let list = list_value.as_array_mut().ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "提示词版本列表结构错误")
    })?;
    list.insert(
        0,
        json!({
          "id": format!("version_{}", Uuid::new_v4().simple()),
          "templateId": template_id,
          "content": content,
          "createdAt": now_iso(),
          "note": note.unwrap_or_else(|| "自动保存版本".to_string())
        }),
    );
    if list.len() > 50 {
        list.truncate(50);
    }

    set_config_json(conn, PROMPT_VERSIONS_KEY, &all_versions)
}

fn get_prompt_versions(conn: &Connection, template_id: &str) -> Result<Vec<Value>, ApiError> {
    let all_versions = get_config_json(conn, PROMPT_VERSIONS_KEY)?.unwrap_or_else(|| json!({}));
    let versions = all_versions
        .get(template_id)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(versions)
}

pub(super) async fn api_prompts_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let templates =
        get_config_json(&conn, PROMPT_TEMPLATES_KEY)?.unwrap_or_else(default_prompt_templates);
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
    let conn = db_connection(&state)?;
    let templates =
        get_config_json(&conn, PROMPT_TEMPLATES_KEY)?.unwrap_or_else(default_prompt_templates);
    let found = templates
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "提示词不存在"))?;
    Ok(Json(json!({ "success": true, "data": found })))
}

pub(super) async fn api_prompts_single_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<PutPromptBody>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut templates =
        get_config_json(&conn, PROMPT_TEMPLATES_KEY)?.unwrap_or_else(default_prompt_templates);
    let list = templates
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "模板数据结构错误"))?;
    let item = list
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "提示词不存在"))?;
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
    if previous_content != body.content {
        append_prompt_version(&conn, &id, &previous_content, body.note)?;
    }
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
    Ok(Json(json!({ "success": true, "data": updated })))
}

pub(super) async fn api_prompts_versions_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
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
    let conn = db_connection(&state)?;
    let defaults = default_prompt_templates();
    let default_template = defaults
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "模板不存在"))?;

    let mut templates =
        get_config_json(&conn, PROMPT_TEMPLATES_KEY)?.unwrap_or_else(default_prompt_templates);
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
        Some("重置为默认值".to_string()),
    )?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
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
    let version_id = body
        .get("versionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "版本 ID 不能为空"))?
        .to_string();

    let conn = db_connection(&state)?;
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

    let mut templates =
        get_config_json(&conn, PROMPT_TEMPLATES_KEY)?.unwrap_or_else(default_prompt_templates);
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
        Some(format!("恢复版本 {}", version_id)),
    )?;
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &templates)?;
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
    set_config_json(&conn, PROMPT_TEMPLATES_KEY, &default_prompt_templates())?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_prompt_profiles_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let profiles =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);
    Ok(Json(json!({
      "success": true,
      "data": profiles
    })))
}

pub(super) async fn api_prompt_profiles_post(
    State(state): State<BackendState>,
    Json(body): Json<CreateProfileBody>,
) -> Result<Json<Value>, ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name 不能为空"));
    }

    let conn = db_connection(&state)?;
    let mut profiles_payload =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);
    let now = now_iso();
    let new_id = format!("profile_{}", Uuid::new_v4().simple());
    let item = json!({
      "id": new_id,
      "name": body.name.trim(),
      "description": body.description.unwrap_or_default(),
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
        if body.activate.unwrap_or(true) {
            obj.insert("activeProfileId".to_string(), json!(new_id));
        }
    }

    set_config_json(&conn, PROMPT_PROFILES_KEY, &profiles_payload)?;
    Ok(Json(json!({
      "success": true,
      "data": profiles_payload
    })))
}

pub(super) async fn api_prompt_profiles_put(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<Value>, ApiError> {
    if id == "default" {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "默认配置不可修改"));
    }
    let conn = db_connection(&state)?;
    let mut profiles_payload =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);

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
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "配置不存在"))?;

        if let Some(profile_obj) = profile.as_object_mut() {
            if let Some(name) = body.name {
                profile_obj.insert("name".to_string(), json!(name));
            }
            if let Some(description) = body.description {
                profile_obj.insert("description".to_string(), json!(description));
            }
            profile_obj.insert("updatedAt".to_string(), json!(now_iso()));
        }
    }
    set_config_json(&conn, PROMPT_PROFILES_KEY, &profiles_payload)?;
    Ok(Json(json!({ "success": true, "data": profiles_payload })))
}

pub(super) async fn api_prompt_profiles_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    if id == "default" {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "默认配置不可删除"));
    }
    let conn = db_connection(&state)?;
    let mut profiles_payload =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);

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

        if let Some(fallback) = fallback_active {
            obj.insert("activeProfileId".to_string(), json!(fallback));
        }
    }

    set_config_json(&conn, PROMPT_PROFILES_KEY, &profiles_payload)?;
    Ok(Json(json!({ "success": true, "data": profiles_payload })))
}

pub(super) async fn api_prompt_profiles_activate(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut profiles_payload =
        get_config_json(&conn, PROMPT_PROFILES_KEY)?.unwrap_or_else(default_prompt_profiles);
    if let Some(obj) = profiles_payload.as_object_mut() {
        obj.insert("activeProfileId".to_string(), json!(id));
    }
    set_config_json(&conn, PROMPT_PROFILES_KEY, &profiles_payload)?;
    Ok(Json(json!({ "success": true, "data": profiles_payload })))
}
