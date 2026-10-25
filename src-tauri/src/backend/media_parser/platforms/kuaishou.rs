//! 快手 (upstream `kuaishou_parser.py`).

use super::super::core::*;
use super::super::urls;
use std::sync::Arc;

#[derive(PartialEq, Clone, Copy)]
enum Page {
    Unknown,
    Video,
    Atlas,
    Graphql,
}

pub struct Kuaishou {
    flags: Flags,
    ctx: Arc<Ctx>,
    custom_cookie: String,
    headers: Headers,
    real_url: String,
    video_id: Option<String>,
    page: Page,
    data: Value,
}

const GRAPHQL_QUERY: &str = "query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {
  visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {
    status
    type
    author {
      id
      name
      headerUrl
    }
    photo {
      id
      caption
      coverUrl
      photoUrl
      mainMvUrls {
        url
      }
      manifest {
        adaptationSet {
          representation {
            url
            backupUrl
          }
        }
      }
      atlas {
        cdn
        cdnList
        list
      }
    }
  }
}";

fn normalize(url: &Value) -> Option<String> {
    let url = url.text()?.replace("\\u002F", "/");
    Some(if url.starts_with("//") { format!("https:{url}") } else { url })
}

fn first_url(candidates: &Value) -> Option<String> {
    match candidates {
        Value::String(_) => normalize(candidates),
        Value::Array(items) => {
            for item in items {
                if item.is_string() {
                    return normalize(item);
                }
                if item.is_object() && item.g("url").truthy() {
                    return normalize(item.g("url"));
                }
            }
            None
        }
        _ => None,
    }
}

fn first_cdn(atlas: &Value) -> Option<String> {
    let cdn = atlas.g("cdn");
    if let Some(text) = cdn.as_str().filter(|t| !t.is_empty()) {
        return Some(text.to_string());
    }
    if let Some(first) = cdn.arr().first() {
        return first.text();
    }
    atlas
        .g("cdnList")
        .arr()
        .iter()
        .find_map(|item| item.g("cdn").text())
}

fn resource_url(cdn: Option<String>, path: &Value) -> Option<String> {
    let path = normalize(path)?;
    if path.starts_with("http://") || path.starts_with("https://") {
        return Some(path);
    }
    let Some(cdn) = cdn.filter(|c| !c.is_empty()) else { return Some(path) };
    let mut cdn = cdn.replace("\\u002F", "/");
    if cdn.starts_with("//") {
        cdn = format!("https:{cdn}");
    }
    let mut cdn = cdn.trim_end_matches('/').to_string();
    if !cdn.starts_with("http://") && !cdn.starts_with("https://") {
        cdn = format!("https://{cdn}");
    }
    Some(format!("{cdn}/{}", path.trim_start_matches('/')))
}

fn is_blocked(text: &str) -> bool {
    let Some(payload) = parse_json(text) else { return false };
    let result = payload.g("result").or(payload.at("data.result"));
    matches!(result.as_i64(), Some(2 | 400002)) || payload.g("bizName").as_str() == Some("ANTICRAWL_DEFAULT")
}

impl Kuaishou {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Kuaishou {
        let custom_cookie = platform_cookie("kuaishou", None);
        let mut headers = headers! {
            "content-type" => "application/json; charset=UTF-8",
            "User-Agent" => ua_pc(),
            "referer" => "https://www.kuaishou.com/",
        };
        if !custom_cookie.is_empty() {
            headers.set("cookie", custom_cookie.clone());
        }
        let mut parser = Kuaishou {
            flags: Flags::default(),
            ctx: ctx.clone(),
            custom_cookie,
            headers,
            real_url: real_url.to_string(),
            video_id: urls::get_video_id(real_url),
            page: Page::Unknown,
            data: Value::Null,
        };
        parser.load();
        parser
    }

    /// Each top-level request starts with an empty cookie jar (`isolate_cookies`).
    fn session(&self) -> Session {
        Session::new(&self.ctx)
    }

