use super::*;

const LIBRARY_MEDIA_TYPES: &[&str] = &["image", "audio"];
const LIBRARY_CATEGORIES: &[&str] = &[
    "character",
    "environment",
    "prop",
    "style",
    "character_voice",
    "narration",
    "bgm",
    "sfx",
    "other",
];
const LIBRARY_SOURCE_TYPES: &[&str] = &["upload", "url", "generated", "project"];
const LIBRARY_VISIBILITIES: &[&str] = &["private", "shared"];

#[derive(Debug, Deserialize)]
pub(super) struct LibraryListQuery {
    #[serde(rename = "mediaType")]
    media_type: Option<String>,
    category: Option<String>,
    keyword: Option<String>,
    favorite: Option<bool>,
    #[serde(rename = "includeDeleted")]
    include_deleted: Option<bool>,
    page: Option<usize>,
    #[serde(rename = "pageSize")]
    page_size: Option<usize>,
}

fn library_json_text(value: Option<&Value>, fallback: &str) -> String {
    value
        .filter(|item| !item.is_null())
        .map(Value::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn library_optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

fn library_required_choice(
    body: &Value,
    key: &str,
    allowed: &[&str],
) -> Result<String, ApiError> {
    let value = library_optional_string(body.get(key)).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{key} 不能为空"),
        )
    })?;
    if !allowed.contains(&value.as_str()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{key} 无效"),
        ));
    }
    Ok(value)
}

fn library_category_media_type(category: &str) -> &'static str {
    if matches!(category, "character_voice" | "narration" | "bgm" | "sfx") {
        "audio"
    } else {
        "image"
    }
}

fn validate_library_category_media_type(
    category: &str,
    media_type: &str,
) -> Result<(), ApiError> {
    if library_category_media_type(category) != media_type {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "资源分类与媒体类型不匹配",
        ));
    }
    Ok(())
}

fn local_library_owner(conn: &Connection) -> (Option<String>, Option<String>, Option<String>) {
    let user = cloud_user_public(conn).unwrap_or(Value::Null);
    (
        library_optional_string(user.get("id")),
        library_optional_string(user.get("account")),
        library_optional_string(user.get("displayName")),
    )
}

fn parse_library_json(raw: Option<String>, fallback: Value) -> Value {
    raw.and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(fallback)
}

fn library_asset_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "id": row.get::<_, String>(0)?,
      "ownerUserId": row.get::<_, Option<String>>(1)?,
      "ownerAccount": row.get::<_, Option<String>>(2)?,
      "ownerDisplayName": row.get::<_, Option<String>>(3)?,
      "mediaType": row.get::<_, String>(4)?,
      "category": row.get::<_, String>(5)?,
      "name": row.get::<_, String>(6)?,
      "description": row.get::<_, String>(7)?,
      "tags": parse_library_json(row.get(8)?, json!([])),
      "url": row.get::<_, String>(9)?,
      "objectKey": row.get::<_, Option<String>>(10)?,
      "mimeType": row.get::<_, Option<String>>(11)?,
      "sizeBytes": row.get::<_, Option<i64>>(12)?,
      "width": row.get::<_, Option<i64>>(13)?,
      "height": row.get::<_, Option<i64>>(14)?,
      "durationMs": row.get::<_, Option<i64>>(15)?,
      "contentHash": row.get::<_, Option<String>>(16)?,
      "perceptualHash": row.get::<_, Option<String>>(17)?,
      "sourceType": row.get::<_, String>(18)?,
      "sourceUrl": row.get::<_, Option<String>>(19)?,
      "sourceProjectId": row.get::<_, Option<String>>(20)?,
      "copyrightNote": row.get::<_, String>(21)?,
      "licenseExpiresAt": row.get::<_, Option<String>>(22)?,
      "favorite": row.get::<_, i64>(23)? != 0,
      "visibility": row.get::<_, String>(24)?,
      "permission": row.get::<_, String>(25)?,
      "useCount": row.get::<_, i64>(26)?,
      "lastUsedAt": row.get::<_, Option<String>>(27)?,
      "bundle": parse_library_json(row.get(28)?, Value::Null),
      "shares": parse_library_json(row.get(29)?, json!([])),
      "version": row.get::<_, i64>(30)?,
      "createdAt": row.get::<_, String>(31)?,
      "updatedAt": row.get::<_, String>(32)?,
      "deletedAt": row.get::<_, Option<String>>(33)?
    }))
}

