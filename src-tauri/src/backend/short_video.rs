use super::*;

#[derive(Deserialize)]
pub(super) struct ShortVideoBody {
    url: String,
}

pub(super) async fn api_tools_short_video_parse(
    State(state): State<BackendState>,
    Json(body): Json<ShortVideoBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = super::media_tools::parse(&state, &body.url).await?;
    Ok(Json(json!({ "success": true, "data": profile })))
}

pub(super) async fn api_tools_short_video_platforms() -> Json<Value> {
    Json(json!({ "success": true, "data": super::media_parser::catalog() }))
}

pub(super) async fn api_tools_short_video_detect(
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let text = query.get("text").map(String::as_str).unwrap_or("");
    let text: String = text.chars().take(2000).collect();
    Json(json!({ "success": true, "data": super::media_parser::detect(&text) }))
}

pub(super) async fn api_tools_short_video_download(
    State(state): State<BackendState>,
    Json(body): Json<super::media_tools::DownloadOptions>,
) -> Result<Json<Value>, ApiError> {
    let result = super::media_tools::download(&state, body).await?;
    Ok(Json(json!({ "success": true, "data": result })))
}

pub(super) async fn api_tools_short_video_history_get(
    State(state): State<BackendState>,
) -> Result<Json<Value>, ApiError> {
    let items = super::media_tools::history(&state)?;
    Ok(Json(json!({ "success": true, "data": { "items": items } })))
}

pub(super) async fn api_tools_short_video_history_delete(
    State(state): State<BackendState>,
    Path((platform, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    super::media_tools::delete_history(&state, platform.trim(), &id)?;
    Ok(Json(json!({ "success": true })))
}

pub(super) async fn api_tools_short_video_preview(
    State(state): State<BackendState>,
    Query(query): Query<HashMap<String, String>>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    super::media_tools::preview(&state, query, headers).await
}