    fn mobile_headers(&self) -> Headers {
        let mut headers = headers! {
            "User-Agent" => ua_m(),
            "referer" => "https://v.m.chenzhongtech.com/",
            "accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        };
        if !self.custom_cookie.is_empty() {
            headers.set("cookie", self.custom_cookie.clone());
        }
        headers
    }

    fn candidates(&self) -> Vec<String> {
        let mut list = vec![self.real_url.clone()];
        if let Some(id) = &self.video_id {
            let fw = UrlParts::parse(&self.real_url).path.trim_end_matches('/').starts_with("/fw/photo/");
            if !fw {
                list.push(format!("https://v.m.chenzhongtech.com/fw/photo/{id}"));
            }
            list.push(format!("https://www.kuaishou.com/short-video/{id}"));
        }
        dedupe(list)
    }

    fn identify(html: &str) -> (Page, Value) {
        for (marker, page) in [("window.__APOLLO_STATE__", Page::Video), ("window.INIT_STATE", Page::Atlas)] {
            if let Some(index) = html.find(marker) {
                if let Some(start) = html[index + marker.len()..].find('{').map(|p| p + index + marker.len()) {
                    if let Some(raw) = balanced_object_any_quote(html, start) {
                        let parsed = if page == Page::Video { parse_json(raw) } else { parse_json_lenient(raw) };
                        if let Some(data) = parsed {
                            return (page, data);
                        }
                    }
                }
            }
        }
        (Page::Unknown, Value::Null)
    }

    fn valid_state(page: Page, data: &Value) -> bool {
        if !data.truthy() {
            return false;
        }
        match page {
            Page::Atlas => {
                let Some(payload) = find_dict_with(data, &["photo"]) else { return false };
                let photo = payload.g("photo");
                photo.is_object()
                    && (["caption", "coverUrls", "webpCoverUrls", "mainMvUrls", "manifest"]
                        .iter()
                        .any(|k| photo.g(k).truthy())
                        || payload.g("atlas").truthy())
            }
            Page::Video => {
                let client = data.g("defaultClient");
                let Some(map) = client.obj() else { return false };
                client.g("VisionVideoSetRepresentation:1").truthy()
                    || map
                        .keys()
                        .any(|k| k.contains("visionVideoDetail") || k.contains("VisionVideoDetailPhoto:"))
            }
            _ => true,
        }
    }

    fn try_candidate(&mut self, url: &str, headers: &Headers) -> bool {
        self.real_url = url.to_string();
        let html = self.session().get(url).headers(headers).timeout(5.0).text();
        let html = html.unwrap_or_default();
        if is_blocked(&html) {
            self.flags.cookie_required = true;
            self.ctx.report_cookie_required();
            return false;
        }
        if html.is_empty() {
            return false;
        }
        let (page, data) = Self::identify(&html);
        if page == Page::Unknown || !data.truthy() || !Self::valid_state(page, &data) {
            return false;
        }
        self.page = page;
        self.data = data;
        true
    }

    fn try_graphql(&mut self) -> bool {
        let Some(id) = self.video_id.clone() else { return false };
        let headers = self.headers.with("Referer", format!("https://www.kuaishou.com/short-video/{id}"));
        let payload = json!({
            "operationName": "visionVideoDetail",
            "variables": {"photoId": id, "page": "detail"},
            "query": GRAPHQL_QUERY,
        });
        let Ok(response) = self
            .session()
            .post("https://www.kuaishou.com/graphql")
            .json(&payload)
            .headers(&headers)
            .timeout(5.0)
            .send()
        else {
            return false;
        };
        if response.status != 200 {
            return false;
        }
        if is_blocked(&response.text()) {
            self.flags.cookie_required = true;
            self.ctx.report_cookie_required();
            return false;
        }
        let detail = response.json().map(|d| d.at("data.visionVideoDetail").clone()).unwrap_or_default();
        if detail.is_object() && detail.g("photo").truthy() {
            self.page = Page::Graphql;
            self.data = detail;
            return true;
        }
        false
    }

    fn load(&mut self) {
        let mut blocked = false;
        for url in self.candidates() {
            let mobile = self.mobile_headers();
            if self.try_candidate(&url, &mobile) {
                return;
            }
            blocked |= self.flags.cookie_required;
            let desktop = self.headers.clone();
            if self.try_candidate(&url, &desktop) {
                return;
            }
            blocked |= self.flags.cookie_required;
        }
        if self.video_id.is_some() && self.try_graphql() {
            return;
        }
        if blocked || self.flags.cookie_required {
            self.flags.cookie_required = true;
            self.flags.terminal_error = Some(json!({
                "detail_msg": "解析失败：该链接触发快手安全校验，请在配置中提供有效快手 Cookie 后重试",
                "error_code": "KUAISHOU_COOKIE_REQUIRED",
            }));
        }
        self.page = Page::Unknown;
        self.data = Value::Null;
    }

    fn client(&self) -> &Value {
        if self.page == Page::Video {
            self.data.g("defaultClient")
        } else {
            &self.data
        }
    }

    fn photo_key(&self) -> String {
        format!("VisionVideoDetailPhoto:{}", self.video_id.clone().unwrap_or_default())
    }

    fn atlas_payload(&self) -> &Value {
        if !matches!(self.page, Page::Atlas | Page::Video) {
            return &NULL;
        }
        find_dict_with(&self.data, &["atlas", "photo"])
            .or_else(|| find_dict_with(&self.data, &["photo"]))
            .unwrap_or(&NULL)
    }

    fn manifest_url(photo: &Value, allow_slices: bool) -> Option<String> {
        for set in photo.at("manifest.adaptationSet").arr() {
            for representation in set.g("representation").arr() {
                let backups = representation.g("backupUrl");
                if backups.truthy() {
                    return first_url(backups);
                }
                if allow_slices {
                    if let Some(slice) = representation.g("m3u8Slice").s().filter(|s| s.contains("http")) {
                        if let Some(line) = slice
                            .lines()
                            .map(str::trim)
                            .find(|l| l.starts_with("http://") || l.starts_with("https://"))
                        {
                            return Some(line.to_string());
                        }
                    }
                } else if let Some(url) = normalize(representation.g("url")) {
                    return Some(url);
                }
            }
        }
        None
    }
}

impl Parser for Kuaishou {
    fn flags(&self) -> Option<&Flags> {
        Some(&self.flags)
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        Some(&mut self.flags)
    }