const LIBRARY_ASSET_SELECT: &str = "
  SELECT id, owner_user_id, owner_account, owner_display_name, media_type, category, name,
         description, tags_json, url, object_key, mime_type, size_bytes, width, height,
         duration_ms, content_hash, perceptual_hash, source_type, source_url, source_project_id,
         copyright_note, license_expires_at, favorite, visibility, permission, use_count,
         last_used_at, bundle_json, shares_json, version, created_at, updated_at, deleted_at
  FROM library_assets";

fn library_asset_by_id(conn: &Connection, id: &str) -> Result<Option<Value>, ApiError> {
    conn.query_row(
        &format!("{LIBRARY_ASSET_SELECT} WHERE id = ?1 LIMIT 1"),
        params![id],
        library_asset_from_row,
    )
    .optional()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn library_search_matches(asset: &Value, keyword: &str) -> bool {
    let keyword = keyword.trim().to_lowercase();
    if keyword.is_empty() {
        return true;
    }
    ["name", "description", "copyrightNote", "sourceUrl"]
        .iter()
        .filter_map(|key| asset.get(key).and_then(Value::as_str))
        .any(|value| value.to_lowercase().contains(&keyword))
        || asset
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| {
                tags.iter().filter_map(Value::as_str).any(|tag| {
                    tag.to_lowercase().contains(&keyword)
                })
            })
}

pub(super) async fn api_library_assets_list(
    State(state): State<BackendState>,
    Query(query): Query<LibraryListQuery>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let mut stmt = conn
        .prepare(&format!("{LIBRARY_ASSET_SELECT} ORDER BY favorite DESC, updated_at DESC"))
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let assets = stmt
        .query_map([], library_asset_from_row)
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let filtered = assets
        .into_iter()
        .filter(|asset| {
            if query.include_deleted != Some(true) && !asset.get("deletedAt").unwrap_or(&Value::Null).is_null() {
                return false;
            }
            if let Some(media_type) = &query.media_type {
                if asset.get("mediaType").and_then(Value::as_str) != Some(media_type.as_str()) {
                    return false;
                }
            }
            if let Some(category) = &query.category {
                if asset.get("category").and_then(Value::as_str) != Some(category.as_str()) {
                    return false;
                }
            }
            if let Some(favorite) = query.favorite {
                if asset.get("favorite").and_then(Value::as_bool) != Some(favorite) {
                    return false;
                }
            }
            query.keyword.as_deref().map_or(true, |keyword| library_search_matches(asset, keyword))
        })
        .collect::<Vec<_>>();
    let total = filtered.len();
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(48).clamp(1, 200);
    let items = filtered
        .into_iter()
        .skip((page - 1) * page_size)
        .take(page_size)
        .collect::<Vec<_>>();

    Ok(Json(json!({
      "success": true,
      "data": { "items": items, "total": total, "page": page, "pageSize": page_size }
    })))
}

async fn persist_library_media(
    state: &BackendState,
    body: &Value,
    media_type: &str,
    prefix: &str,
) -> Result<String, ApiError> {
    if let Some(url) = library_optional_string(body.get("url")) {
        return Ok(url);
    }
    let source = library_optional_string(body.get("mediaData"))
        .or_else(|| library_optional_string(body.get("sourceUrl")))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "缺少媒体内容或网络地址"))?;
    if media_type == "image" {
        persist_image_source(state, &source, prefix).await
    } else {
        persist_audio_source(state, &source, prefix).await
    }
}

fn insert_library_version(
    conn: &Connection,
    asset_id: &str,
    version: i64,
    body: &Value,
    url: &str,
    now: &str,
) -> Result<(), ApiError> {
    conn.execute(
        "INSERT OR REPLACE INTO library_asset_versions
          (id, asset_id, version, url, object_key, mime_type, size_bytes, content_hash, change_note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            format!("libver_{}", Uuid::new_v4().simple()),
            asset_id,
            version,
            url,
            library_optional_string(body.get("objectKey")),
            library_optional_string(body.get("mimeType")),
            body.get("sizeBytes").and_then(Value::as_i64),
            library_optional_string(body.get("contentHash")),
            library_optional_string(body.get("changeNote")).unwrap_or_default(),
            now,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(())
}

fn library_asset_versions(conn: &Connection, asset_id: &str) -> Result<Vec<Value>, ApiError> {
    let mut stmt = conn
        .prepare("SELECT id, asset_id, version, url, object_key, mime_type, size_bytes, content_hash, change_note, created_at FROM library_asset_versions WHERE asset_id = ?1 ORDER BY version DESC")
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let versions = stmt.query_map(params![asset_id], |row| Ok(json!({
      "id": row.get::<_, String>(0)?, "assetId": row.get::<_, String>(1)?,
      "version": row.get::<_, i64>(2)?, "url": row.get::<_, String>(3)?,
      "objectKey": row.get::<_, Option<String>>(4)?, "mimeType": row.get::<_, Option<String>>(5)?,
      "sizeBytes": row.get::<_, Option<i64>>(6)?, "contentHash": row.get::<_, Option<String>>(7)?,
      "changeNote": row.get::<_, String>(8)?, "createdAt": row.get::<_, String>(9)?
    })))
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(versions)
}

async fn sync_library_asset_to_cloud(
    state: &BackendState,
    asset: Value,
    versions: Option<Vec<Value>>,
) {
    let mut payload = json!({ "asset": asset });
    if let Some(versions) = versions {
        payload["versions"] = Value::Array(versions);
    }
    if let Err(error) = cloud_post_client_json(state, "/api/client/library/assets/sync", payload).await {
        eprintln!("[CloudSync] library asset sync failed: {}", error.message);
    }
}

pub(super) async fn create_generated_audio_library_asset(
    state: &BackendState,
    name: &str,
    description: &str,
    category: &str,
    url: &str,
    duration_ms: Option<i64>,
    bundle: Option<Value>,
) -> Result<Value, ApiError> {
    if !matches!(category, "character_voice" | "narration" | "sfx" | "bgm") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "音频素材分类无效"));
    }
    let id = format!("lib_{}", Uuid::new_v4().simple());
    let now = now_iso();
    let conn = db_connection(state)?;
    let (owner_user_id, owner_account, owner_display_name) = local_library_owner(&conn);
    conn.execute(
        "INSERT INTO library_assets
          (id, owner_user_id, owner_account, owner_display_name, media_type, category, name,
           description, tags_json, url, mime_type, duration_ms, source_type, copyright_note,
           favorite, visibility, permission, use_count, bundle_json, shares_json, version,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'audio', ?5, ?6, ?7, '[]', ?8, 'audio/mpeg', ?9,
                 'generated', '', 0, 'private', 'edit', 0, ?10, '[]', 1, ?11, ?12)",
        params![
            id,
            owner_user_id,
            owner_account,
            owner_display_name,
            category,
            name.trim(),
            description.trim(),
            url,
            duration_ms,
            bundle.unwrap_or(Value::Null).to_string(),
            now,
            now,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let version_body = json!({ "mimeType": "audio/mpeg", "durationMs": duration_ms });
    insert_library_version(&conn, &id, 1, &version_body, url, &now)?;
    let asset = library_asset_by_id(&conn, &id)?.ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "语音素材创建后读取失败")
    })?;
    let versions = library_asset_versions(&conn, &id)?;
    drop(conn);
    sync_library_asset_to_cloud(state, asset.clone(), Some(versions)).await;
    Ok(asset)
}