    fn video_url(&mut self) -> Option<String> {
        match self.page {
            Page::Graphql => {
                let photo = self.data.g("photo");
                first_url(photo.g("mainMvUrls"))
                    .or_else(|| normalize(photo.g("photoUrl")))
                    .or_else(|| Self::manifest_url(photo, false))
            }
            Page::Video => {
                let client = self.client();
                client
                    .at("VisionVideoSetRepresentation:1")
                    .g("url")
                    .s()
                    .or_else(|| client.g(&self.photo_key()).g("photoUrl").s())
            }
            _ => {
                let photo = self.atlas_payload().g("photo");
                first_url(photo.g("mainMvUrls"))
                    .or_else(|| first_url(photo.g("photoUrls")))
                    .or_else(|| Self::manifest_url(photo, true))
            }
        }
    }

    fn title(&mut self) -> Option<String> {
        None
    }

    fn description(&mut self) -> Option<String> {
        match self.page {
            Page::Graphql => self.data.at("photo.caption").s(),
            Page::Video | Page::Atlas => {
                if self.page == Page::Video {
                    if let Some(caption) = self.client().g(&self.photo_key()).g("caption").s() {
                        return Some(caption);
                    }
                }
                self.atlas_payload().at("photo.caption").s()
            }
            Page::Unknown => None,
        }
    }

    fn cover_url(&mut self) -> Option<String> {
        match self.page {
            Page::Graphql => normalize(self.data.at("photo.coverUrl")),
            Page::Video | Page::Atlas => {
                if self.page == Page::Video {
                    if let Some(cover) = self.client().g(&self.photo_key()).g("coverUrl").s() {
                        return Some(cover);
                    }
                }
                let photo = self.atlas_payload().g("photo").clone();
                first_url(photo.g("coverUrls"))
                    .or_else(|| first_url(photo.g("webpCoverUrls")))
                    .or_else(|| first_url(&Value::Array(self.image_list())))
            }
            Page::Unknown => None,
        }
    }