pub(super) async fn api_library_assets_create(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let media_type = library_required_choice(&body, "mediaType", LIBRARY_MEDIA_TYPES)?;
    let category = library_required_choice(&body, "category", LIBRARY_CATEGORIES)?;
    validate_library_category_media_type(&category, &media_type)?;
    let source_type = library_optional_string(body.get("sourceType"))
        .unwrap_or_else(|| if body.get("sourceUrl").is_some() { "url" } else { "upload" }.to_string());
    if !LIBRARY_SOURCE_TYPES.contains(&source_type.as_str()) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "sourceType 无效"));
    }
    let name = library_optional_string(body.get("name"))
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "资源名称不能为空"))?;
    let id = library_optional_string(body.get("id"))
        .unwrap_or_else(|| format!("lib_{}", Uuid::new_v4().simple()));
    let url = persist_library_media(&state, &body, &media_type, &format!("library_{id}")).await?;
    let now = now_iso();
    let conn = db_connection(&state)?;
    let (owner_user_id, owner_account, owner_display_name) = local_library_owner(&conn);
    let visibility = library_optional_string(body.get("visibility")).unwrap_or_else(|| "private".to_string());
    if !LIBRARY_VISIBILITIES.contains(&visibility.as_str()) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "visibility 无效"));
    }
    conn.execute(
        "INSERT INTO library_assets
          (id, owner_user_id, owner_account, owner_display_name, media_type, category, name,
           description, tags_json, url, object_key, mime_type, size_bytes, width, height,
           duration_ms, content_hash, perceptual_hash, source_type, source_url, source_project_id,
           copyright_note, license_expires_at, favorite, visibility, permission, use_count,
           last_used_at, bundle_json, shares_json, version, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, 'edit', 0,
                 NULL, ?26, ?27, 1, ?28, ?29, NULL)",
        params![
            id,
            owner_user_id,
            owner_account,
            owner_display_name,
            media_type,
            category,
            name,
            library_optional_string(body.get("description")).unwrap_or_default(),
            library_json_text(body.get("tags"), "[]"),
            url,
            library_optional_string(body.get("objectKey")),
            library_optional_string(body.get("mimeType")),
            body.get("sizeBytes").and_then(Value::as_i64),
            body.get("width").and_then(Value::as_i64),
            body.get("height").and_then(Value::as_i64),
            body.get("durationMs").and_then(Value::as_i64),
            library_optional_string(body.get("contentHash")),
            library_optional_string(body.get("perceptualHash")),
            source_type,
            library_optional_string(body.get("sourceUrl")),
            library_optional_string(body.get("sourceProjectId")),
            library_optional_string(body.get("copyrightNote")).unwrap_or_default(),
            library_optional_string(body.get("licenseExpiresAt")),
            body.get("favorite").and_then(Value::as_bool).unwrap_or(false) as i64,
            visibility,
            library_json_text(body.get("bundle"), "null"),
            library_json_text(body.get("shares"), "[]"),
            now,
            now,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    insert_library_version(&conn, &id, 1, &body, &url, &now)?;
    let asset = library_asset_by_id(&conn, &id)?.ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "资源创建后读取失败")
    })?;
    let versions = library_asset_versions(&conn, &id)?;
    drop(conn);
    sync_library_asset_to_cloud(&state, asset.clone(), Some(versions)).await;
    Ok(Json(json!({ "success": true, "data": { "asset": asset } })))
}

pub(super) async fn api_library_asset_get(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let asset = library_asset_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "资源不存在"))?;
    let versions = library_asset_versions(&conn, &id)?;
    Ok(Json(json!({ "success": true, "data": { "asset": asset, "versions": versions } })))
}

pub(super) async fn api_library_asset_update(
    Path(id): Path<String>,
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut conn = db_connection(&state)?;
    let existing = library_asset_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "资源不存在"))?;
    if existing.get("permission").and_then(Value::as_str) != Some("edit") {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "当前资源只能查看或使用"));
    }
    let name = library_optional_string(body.get("name"))
        .unwrap_or_else(|| existing.get("name").and_then(Value::as_str).unwrap_or("未命名资源").to_string());
    let category = library_optional_string(body.get("category"))
        .unwrap_or_else(|| existing.get("category").and_then(Value::as_str).unwrap_or("other").to_string());
    if !LIBRARY_CATEGORIES.contains(&category.as_str()) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "category 无效"));
    }
    validate_library_category_media_type(
        &category,
        existing.get("mediaType").and_then(Value::as_str).unwrap_or("image"),
    )?;
    let visibility = library_optional_string(body.get("visibility"))
        .unwrap_or_else(|| existing.get("visibility").and_then(Value::as_str).unwrap_or("private").to_string());
    if !LIBRARY_VISIBILITIES.contains(&visibility.as_str()) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "visibility 无效"));
    }
    let replacement_requested = library_optional_string(body.get("mediaData")).is_some();
    let next_url = if replacement_requested {
        let media_type = existing
            .get("mediaType")
            .and_then(Value::as_str)
            .unwrap_or("image")
            .to_string();
        drop(conn);
        let persisted = persist_library_media(&state, &body, &media_type, &format!("library_{id}_replacement")).await?;
        conn = db_connection(&state)?;
        persisted
    } else {
        library_optional_string(body.get("url"))
            .unwrap_or_else(|| existing.get("url").and_then(Value::as_str).unwrap_or_default().to_string())
    };
    let previous_url = existing.get("url").and_then(Value::as_str).unwrap_or_default();
    let previous_version = existing.get("version").and_then(Value::as_i64).unwrap_or(1);
    let next_version = if next_url != previous_url { previous_version + 1 } else { previous_version };
    let now = now_iso();
    conn.execute(
        "UPDATE library_assets SET name = ?1, category = ?2, description = ?3, tags_json = ?4,
           url = ?5, mime_type = ?6, size_bytes = ?7, width = ?8, height = ?9, duration_ms = ?10,
           content_hash = ?11, perceptual_hash = ?12, source_url = ?13, copyright_note = ?14,
           license_expires_at = ?15, favorite = ?16, visibility = ?17, bundle_json = ?18,
           shares_json = ?19, version = ?20, updated_at = ?21, deleted_at = ?22 WHERE id = ?23",
        params![
            name, category,
            library_optional_string(body.get("description")).or_else(|| library_optional_string(existing.get("description"))).unwrap_or_default(),
            body.get("tags").map(Value::to_string).unwrap_or_else(|| existing.get("tags").cloned().unwrap_or_else(|| json!([])).to_string()),
            next_url,
            library_optional_string(body.get("mimeType")).or_else(|| library_optional_string(existing.get("mimeType"))),
            body.get("sizeBytes").and_then(Value::as_i64).or_else(|| existing.get("sizeBytes").and_then(Value::as_i64)),
            body.get("width").and_then(Value::as_i64).or_else(|| existing.get("width").and_then(Value::as_i64)),
            body.get("height").and_then(Value::as_i64).or_else(|| existing.get("height").and_then(Value::as_i64)),
            body.get("durationMs").and_then(Value::as_i64).or_else(|| existing.get("durationMs").and_then(Value::as_i64)),
            library_optional_string(body.get("contentHash")).or_else(|| library_optional_string(existing.get("contentHash"))),
            library_optional_string(body.get("perceptualHash")).or_else(|| library_optional_string(existing.get("perceptualHash"))),
            library_optional_string(body.get("sourceUrl")).or_else(|| library_optional_string(existing.get("sourceUrl"))),
            library_optional_string(body.get("copyrightNote")).or_else(|| library_optional_string(existing.get("copyrightNote"))).unwrap_or_default(),
            library_optional_string(body.get("licenseExpiresAt")).or_else(|| library_optional_string(existing.get("licenseExpiresAt"))),
            body.get("favorite").and_then(Value::as_bool).or_else(|| existing.get("favorite").and_then(Value::as_bool)).unwrap_or(false) as i64,
            visibility,
            body.get("bundle").map(Value::to_string).unwrap_or_else(|| existing.get("bundle").cloned().unwrap_or(Value::Null).to_string()),
            body.get("shares").map(Value::to_string).unwrap_or_else(|| existing.get("shares").cloned().unwrap_or_else(|| json!([])).to_string()),
            next_version, now,
            if body.get("restore").and_then(Value::as_bool) == Some(true) { None::<String> } else { library_optional_string(existing.get("deletedAt")) },
            id,
        ],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if next_version > previous_version {
        insert_library_version(&conn, &id, next_version, &body, &next_url, &now)?;
    }
    let asset = library_asset_by_id(&conn, &id)?.unwrap_or(Value::Null);
    let versions = library_asset_versions(&conn, &id)?;
    drop(conn);
    sync_library_asset_to_cloud(&state, asset.clone(), Some(versions)).await;
    Ok(Json(json!({ "success": true, "data": { "asset": asset } })))
}