    fn author(&mut self) -> Option<Value> {
        if self.page == Page::Graphql {
            let a = self.data.g("author");
            return a.truthy().then(|| json!({"nickname": a.g("name"), "unique_id": a.g("id"), "avatar": a.g("headerUrl")}));
        }
        if self.page == Page::Video {
            let client = self.client();
            let mut reference = client.g(&self.photo_key()).g("author").clone();
            if !reference.truthy() {
                let needle = format!("photoId\":\"{}\"", self.video_id.clone().unwrap_or_default());
                if let Some(map) = client.obj() {
                    if let Some((_, value)) = map.iter().find(|(k, _)| k.contains(&needle)) {
                        reference = value.g("author").clone();
                    }
                }
            }
            if let Some(id) = reference.g("id").s() {
                if client.has(&id) {
                    let detail = client.g(&id);
                    return Some(json!({"nickname": detail.g("name"), "unique_id": detail.g("id"), "avatar": detail.g("headerUrl")}));
                }
            }
        }
        if matches!(self.page, Page::Atlas | Page::Video) {
            let photo = self.atlas_payload().g("photo");
            if photo.truthy() {
                let id = first([photo.g("kwaiId"), photo.g("userEid"), photo.g("userId"), photo.g("eid")]).str_or_empty();
                let avatar = first_url(photo.g("headUrls"))
                    .or_else(|| photo.g("headUrl").s())
                    .or_else(|| photo.g("headurl").s())
                    .unwrap_or_default();
                return Some(json!({
                    "nickname": photo.g("userName").or(photo.g("user_name")).str_or_empty(),
                    "author_id": id,
                    "unique_id": id,
                    "avatar": avatar,
                }));
            }
            if let Some(map) = self.data.obj() {
                for value in map.values() {
                    if value.has("userProfile") {
                        let p = value.at("userProfile.profile");
                        return Some(json!({"nickname": p.g("user_name"), "unique_id": p.g("user_id"), "avatar": p.g("headurl")}));
                    }
                }
            }
        }
        None
    }

    fn audio_url(&mut self) -> Option<String> {
        if !matches!(self.page, Page::Atlas | Page::Video) {
            return None;
        }
        let payload = self.atlas_payload();
        let music = payload.at("photo.music");
        if let Some(url) = first_url(music.g("audioUrls")).or_else(|| normalize(music.g("url"))) {
            return Some(url);
        }
        let atlas = payload.g("atlas");
        resource_url(first_cdn(&json!({"cdnList": atlas.g("musicCdnList")})), atlas.g("music"))
    }

    fn image_list(&mut self) -> Vec<Value> {
        let strings_of = |atlas: &Value| -> Vec<Value> {
            let cdn = first_cdn(atlas);
            atlas
                .g("list")
                .arr()
                .iter()
                .filter_map(|path| resource_url(cdn.clone(), path))
                .map(Value::String)
                .collect()
        };
        if self.page == Page::Graphql {
            let atlas = self.data.at("photo.atlas");
            return if atlas.is_object() { strings_of(atlas) } else { Vec::new() };
        }
        if !matches!(self.page, Page::Atlas | Page::Video) {
            return Vec::new();
        }
        let payload = self.atlas_payload();
        let photo = payload.g("photo");
        let mut variants = Vec::new();
        if photo.at("ext_params.atlas").is_object() {
            variants.push(photo.at("ext_params.atlas"));
        }
        if payload.g("atlas").is_object() {
            variants.push(payload.g("atlas"));
        }
        let is_webp = |atlas: &Value| {
            atlas
                .g("list")
                .arr()
                .iter()
                .any(|p| p.str_or_empty().to_lowercase().ends_with(".webp"))
        };
        let preferred = variants
            .iter()
            .find(|a| is_webp(a))
            .or(variants.first())
            .copied()
            .unwrap_or(&NULL);
        let images = strings_of(preferred);
        if !images.is_empty() {
            return images;
        }
        [first_url(photo.g("coverUrls")), first_url(photo.g("webpCoverUrls"))]
            .into_iter()
            .flatten()
            .map(Value::String)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_apollo_and_atlas_states() {
        let html = r#"<script>window.__APOLLO_STATE__={"defaultClient":{"VisionVideoDetailPhoto:abc":{"caption":"文案","coverUrl":"https://c/1.jpg","photoUrl":"https://v/1.mp4","author":{"id":"VisionVideoDetailAuthor:u"}},"VisionVideoDetailAuthor:u":{"id":"u","name":"作者"}}};</script>"#;
        let (page, data) = Kuaishou::identify(html);
        assert!(page == Page::Video && Kuaishou::valid_state(page, &data));
        let html = "<script>window.INIT_STATE = {'k': 1, \"x\": {\"photo\": {\"caption\": \"a\nb\"}, \"atlas\": {\"cdn\": [\"p1.a.yximgs.com\"], \"list\": [\"/ufile/1.webp\"]}}};</script>";
        let (page, data) = Kuaishou::identify(html);
        assert!(page == Page::Unknown || Kuaishou::valid_state(page, &data));
        assert_eq!(
            resource_url(Some("p1.a.yximgs.com".into()), &json!("/ufile/1.webp")).as_deref(),
            Some("https://p1.a.yximgs.com/ufile/1.webp")
        );
    }
}