pub(super) async fn api_library_asset_delete(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let existing = library_asset_by_id(&conn, &id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "资源不存在"))?;
    if existing.get("permission").and_then(Value::as_str) != Some("edit") {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "无权删除该资源"));
    }
    let now = now_iso();
    conn.execute(
        "UPDATE library_assets SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![now, now, id],
    )
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let asset = library_asset_by_id(&conn, &id)?.unwrap_or(Value::Null);
    drop(conn);
    sync_library_asset_to_cloud(&state, asset, None).await;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_library_assets_batch(
    State(state): State<BackendState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let ids = body.get("ids").and_then(Value::as_array).ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "ids 不能为空")
    })?;
    let ids = ids.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>();
    if ids.is_empty() || ids.len() > 200 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "ids 数量必须在 1-200 之间"));
    }
    let conn = db_connection(&state)?;
    let now = now_iso();
    let action = library_optional_string(body.get("action")).unwrap_or_default();
    let mut changed = Vec::new();
    for id in ids {
        let Some(existing) = library_asset_by_id(&conn, &id)? else { continue };
        if existing.get("permission").and_then(Value::as_str) != Some("edit") { continue; }
        match action.as_str() {
            "favorite" => {
                let favorite = body.get("favorite").and_then(Value::as_bool).unwrap_or(true) as i64;
                conn.execute("UPDATE library_assets SET favorite = ?1, updated_at = ?2 WHERE id = ?3", params![favorite, now, id])
            }
            "tags" => {
                let tags = library_json_text(body.get("tags"), "[]");
                conn.execute("UPDATE library_assets SET tags_json = ?1, updated_at = ?2 WHERE id = ?3", params![tags, now, id])
            }
            "category" => {
                let category = library_required_choice(&body, "category", LIBRARY_CATEGORIES)?;
                validate_library_category_media_type(
                    &category,
                    existing.get("mediaType").and_then(Value::as_str).unwrap_or("image"),
                )?;
                conn.execute("UPDATE library_assets SET category = ?1, updated_at = ?2 WHERE id = ?3", params![category, now, id])
            }
            "delete" => conn.execute("UPDATE library_assets SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3", params![now, now, id]),
            _ => return Err(ApiError::new(StatusCode::BAD_REQUEST, "action 无效")),
        }
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if let Some(asset) = library_asset_by_id(&conn, &id)? { changed.push(asset); }
    }
    drop(conn);
    for asset in &changed {
        sync_library_asset_to_cloud(&state, asset.clone(), None).await;
    }
    Ok(Json(json!({ "success": true, "data": { "items": changed } })))
}

pub(super) async fn api_library_asset_mark_used(
    Path(id): Path<String>,
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let conn = db_connection(&state)?;
    let now = now_iso();
    let changed = conn.execute(
        "UPDATE library_assets SET use_count = use_count + 1, last_used_at = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        params![now, now, id],
    ).map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if changed == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "资源不存在"));
    }
    let asset = library_asset_by_id(&conn, &id)?.unwrap_or(Value::Null);
    drop(conn);
    sync_library_asset_to_cloud(&state, asset.clone(), None).await;
    Ok(Json(json!({ "success": true, "data": { "asset": asset } })))
}

pub(super) fn remove_revoked_shared_library_assets(
    conn: &Connection,
    current_user_id: &str,
    received_asset_ids: &HashSet<String>,
) -> Result<usize, ApiError> {
    let shared_asset_ids = {
        let mut statement = conn
            .prepare(
                "SELECT id FROM library_assets
                 WHERE owner_user_id IS NOT NULL AND owner_user_id <> ?1",
            )
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let ids = statement
            .query_map(params![current_user_id], |row| row.get::<_, String>(0))
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        ids
    };
    let mut removed = 0usize;
    for asset_id in shared_asset_ids {
        if received_asset_ids.contains(&asset_id) {
            continue;
        }
        removed += conn
            .execute("DELETE FROM library_assets WHERE id = ?1", params![asset_id])
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(removed)
}

pub(super) fn apply_cloud_library_assets(
    state: &BackendState,
    assets: &Value,
) -> Result<usize, ApiError> {
    let Some(items) = assets.as_array() else {
        return Ok(0);
    };
    let mut conn = db_connection(state)?;
    let current_user_id = cloud_user_public(&conn)
        .as_ref()
        .and_then(|user| library_optional_string(user.get("id")));
    let transaction = conn
        .transaction()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut imported = 0usize;
    let mut received_asset_ids = HashSet::new();
    for asset in items {
        let Some(id) = library_optional_string(asset.get("id")) else { continue };
        let Some(media_type) = library_optional_string(asset.get("mediaType")) else { continue };
        let Some(category) = library_optional_string(asset.get("category")) else { continue };
        let Some(name) = library_optional_string(asset.get("name")) else { continue };
        let Some(url) = library_optional_string(asset.get("url")) else { continue };
        if !LIBRARY_MEDIA_TYPES.contains(&media_type.as_str())
            || !LIBRARY_CATEGORIES.contains(&category.as_str())
            || library_category_media_type(&category) != media_type
        {
            continue;
        }
        received_asset_ids.insert(id.clone());
        let remote_updated_at = library_optional_string(asset.get("updatedAt"))
            .unwrap_or_else(now_iso);
        let local_updated_at = transaction
            .query_row(
                "SELECT updated_at FROM library_assets WHERE id = ?1 LIMIT 1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if local_updated_at.as_deref().is_some_and(|local| local > remote_updated_at.as_str()) {
            continue;
        }
        transaction.execute(
            "INSERT INTO library_assets
              (id, owner_user_id, owner_account, owner_display_name, media_type, category, name,
               description, tags_json, url, object_key, mime_type, size_bytes, width, height,
               duration_ms, content_hash, perceptual_hash, source_type, source_url, source_project_id,
               copyright_note, license_expires_at, favorite, visibility, permission, use_count,
               last_used_at, bundle_json, shares_json, version, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                     ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                     ?29, ?30, ?31, ?32, ?33, ?34)
             ON CONFLICT(id) DO UPDATE SET
               owner_user_id = excluded.owner_user_id, owner_account = excluded.owner_account,
               owner_display_name = excluded.owner_display_name, media_type = excluded.media_type,
               category = excluded.category, name = excluded.name, description = excluded.description,
               tags_json = excluded.tags_json, url = excluded.url, object_key = excluded.object_key,
               mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, width = excluded.width,
               height = excluded.height, duration_ms = excluded.duration_ms,
               content_hash = excluded.content_hash, perceptual_hash = excluded.perceptual_hash,
               source_type = excluded.source_type, source_url = excluded.source_url,
               source_project_id = excluded.source_project_id, copyright_note = excluded.copyright_note,
               license_expires_at = excluded.license_expires_at, favorite = excluded.favorite,
               visibility = excluded.visibility, permission = excluded.permission,
               use_count = excluded.use_count, last_used_at = excluded.last_used_at,
               bundle_json = excluded.bundle_json, shares_json = excluded.shares_json,
               version = excluded.version, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
            params![
                id,
                library_optional_string(asset.get("ownerUserId")),
                library_optional_string(asset.get("ownerAccount")),
                library_optional_string(asset.get("ownerDisplayName")),
                media_type,
                category,
                name,
                library_optional_string(asset.get("description")).unwrap_or_default(),
                library_json_text(asset.get("tags"), "[]"),
                url,
                library_optional_string(asset.get("objectKey")),
                library_optional_string(asset.get("mimeType")),
                asset.get("sizeBytes").and_then(Value::as_i64),
                asset.get("width").and_then(Value::as_i64),
                asset.get("height").and_then(Value::as_i64),
                asset.get("durationMs").and_then(Value::as_i64),
                library_optional_string(asset.get("contentHash")),
                library_optional_string(asset.get("perceptualHash")),
                library_optional_string(asset.get("sourceType")).unwrap_or_else(|| "upload".to_string()),
                library_optional_string(asset.get("sourceUrl")),
                library_optional_string(asset.get("sourceProjectId")),
                library_optional_string(asset.get("copyrightNote")).unwrap_or_default(),
                library_optional_string(asset.get("licenseExpiresAt")),
                asset.get("favorite").and_then(Value::as_bool).unwrap_or(false) as i64,
                library_optional_string(asset.get("visibility")).unwrap_or_else(|| "private".to_string()),
                library_optional_string(asset.get("permission")).unwrap_or_else(|| "view".to_string()),
                asset.get("useCount").and_then(Value::as_i64).unwrap_or(0),
                library_optional_string(asset.get("lastUsedAt")),
                library_json_text(asset.get("bundle"), "null"),
                library_json_text(asset.get("shares"), "[]"),
                asset.get("version").and_then(Value::as_i64).unwrap_or(1),
                library_optional_string(asset.get("createdAt")).unwrap_or_else(|| remote_updated_at.clone()),
                remote_updated_at,
                library_optional_string(asset.get("deletedAt")),
            ],
        )
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        if let Some(versions) = asset.get("versions").and_then(Value::as_array) {
            for version in versions {
                let Some(version_number) = version.get("version").and_then(Value::as_i64) else { continue };
                let Some(version_url) = library_optional_string(version.get("url")) else { continue };
                if version_number < 1 {
                    continue;
                }
                let version_id = library_optional_string(version.get("id"))
                    .unwrap_or_else(|| format!("libver_cloud_{}_{}", id, version_number));
                transaction.execute(
                    "INSERT INTO library_asset_versions
                      (id, asset_id, version, url, object_key, mime_type, size_bytes, content_hash, change_note, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT(asset_id, version) DO UPDATE SET
                       url = excluded.url, object_key = excluded.object_key, mime_type = excluded.mime_type,
                       size_bytes = excluded.size_bytes, content_hash = excluded.content_hash,
                       change_note = excluded.change_note, created_at = excluded.created_at",
                    params![
                        version_id,
                        id,
                        version_number,
                        version_url,
                        library_optional_string(version.get("objectKey")),
                        library_optional_string(version.get("mimeType")),
                        version.get("sizeBytes").and_then(Value::as_i64),
                        library_optional_string(version.get("contentHash")),
                        library_optional_string(version.get("changeNote")).unwrap_or_default(),
                        library_optional_string(version.get("createdAt")).unwrap_or_else(|| remote_updated_at.clone()),
                    ],
                )
                .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }
        }
        imported += 1;
    }
    if let Some(current_user_id) = current_user_id {
        remove_revoked_shared_library_assets(&transaction, &current_user_id, &received_asset_ids)?;
    }
    transaction
        .commit()
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(imported)
}

pub(super) async fn api_library_members() -> Result<Json<Value>, ApiError> {
    let (base_url, token) = {
        let conn = config_connection()
            .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "读取本地配置失败"))?;
        (cloud_base_url(&conn), cloud_token(&conn))
    };
    let base_url = base_url
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "未配置云端后台地址"))?;
    let token = token
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "未登录云端账号"))?;
    let response = cloud_request_json(
        &base_url,
        reqwest::Method::GET,
        "/api/client/library/members",
        Some(&token),
        None,
    )
    .await?;
    Ok(Json(response))
}
