//! 抖音 (upstream `douyin_parser.py`).

use super::super::core::*;
use super::super::signer::BogusSigner;
use super::super::urls;
use std::sync::{Arc, Mutex};

const FALLBACK_TTWID: &str = "1%7CvDWCB8tYdKPbdOlqwNTkDPhizBaV9i91KjYLKJbqurg%7C1723536402%7C314e63000decb79f46b8ff255560b29f4d8c57352dad465b41977db4830b4c7e";
const MOBILE_FEED_ENDPOINTS: &[&str] = &[
    "https://api5-normal-c-hl.amemv.com/aweme/v1/feed/",
    "https://aweme.snssdk.com/aweme/v1/feed/",
];
const MOBILE_FEED_USER_AGENT: &str = "com.ss.android.ugc.aweme/290101 (Linux; U; Android 10; zh_CN; Pixel 4; Build/QQ3A.200805.001; Cronet/TTNetVersion:5f9037be 2023-01-13 QuicVersion:4668bb42 2022-11-21)";
const SHARE_UA: &str = "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";
const DOUYIN_COOKIE_URL: &str = "https://www.douyin.com/";

static TTWID_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn env_int(key: &str, default: usize) -> usize {
    let value = env(key);
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_digit()) {
        value.parse().unwrap_or(default)
    } else {
        default
    }
}

fn env_float(key: &str, default: f64) -> f64 {
    let value = env(key);
    if value.is_empty() {
        default
    } else {
        value.parse().unwrap_or(default)
    }
}

fn api_max_attempts() -> usize {
    env_int("DOUYIN_API_MAX_ATTEMPTS", 2).max(1)
}

fn mobile_feed_enabled() -> bool {
    let value = env("DOUYIN_ENABLE_MOBILE_FEED");
    let value = if value.is_empty() { "1".to_string() } else { value.to_lowercase() };
    matches!(value.as_str(), "1" | "true" | "yes" | "on")
}

pub struct Douyin {
    flags: Flags,
    pub(super) session: Session,
    signer: BogusSigner,
    headers: Headers,
    cookie: String,
    real_url: String,
    is_music: bool,
    is_collection: bool,
    is_lvdetail: bool,
    is_note: bool,
    pub(super) aweme_id: Option<String>,
    ep_id: Option<String>,
    album_id: Option<String>,
    html_content: Option<String>,
    pub(super) data: Value,
}

/// Subclass hook (upstream `fetch_html_data` override): data used before Douyin's own chain.
pub type Prefetch = dyn Fn(&Session, Option<&str>) -> Option<Value>;

impl Douyin {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Douyin {
        Self::with_prefetch(real_url, ctx, None)
    }

    pub fn with_prefetch(real_url: &str, ctx: &Arc<Ctx>, prefetch: Option<&Prefetch>) -> Douyin {
        let signer = BogusSigner::new();
        let headers = headers! {
            "sec-ch-ua" => "\"Google Chrome\";v=\"123\", \"Not:A-Brand\";v=\"8\", \"Chromium\";v=\"123\"",
            "Accept" => "application/json, text/plain, */*",
            "sec-ch-ua-mobile" => "?0",
            "User-Agent" => signer.user_agent(),
            "sec-ch-ua-platform" => "\"Windows\"",
            "Sec-Fetch-Site" => "same-origin",
            "Sec-Fetch-Mode" => "cors",
            "Sec-Fetch-Dest" => "empty",
            "Accept-Language" => "zh-CN,zh;q=0.9,en;q=0.8",
        };
        let url = real_url;
        let has = |needle: &str| url.contains(needle);
        let is_music = has("/music/") || has("/share/music/");
        let is_collection = has("/collection/") || has("/mix/");
        let is_lvdetail = has("/lvdetail/")
            || has("ep_id=")
            || has("episode_id=")
            || has("album_id=")
            || has("/playlet/")
            || has("playlet_id=")
            || has("series_id=");
        let is_note = has("/note/") || has("/slides/");
        let aweme_id = urls::get_video_id(url);
        let query = query_of(url);
        let mut ep_id = query.any(&["ep_id", "episode_id"]);
        let mut album_id = query.any(&["album_id", "playlet_id", "series_id"]);
        if album_id.is_none() {
            album_id = re!(r"/playlet/detail/(\d+)")
                .captures(url)
                .map(|c| c[1].to_string());
        }
        if is_lvdetail && ep_id.is_none() && aweme_id.is_some() && album_id.is_none() {
            ep_id = aweme_id.clone();
        }
        let mut parser = Douyin {
            flags: Flags::default(),
            session: Session::new(ctx),
            signer,
            headers,
            cookie: platform_cookie("douyin", None),
            real_url: url.to_string(),
            is_music,
            is_collection,
            is_lvdetail,
            is_note,
            aweme_id,
            ep_id,
            album_id,
            html_content: None,
            data: Value::Null,
        };
        let prefetched = prefetch.and_then(|hook| hook(&parser.session, parser.aweme_id.as_deref()));
        parser.data = prefetched.or_else(|| parser.fetch_data()).unwrap_or(Value::Null);
        parser
    }

    fn id(&self) -> String {
        self.aweme_id.clone().unwrap_or_default()
    }

    fn fetch_html_content(&mut self) {
        let mut target = self.real_url.clone();
        let mut mobile = false;
        if self.is_lvdetail && self.ep_id.is_some() {
            target = format!("https://www.douyin.com/lvdetail/{}", self.ep_id.as_deref().unwrap());
        } else if self.is_lvdetail && self.album_id.is_some() {
            target = format!(
                "https://www.douyin.com/share/playlet/detail/{}",
                self.album_id.as_deref().unwrap()
            );
        } else if self.is_collection && self.aweme_id.is_some() {
            target = format!("https://www.douyin.com/collection/{}", self.id());
        } else if self.aweme_id.is_some() && !self.is_music {
            target = format!("https://www.iesdouyin.com/share/video/{}", self.id());
            mobile = true;
        }
        let ttwid = self.ttwid();
        let mut headers = self.headers.clone();
        headers.set("Cookie", self.cookie_header(ttwid.as_deref()));
        let uifid = self.uifid();
        if !uifid.is_empty() {
            headers.set("uifid", uifid);
        }
        if mobile {
            headers.set("User-Agent", SHARE_UA);
            headers.set("Referer", "https://www.douyin.com/?is_from_mobile_home=1&recommend=1");
        }
        self.html_content = Some(
            self.session
                .get(&target)
                .headers(&headers)
                .timeout(5.0)
                .send()
                .ok()
                .filter(|r| r.status == 200)
                .map(|r| r.text())
                .unwrap_or_default(),
        );
    }

    fn html_loaded(&mut self) -> Option<String> {
        if self.html_content.as_deref().map_or(true, str::is_empty) {
            self.fetch_html_content();
        }
        self.html_content.clone().filter(|h| !h.is_empty())
    }

    fn cookie_header(&self, ttwid: Option<&str>) -> String {
        let mut parts = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for item in self.cookie.split(';') {
            let Some((key, value)) = item.split_once('=') else { continue };
            let key = key.trim().trim_matches(['\'', '"']).to_string();
            let value = value.trim().trim_matches(['\'', '"']).to_string();
            if key == "__ac_nonce" || key == "__ac_signature" {
                continue;
            }
            if key.starts_with("bd_ticket_guard")
                || key.starts_with("__security")
                || key.starts_with("fpk")
                || matches!(key.as_str(), "_bd_ticket_crypt_cookie" | "x_tt_token" | "sdk_source_info")
            {
                continue;
            }
            if key == "s_v_web_id" && value.starts_with("verify_") && !self.is_lvdetail {
                continue;
            }
            if seen.insert(key.clone()) {
                parts.push(format!("{key}={value}"));
            }
        }
        if let Some(ttwid) = ttwid.filter(|t| !t.is_empty()) {
            if seen.insert("ttwid".into()) {
                parts.push(format!("ttwid={ttwid}"));
            }
        }
        for name in ["__ac_nonce", "__ac_signature", "s_v_web_id", "msToken", "UIFID"] {
            if seen.contains(name) {
                continue;
            }
            if let Some(value) = self.session.cookie(DOUYIN_COOKIE_URL, name).filter(|v| !v.is_empty()) {
                parts.push(format!("{name}={value}"));
                seen.insert(name.to_string());
            }
        }
        parts.join("; ")
    }

    fn uifid(&self) -> String {
        for key in ["DOUYIN_UIFID", "DY_UIFID"] {
            let value = env(key).trim_matches(['\'', '"']).to_string();
            if !value.is_empty() {
                return value;
            }
        }
        if !self.cookie.is_empty() {
            let raw = self.cookie.trim().trim_matches(['\'', '"']);
            if !raw.contains('=') && raw.len() >= 32 {
                return raw.to_string();
            }
            for item in self.cookie.split(';') {
                if let Some((key, value)) = item.split_once('=') {
                    let value = value.trim().trim_matches(['\'', '"']);
                    if key.trim().trim_matches(['\'', '"']).eq_ignore_ascii_case("UIFID") && !value.is_empty() {
                        return value.to_string();
                    }
                }
            }
        }
        self.session
            .cookie(DOUYIN_COOKIE_URL, "UIFID")
            .unwrap_or_default()
    }

    /// x-secsdk-web-signature over the canonical query.
    pub fn sign_secsdk(url: &str, uifid: &str, ts: Option<u64>) -> String {
        if uifid.is_empty() {
            return url.to_string();
        }
        let ts = ts.unwrap_or_else(now_secs);
        let (base, query) = url.split_once('?').unwrap_or((url, ""));
        let safe = "!*'()";
        let mut parts: Vec<String> = query
            .split('&')
            .filter(|pair| !pair.is_empty())
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                format!("{}={}", unquote_plus(k), quote(&unquote_plus(v), safe))
            })
            .collect();
        if !parts.iter().any(|p| p.split('=').next() == Some("uifid")) {
            parts.push(format!("uifid={}", quote(uifid, safe)));
        }
        let signed = format!("{}&timestamp={ts}", parts.join("&"));
        let plain = format!("{uifid}_{ts}_A96D855A08C0A9707F8BEF0D9A527E4E_{signed}");
        format!("{base}?{signed}&x-secsdk-web-signature={}", md5_hex(plain))
    }

    fn ttwid(&self) -> Option<String> {
        let mut cache = TTWID_CACHE.lock().unwrap();
        if let Some(value) = cache.clone() {
            return Some(value);
        }
        let body = json!({
            "region": "cn", "aid": 6383, "need_t": 1, "service": "www.douyin.com",
            "migrate_priority": 0, "cb_url_protocol": "https", "domain": ".douyin.com"
        });
        let ttwid = self
            .session
            .post("https://ttwid.bytedance.com/ttwid/union/register/")
            .body(py_json(&body))
            .timeout(5.0)
            .send()
            .ok()
            .and_then(|r| r.cookie("ttwid"));
        if ttwid.is_some() {
            *cache = ttwid.clone();
        }
        ttwid
    }

    fn is_terminal_failure(data: &Value) -> bool {
        if !data.is_object() {
            return false;
        }
        let filter = data.g("filter_detail");
        if filter.is_object()
            && (filter.g("filter_reason").truthy() || filter.g("detail_msg").truthy() || filter.g("notice").truthy())
        {
            return true;
        }
        if data.g("status_code").int() == 0 && data.g("status_code").is_number() && !filter.is_null() {
            return true;
        }
        let keywords = ["已删除", "不存在", "私密", "权限", "无法查看", "不见了"];
        let status = data.g("status_msg").str_or_empty();
        let filter_msg = filter.g("detail_msg").str_or_empty();
        keywords.iter().any(|k| status.contains(k) || filter_msg.contains(k))
    }

    fn request_api(&mut self, base_api: &str, referer: &str, validate: &dyn Fn(&Value) -> bool, max_attempts: Option<usize>) -> Option<Value> {
        let attempts = max_attempts.unwrap_or_else(api_max_attempts);
        let base_delay = env_float("DOUYIN_RETRY_BASE_DELAY", 0.2);
        let max_delay = env_float("DOUYIN_RETRY_MAX_DELAY", 0.8);
        for attempt in 0..attempts {
            if self.session.ctx().check().is_err() {
                return None;
            }
            let ttwid = self.ttwid().unwrap_or_else(|| FALLBACK_TTWID.to_string());
            let mut headers = self.headers.clone();
            headers.set("Referer", referer);
            headers.set("Cookie", self.cookie_header(Some(&ttwid)));
            let uifid = self.uifid();
            if !uifid.is_empty() {
                headers.set("uifid", uifid.clone());
            }
            let api_url = format!("{base_api}&msToken={}", BogusSigner::ms_token(107));
            let ua = self.signer.user_agent();
            let bogus = self.signer.a_bogus(&api_url, ua)?;
            let mut api_url = format!("{api_url}&a_bogus={bogus}");
            if !uifid.is_empty() {
                api_url = Self::sign_secsdk(&api_url, &uifid, None);
            }
            if let Ok(response) = self.session.get(&api_url).headers(&headers).timeout(8.0).send() {
                if response.status == 200 && !response.bytes.is_empty() {
                    if let Some(data) = response.json() {
                        if validate(&data) {
                            return Some(data);
                        }
                        if Self::is_terminal_failure(&data) {
                            let filter = data.g("filter_detail");
                            let message = first([filter.g("detail_msg"), filter.g("notice"), data.g("status_msg")])
                                .s()
                                .unwrap_or_else(|| "作品权限受限或已被删除".into());
                            let reason = filter.g("filter_reason").s().unwrap_or_else(|| "terminal_status".into());
                            let detail = if filter.truthy() {
                                filter.clone()
                            } else {
                                json!({"filter_reason": reason, "detail_msg": message})
                            };
                            self.flags.terminal_error = Some(detail);
                            return None;
                        }
                    }
                }
            }
            if attempt + 1 < attempts {
                let delay = (base_delay * 2f64.powi(attempt as i32)).min(max_delay);
                if delay > 0.0 {
                    let jitter: f64 = rand::Rng::gen_range(&mut rand::thread_rng(), 1.0..1.5);
                    self.session.ctx().sleep(delay * jitter);
                }
            }
        }
        *TTWID_CACHE.lock().unwrap() = None;
        None
    }

    fn mobile_feed(&self) -> Option<Value> {
        let aweme_id = self.aweme_id.clone()?;
        if !mobile_feed_enabled() {
            return None;
        }
        let headers = headers! {
            "User-Agent" => MOBILE_FEED_USER_AGENT,
            "Accept" => "application/json, text/plain, */*",
        };
        for endpoint in MOBILE_FEED_ENDPOINTS {
            let Ok(response) = self
                .session
                .get(*endpoint)
                .query(&[("aweme_id", aweme_id.as_str()), ("aid", "1128")])
                .headers(&headers)
                .timeout(4.0)
                .send()
            else {
                continue;
            };
            if response.status != 200 || response.bytes.is_empty() {
                continue;
            }
            let Some(data) = response.json() else { continue };
            if let Some(item) = data.g("aweme_list").arr().iter().find(|item| {
                item.g("aweme_id").or(item.g("id")).str_or_empty() == aweme_id
            }) {
                return Some(json!({"aweme_detail": item}));
            }
        }
        None
    }

    fn share_ssr_detail(&mut self) -> Option<Value> {
        if self.aweme_id.is_none() || self.is_music || self.is_collection || self.is_lvdetail {
            return None;
        }
        let html = self.html_loaded()?;
        self.parse_ssr(&html).filter(|data| data.g("aweme_detail").truthy())
    }

    fn find_music_info(data: &Value) -> Option<Value> {
        let mut found = None;
        walk_objects(data, &mut |map| {
            let candidate = if map.get("music_info").is_some_and(Value::is_object) {
                map.get("music_info").cloned()
            } else if map.get("musicInfo").is_some_and(Value::is_object) {
                map.get("musicInfo").cloned()
            } else if map.get("music").is_some_and(|m| m.is_object() && (m.has("play_url") || m.has("title"))) {
                map.get("music").cloned()
            } else if map.contains_key("play_url")
                && (map.contains_key("author") || map.contains_key("owner_nickname") || map.contains_key("title"))
            {
                Some(Value::Object(map.clone()))
            } else {
                None
            };
            found = candidate;
            found.is_some()
        });
        found
    }

    fn find_lvideo_detail(data: &Value) -> Option<Value> {
        let mut found = None;
        walk_objects(data, &mut |map| {
            let value = Value::Object(map.clone());
            found = if map.get("lvideo_detail").is_some_and(Value::is_object) {
                map.get("lvideo_detail").cloned()
            } else if map.get("episode_info").is_some_and(Value::is_object)
                || map.get("album_info").is_some_and(Value::is_object)
                || map.get("episode_list").is_some_and(Value::is_array)
            {
                Some(value)
            } else if (map.contains_key("video") || map.contains_key("play_addr"))
                && (map.contains_key("episode_id") || map.contains_key("episode_name") || map.contains_key("album_id"))
            {
                Some(json!({"episode_info": value}))
            } else {
                None
            };
            found.is_some()
        });
        found
    }

    fn find_aweme_detail(data: &Value, target: Option<&str>) -> Option<Value> {
        let matches = |detail: &Value| {
            target.map_or(true, |id| {
                detail.g("aweme_id").str_or_empty() == id || detail.g("id").str_or_empty() == id
            })
        };
        let mut found = None;
        walk_objects(data, &mut |map| {
            let node = Value::Object(map.clone());
            let info = node.g("videoInfoRes");
            if info.is_object() {
                let list = info.g("item_list").or(info.g("itemList"));
                for item in list.arr() {
                    if item.is_object() && matches(item) {
                        found = Some(item.clone());
                        return true;
                    }
                }
                if target.is_none() && list.i(0).is_object() {
                    found = Some(list.i(0).clone());
                    return true;
                }
            }
            for key in ["aweme_detail", "itemStruct"] {
                let detail = node.g(key);
                if detail.is_object() && matches(detail) {
                    found = Some(detail.clone());
                    return true;
                }
            }
            if (node.has("video") || node.has("images")) && (node.has("desc") || node.has("author")) && matches(&node) {
                found = Some(node);
                return true;
            }
            false
        });
        found
    }

    fn classify(&self, raw: &Value) -> Option<Value> {
        if self.is_music {
            if let Some(music) = Self::find_music_info(raw) {
                return Some(json!({"music_info": music}));
            }
        }
        if self.is_lvdetail {
            if let Some(info) = Self::find_lvideo_detail(raw) {
                return Some(info);
            }
        }
        Self::find_aweme_detail(raw, self.aweme_id.as_deref()).map(|detail| json!({"aweme_detail": detail}))
    }

    fn parse_ssr(&self, html: &str) -> Option<Value> {
        let doc = Html::parse(html);
        if let Some(script) = doc.script_by_id("__UNIVERSAL_DATA_FOR_REHYDRATION__") {
            if let Some(found) = parse_json(script.trim()).and_then(|raw| self.classify(&raw)) {
                return Some(found);
            }
        }
        if let Some(script) = doc.script_by_id("RENDER_DATA") {
            let mut content = script.trim().to_string();
            if content.contains('%') {
                content = unquote(&content);
            }
            if let Some(found) = parse_json(&content).and_then(|raw| self.classify(&raw)) {
                return Some(found);
            }
        }
        for marker in ["_ROUTER_DATA", "_SSR_DATA", "__INIT_PROPS__"] {
            if let Some(found) = json_object_after(html, marker).and_then(|raw| self.classify(&raw)) {
                return Some(found);
            }
        }
        for captures in re!(r#"self\.__pace_f\.push\(\[1,\s*"(.*?)"\]\)"#).captures_iter(html) {
            let Ok(decoded) = serde_json::from_str::<String>(&format!("\"{}\"", &captures[1])) else { continue };
            if !decoded.contains("defaultAwemeInfo") && !decoded.contains("lvideoBrief") {
                continue;
            }
            let Some(colon) = decoded.find(':') else { continue };
            let part = re!(r#":\s*"\$undefined""#).replace_all(&decoded[colon + 1..], ": null");
            let part = re!(r#":\s*"\$L[0-9a-zA-Z_]+""#).replace_all(&part, ": null");
            let Some(parsed) = parse_json(&part) else { continue };
            let dict = parsed.i(3);
            if parsed.arr().len() >= 4 && dict.is_object() {
                let aweme = dict.g("defaultAwemeInfo");
                if aweme.truthy() {
                    let brief = aweme.g("lvideoBrief");
                    let brief_snake = aweme.g("lvideo_brief");
                    let album = brief.g("albumInfo").or(brief_snake.g("album_info"));
                    let episode = first([brief.g("episodeInfo"), brief_snake.g("episode_info"), aweme]);
                    return Some(json!({"aweme_detail": aweme, "album_info": album, "episode_info": episode}));
                }
            }
        }
        None
    }

    fn ssr_fallback(&mut self, accept: &dyn Fn(&Value) -> bool) -> Option<Value> {
        let html = self.html_loaded()?;
        self.parse_ssr(&html).filter(|data| accept(data))
    }

    fn fetch_data(&mut self) -> Option<Value> {
        let id = self.id();
        if self.is_music {
            let api = format!("https://www.douyin.com/aweme/v1/web/music/detail/?music_id={id}&device_platform=webapp&aid=6383&channel=channel_pc_web");
            if let Some(data) = self.request_api(&api, &format!("https://www.douyin.com/music/{id}"), &|d| d.g("music_info").truthy(), None) {
                return Some(data);
            }
            return self.ssr_fallback(&|d| d.g("music_info").truthy());
        }
        if self.is_collection {
            let api = format!("https://www.douyin.com/aweme/v1/web/mix/aweme/?mix_id={id}&cursor=0&count=20&device_platform=webapp&aid=6383&channel=channel_pc_web");
            if let Some(mut data) = self.request_api(
                &api,
                &format!("https://www.douyin.com/collection/{id}"),
                &|d| d.g("aweme_list").truthy() || d.g("mix_info").truthy(),
                None,
            ) {
                if !data.has("aweme_detail") && data.g("aweme_list").truthy() {
                    data["aweme_detail"] = data.g("aweme_list").i(0).clone();
                }
                return Some(data);
            }
            return self.ssr_fallback(&|d| d.g("aweme_detail").truthy() || d.g("mix_info").truthy());
        }
        if self.is_lvdetail {
            let ep_id = self.ep_id.clone().or_else(|| self.aweme_id.clone()).unwrap_or_default();
            let album_id = self.album_id.clone().or_else(|| self.aweme_id.clone()).unwrap_or_default();
            let referer = if self.real_url.contains("playlet") {
                format!("https://www.douyin.com/share/playlet/detail/{album_id}")
            } else {
                format!("https://www.douyin.com/lvdetail/{ep_id}")
            };
            let valid = |d: &Value| {
                d.g("status_code").is_number()
                    && d.g("status_code").int() == 0
                    && ["lvideo_detail", "episode_info", "album_info", "series_info", "playlet_info", "aweme_list", "episode_list"]
                        .iter()
                        .any(|k| d.g(k).truthy())
            };
            let mut candidates = Vec::new();
            if !album_id.is_empty() {
                candidates.push(format!("https://www.douyin.com/aweme/v1/web/series/aweme/?series_id={album_id}&cursor=0&count=20&device_platform=webapp&aid=6383&channel=channel_pc_web"));
            }
            if !ep_id.is_empty() && ep_id != album_id {
                candidates.push(format!("https://www.douyin.com/aweme/v1/web/lvideo/aweme/?episode_id={ep_id}&device_platform=webapp&aid=6383&channel=channel_pc_web"));
            }
            let attempts = (api_max_attempts() / 2).max(2);
            for api in candidates {
                if let Some(data) = self.request_api(&api, &referer, &valid, Some(attempts)) {
                    return Some(data);
                }
            }
            return self.ssr_fallback(&|d| {
                ["lvideo_detail", "episode_info", "album_info", "series_info", "aweme_detail", "aweme_list"]
                    .iter()
                    .any(|k| d.g(k).truthy())
            });
        }
        let detail_api = format!("https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&pc_client_type=1&version_code=190500&version_name=19.5.0&aweme_id={id}");
        let has_detail = |d: &Value| d.g("aweme_detail").truthy();
        if self.is_note {
            let referer = format!("https://www.douyin.com/note/{id}?previous_page=web_code_link");
            if let Some(data) = self.request_api(&detail_api, &referer, &has_detail, None) {
                return Some(data);
            }
            if self.flags.terminal_error.is_some() {
                return None;
            }
            return self.share_ssr_detail();
        }
        if let Some(data) = self.mobile_feed() {
            return Some(data);
        }
        if let Some(data) = self.share_ssr_detail() {
            return Some(data);
        }
        let referer = format!("https://www.douyin.com/video/{id}?previous_page=web_code_link");
        if let Some(data) = self.request_api(&detail_api, &referer, &has_detail, None) {
            return Some(data);
        }
        if self.flags.terminal_error.is_some() {
            return None;
        }
        self.ssr_fallback(&has_detail)
    }

    pub fn build_play_endpoint(video_id: &str, ratio: &str) -> String {
        let vid = video_id.trim();
        if vid.is_empty() || vid.to_lowercase().starts_with("http") || vid.to_lowercase().contains("mp3") {
            return vid.to_string();
        }
        let ratio = if ratio.trim().is_empty() { "default" } else { ratio.trim() };
        format!(
            "https://www.iesdouyin.com/aweme/v1/play/?video_id={}&ratio={}&line=0&is_play_url=1&watermark=0&source=PackSourceEnum_PUBLISH",
            quote(vid, "/"),
            quote(ratio, "/")
        )
    }

    pub fn best_play_url(play_addr: &Value) -> Option<String> {
        if !play_addr.is_object() || !play_addr.truthy() {
            return None;
        }
        let urls: Vec<String> = play_addr
            .g("url_list")
            .or(play_addr.g("download_url_list"))
            .arr()
            .iter()
            .filter_map(|u| u.as_str().filter(|u| !u.trim().is_empty()).map(str::to_string))
            .collect();
        let target = if urls.len() >= 3 { urls.get(2).cloned() } else { urls.first().cloned() };
        if let Some(mut target) = target {
            if target.contains("/playwm/") {
                target = target.replace("/playwm/", "/play/");
            }
            if target.contains("ratio=720p") {
                target = target.replace("ratio=720p", "ratio=1080p");
            }
            return Some(target);
        }
        let uri = play_addr.g("uri").as_str()?.trim().to_string();
        if uri.starts_with("http") {
            return Some(uri.replace("/playwm/", "/play/"));
        }
        if !uri.to_lowercase().contains("mp3") {
            return Some(Self::build_play_endpoint(&uri, "1080p"));
        }
        None
    }

    fn dynamic_list(video: &Value) -> Vec<Value> {
        let dynamic = video
            .at("videoModel.dynamicVideo")
            .or(video.at("video_model.dynamic_video"));
        dynamic
            .g("dynamic_video_list")
            .or(dynamic.g("dynamicVideoList"))
            .arr()
            .to_vec()
    }

    fn main_detail(&self) -> Value {
        let data = &self.data;
        let mut detail = data.g("aweme_detail").clone();
        if !detail.truthy() && self.is_collection && data.g("aweme_list").truthy() {
            detail = data.g("aweme_list").i(0).clone();
        }
        if !detail.truthy() && self.is_lvdetail {
            let lv = data.g("lvideo_detail");
            detail = first([data.g("episode_info"), lv.g("episode_info"), lv]).clone();
            if !detail.truthy() && data.g("episode_list").truthy() {
                detail = data.g("episode_list").i(0).clone();
            } else if !detail.truthy() && data.g("aweme_list").truthy() {
                detail = data.g("aweme_list").i(0).clone();
            }
        }
        detail
    }

    fn first_h264(video: &Value) -> Option<String> {
        let rates = video.g("bit_rate").arr();
        let mut url = None;
        for rate in rates {
            if !rate.g("is_h265").truthy() {
                url = Self::best_play_url(rate.g("play_addr"));
                if url.is_some() {
                    break;
                }
            }
        }
        if url.is_none() && !rates.is_empty() {
            url = Self::best_play_url(rates[0].g("play_addr"));
        }
        url
    }

    fn episodes(&self) -> Vec<Value> {
        let data = &self.data;
        first([data.g("episode_list"), data.g("aweme_list"), data.at("album_info.episode_list")])
            .arr()
            .to_vec()
    }

    fn lv_part(&self, key: &str) -> Value {
        self.data.g(key).or(self.data.g("lvideo_detail").g(key)).clone()
    }
}

fn cover_from(value: &Value) -> Option<String> {
    match value {
        Value::Object(_) => value.g("url_list").or(value.g("urlList")).i(0).s(),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

impl Parser for Douyin {
    fn flags(&self) -> Option<&Flags> {
        Some(&self.flags)
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        Some(&mut self.flags)
    }

    fn video_url(&mut self) -> Option<String> {
        if self.is_music || !self.data.truthy() {
            return None;
        }
        let detail = self.main_detail();
        let video = if detail.g("video").truthy() {
            detail.g("video").clone()
        } else if detail.has("play_addr") || detail.has("bit_rate") {
            detail.clone()
        } else {
            Value::Null
        };
        let rates = video.g("bit_rate").arr();
        let images = detail.g("images").or(detail.g("image_list"));
        if (images.truthy() || detail.g("media_type").int() == 2) && rates.is_empty() {
            return None;
        }
        let mut streams: Vec<((i64, f64, i64, i64, i64), bool, String)> = Vec::new();
        for rate in rates {
            if !rate.is_object() {
                continue;
            }
            let addr = rate.g("play_addr");
            let Some(url) = Self::best_play_url(addr) else { continue };
            let width = addr.g("width").or(rate.g("width")).int();
            let height = addr.g("height").or(rate.g("height")).int();
            let size = addr.g("data_size").or(rate.g("data_size")).int();
            let quality = rate.g("quality_type").or(addr.g("quality_type")).int();
            let direct = if url.contains("/aweme/v1/play/") { 0 } else { 1 };
            streams.push(((width * height, rate.g("bit_rate").num(), size, quality, direct), rate.g("is_h265").truthy(), url));
        }
        if !streams.is_empty() {
            let h264: Vec<_> = streams.iter().filter(|s| !s.1).cloned().collect();
            let mut pool = if h264.is_empty() { streams } else { h264 };
            pool.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            return pool.into_iter().next().map(|s| s.2);
        }
        let mut dynamic = Self::dynamic_list(&video);
        if !dynamic.is_empty() {
            let bitrate = |v: &Value| v.at("video_meta.bitrate").num();
            let mut h264: Vec<Value> = dynamic
                .iter()
                .filter(|v| v.at("video_meta.codec_type").as_str() == Some("h264"))
                .cloned()
                .collect();
            let pool = if h264.is_empty() { &mut dynamic } else { &mut h264 };
            pool.sort_by(|a, b| bitrate(b).partial_cmp(&bitrate(a)).unwrap_or(std::cmp::Ordering::Equal));
            return pool[0].g("main_url").or(pool[0].g("backup_url")).s();
        }
        let download = video.g("download_addr");
        if download.is_object() {
            if let Some(uri) = download.g("uri").s() {
                if !uri.starts_with("http") && !uri.to_lowercase().contains("mp3") {
                    let url = Self::build_play_endpoint(&uri, "default");
                    if !url.is_empty() {
                        return Some(url);
                    }
                }
            }
            if let Some(url) = download
                .g("url_list")
                .arr()
                .iter()
                .find_map(|u| u.as_str().filter(|u| !u.trim().is_empty()))
            {
                return Some(url.trim().to_string());
            }
        }
        for key in ["play_addr_h264", "play_addr", "play_addr_265"] {
            if let Some(url) = Self::best_play_url(video.g(key)) {
                let clean = url.split('?').next().unwrap_or("").to_lowercase();
                if [".mp3", ".m4a", ".aac", ".wav"].iter().any(|ext| clean.ends_with(ext)) || url.contains("ies-music") {
                    continue;
                }
                return Some(url);
            }
        }
        None
    }

    fn video_list(&mut self) -> Vec<String> {
        if self.is_music {
            return Vec::new();
        }
        if self.is_collection && self.data.g("aweme_list").truthy() {
            let urls: Vec<String> = self
                .data
                .g("aweme_list")
                .arr()
                .iter()
                .filter_map(|item| {
                    let video = item.g("video");
                    Self::first_h264(video).or_else(|| Self::best_play_url(video.g("play_addr")))
                })
                .collect();
            if !urls.is_empty() {
                return urls;
            }
        }
        if self.is_lvdetail && self.data.truthy() {
            let urls: Vec<String> = self
                .episodes()
                .iter()
                .filter_map(|item| {
                    let video = if item.g("video").truthy() {
                        item.g("video").clone()
                    } else if item.has("play_addr") || item.has("bit_rate") {
                        item.clone()
                    } else {
                        Value::Null
                    };
                    Self::first_h264(&video)
                        .or_else(|| {
                            Self::dynamic_list(&video)
                                .first()
                                .and_then(|d| d.g("main_url").or(d.g("backup_url")).s())
                        })
                        .or_else(|| Self::best_play_url(video.g("play_addr")))
                })
                .collect();
            if !urls.is_empty() {
                return urls;
            }
        }
        self.video_url().into_iter().collect()
    }

    fn subtitles(&mut self) -> Option<Value> {
        if self.is_music || !self.data.truthy() {
            return None;
        }
        let mut detail = self.data.g("aweme_detail").clone();
        if !detail.truthy() && self.is_lvdetail {
            detail = self.lv_part("episode_info");
            if !detail.truthy() && self.data.g("episode_list").truthy() {
                detail = self.data.g("episode_list").i(0).clone();
            }
        }
        let video = if detail.g("video").truthy() {
            detail.g("video").clone()
        } else if detail.has("cla_info") || detail.has("subtitle_infos") || detail.has("claInfo") {
            detail.clone()
        } else {
            Value::Null
        };
        let cla = first([video.g("cla_info"), video.g("claInfo"), detail.g("claInfo")]);
        let mut captions = first([cla.g("caption_infos"), cla.g("captionInfos"), cla.g("captions")]).arr();
        if captions.is_empty() {
            captions = video.g("subtitle_infos").or(video.g("subtitleInfos")).arr();
        }
        let target = captions
            .iter()
            .find(|c| {
                matches!(c.g("language_code").as_str(), Some("zh-Hans" | "zh" | "zh-CN" | "cmn-Hans"))
            })
            .or_else(|| {
                captions.iter().find(|c| {
                    c.g("url").truthy() || c.g("url_list").truthy() || c.g("urlList").truthy()
                })
            })?;
        let url = target
            .g("url")
            .s()
            .or_else(|| target.g("url_list").or(target.g("urlList")).i(0).s())?;
        let response = self
            .session
            .get(https_str(&url))
            .headers(&self.headers)
            .timeout(5.0)
            .send()
            .ok()?;
        if response.status != 200 {
            return None;
        }
        parse_webvtt(&response.text())
    }

    fn title(&mut self) -> Option<String> {
        let data = &self.data;
        if !data.truthy() {
            return None;
        }
        if self.is_music {
            return data.at("music_info.title").s();
        }
        if self.is_collection {
            if let Some(name) = data.at("mix_info.mix_name").s() {
                return Some(format!("【合集】{name}"));
            }
        }
        if self.is_lvdetail {
            let series = first([data.g("series_info"), data.at("lvideo_detail.series_info"), data.g("playlet_info")]);
            let series_title = first_str([series.g("series_name"), series.g("title"), series.g("name")]).unwrap_or_default();
            let album = self.lv_part("album_info");
            let album_title = first_str([album.g("album_name"), album.g("title"), album.g("name")]).unwrap_or_default();
            let mut ep = self.lv_part("episode_info");
            if !ep.truthy() && data.g("episode_list").truthy() {
                ep = data.g("episode_list").i(0).clone();
            } else if !ep.truthy() && data.g("aweme_list").truthy() {
                let aw = data.g("aweme_list").i(0);
                ep = aw.g("episode_info").or(aw).clone();
            }
            let ep_title = first_str([ep.g("episode_name"), ep.g("title"), ep.g("itemTitle")]).unwrap_or_default();
            let prefix = if self.real_url.contains("playlet") || !series_title.is_empty() { "【短剧】" } else { "【放映厅】" };
            let main = if series_title.is_empty() { album_title } else { series_title };
            if !main.is_empty() && !ep_title.is_empty() && main != ep_title {
                return Some(format!("{prefix}{main} - {ep_title}"));
            }
            if !main.is_empty() {
                return Some(format!("{prefix}{main}"));
            }
            if !ep_title.is_empty() {
                return Some(format!("{prefix}{ep_title}"));
            }
        }
        let aweme = data.g("aweme_detail");
        if !aweme.truthy() {
            let aw = data.g("aweme_list").i(0);
            return aw.g("itemTitle").or(aw.g("desc")).s();
        }
        let title = aweme.g("itemTitle").s();
        let desc = aweme.g("desc").s();
        if let (Some(t), Some(d)) = (&title, &desc) {
            if t.trim() == d.trim() {
                return None;
            }
        }
        title
    }

    fn description(&mut self) -> Option<String> {
        self.data.at("aweme_detail.desc").s()
    }

    fn cover_url(&mut self) -> Option<String> {
        let data = &self.data;
        if !data.truthy() {
            return None;
        }
        if self.is_music {
            let music = data.g("music_info");
            return ["cover_large", "cover_hd", "cover_medium", "cover_thumb"]
                .iter()
                .find_map(|k| music.g(k).g("url_list").i(0).s());
        }
        if self.is_collection {
            if let Some(url) = data.at("mix_info.cover_url.url_list").i(0).s() {
                return Some(url);
            }
        }
        if self.is_lvdetail {
            let keys = ["cover_url", "poster_url", "horizontal_cover", "vertical_cover", "verticalCover", "cover"];
            let series = first([data.g("series_info"), data.at("lvideo_detail.series_info"), data.g("playlet_info")]);
            if let Some(url) = keys.iter().find_map(|k| cover_from(series.g(k))) {
                return Some(url);
            }
            let album = self.lv_part("album_info");
            if let Some(url) = keys.iter().find_map(|k| cover_from(album.g(k))) {
                return Some(url);
            }
            let mut ep = self.lv_part("episode_info");
            if !ep.truthy() && data.g("episode_list").truthy() {
                ep = data.g("episode_list").i(0).clone();
            } else if !ep.truthy() && data.g("aweme_list").truthy() {
                ep = data.g("aweme_list").i(0).clone();
            }
            if let Some(url) = ["cover_url", "poster_url", "origin_cover", "cover", "dynamic_cover"]
                .iter()
                .find_map(|k| cover_from(ep.g(k)))
            {
                return Some(url);
            }
            if let Some(url) = data.at("aweme_detail.video.cover").s() {
                return Some(url);
            }
        }
        let detail = data.g("aweme_detail");
        let video = detail.g("video");
        let video_cover = ["origin_cover", "cover", "dynamic_cover"]
            .iter()
            .find_map(|k| cover_from(video.g(k)));
        video_cover.or_else(|| detail.g("images").i(0).g("url_list").i(0).s())
    }

    fn audio_url(&mut self) -> Option<String> {
        let data = &self.data;
        if !data.truthy() {
            return None;
        }
        if self.is_music {
            return data.at("music_info.play_url.url_list").i(0).s();
        }
        if self.is_lvdetail {
            let ep = self.lv_part("episode_info");
            let aweme = data.g("aweme_detail");
            let music = ep.g("music").or(aweme.g("music"));
            if music.is_object() {
                let play = music.g("play_url").or(music.g("playUrl"));
                if let Some(url) = play.g("url_list").or(play.g("urlList")).i(0).s() {
                    return Some(url);
                }
            }
            let video = aweme.g("video").or(ep.g("video"));
            let dynamic = video.at("videoModel.dynamicVideo").or(video.at("video_model.dynamic_video"));
            for audio in dynamic.g("dynamic_audio_list").or(dynamic.g("dynamicAudioList")).arr() {
                if let Some(url) = audio.g("main_url").or(audio.g("backup_url")).s() {
                    return Some(url);
                }
            }
        }
        data.at("aweme_detail.music.play_url.url_list").i(0).s()
    }

    fn author(&mut self) -> Option<Value> {
        let data = &self.data;
        if !data.truthy() {
            return None;
        }
        if self.is_music {
            let music = data.g("music_info");
            let avatar = music.g("avatar_large").or(music.g("avatar_medium")).g("url_list").i(0);
            let nickname = music.g("author").or(music.g("owner_nickname")).str_or_empty();
            return Some(author(
                nickname,
                music.g("owner_id").or(music.g("sec_uid")).str_or_empty(),
                avatar.clone(),
            ));
        }
        let standard = |author_value: &Value| {
            author(
                author_value.g("nickname").str_or_empty(),
                author_value.g("unique_id").or(author_value.g("short_id")).clone(),
                author_value.at("avatar_thumb.url_list").i(0).clone(),
            )
        };
        if self.is_collection {
            let author_value = data.at("mix_info.author").or(data.at("aweme_detail.author"));
            if author_value.truthy() {
                return Some(standard(author_value));
            }
        }
        if self.is_lvdetail {
            let album = self.lv_part("album_info");
            let ep = self.lv_part("episode_info");
            let aweme = data.g("aweme_detail");
            let author_value = first([album.g("author"), album.g("owner"), ep.g("author"), aweme.g("authorInfo"), aweme.g("author")]);
            if author_value.truthy() {
                let thumb = first([author_value.g("avatar_thumb"), author_value.g("avatarThumb"), author_value.g("avatar"), author_value.g("avatarUri")]);
                let avatar = match thumb {
                    Value::Object(_) => thumb.g("url_list").or(thumb.g("urlList")).i(0).clone(),
                    Value::String(_) => thumb.clone(),
                    _ => Value::Null,
                };
                let id = first([author_value.g("unique_id"), author_value.g("short_id"), author_value.g("uid"), author_value.g("id")]);
                return Some(author(
                    author_value.g("nickname").or(author_value.g("name")).str_or_empty(),
                    id.str_or_empty(),
                    avatar,
                ));
            }
        }
        let author_value = data.at("aweme_detail.author");
        author_value.truthy().then(|| standard(author_value))
    }

    fn image_list(&mut self) -> Vec<Value> {
        if self.is_music || self.is_lvdetail || !self.data.truthy() {
            return Vec::new();
        }
        let data = &self.data;
        let mut detail = data.g("aweme_detail");
        if !detail.truthy() && self.is_collection && data.g("aweme_list").truthy() {
            detail = data.g("aweme_list").i(0);
        }
        if !detail.truthy() {
            detail = data;
        }
        let post = detail.g("image_post_info");
        let images = [
            post.g("images"),
            post.g("image_list"),
            detail.g("images"),
            detail.g("image_list"),
            detail.g("image_infos"),
            detail.g("original_images"),
        ]
        .into_iter()
        .find(|c| !c.arr().is_empty())
        .map(|c| c.arr())
        .unwrap_or(&[]);
        let mut results = Vec::new();
        for img in images {
            if !img.is_object() || !img.truthy() {
                continue;
            }
            let mut url = img
                .g("url_list")
                .arr()
                .iter()
                .filter_map(|u| u.as_str().filter(|u| !u.trim().is_empty()))
                .last()
                .map(str::to_string);
            if url.is_none() {
                for key in ["display_image", "image_url", "image", "origin_cover", "cover", "download_url_list", "download_url"] {
                    let value = img.g(key);
                    match value {
                        Value::Object(_) => {
                            if let Some(u) = value.g("url_list").i(0).s() {
                                url = Some(u);
                                break;
                            }
                        }
                        Value::Array(items) if !items.is_empty() => {
                            url = items[0].as_str().map(str::to_string);
                            break;
                        }
                        Value::String(s) if !s.trim().is_empty() => {
                            url = Some(s.trim().to_string());
                            break;
                        }
                        _ => {}
                    }
                }
            }
            let mut live_video = img.g("video").clone();
            if !live_video.is_object() {
                live_video = ["video_play_addr", "video_download_addr"]
                    .iter()
                    .find(|k| img.g(k).is_object())
                    .map(|k| json!({"play_addr": img.g(k)}))
                    .unwrap_or(Value::Null);
            }
            let mut live = None;
            if live_video.is_object() {
                let vid = first([live_video.at("play_addr.uri"), live_video.at("download_addr.uri"), live_video.g("vid")]);
                if let Some(vid) = vid.as_str().map(str::trim).filter(|v| !v.is_empty()) {
                    if vid.starts_with("http") {
                        live = Some(vid.to_string());
                    } else if !vid.to_lowercase().contains("mp3") {
                        live = Some(Self::build_play_endpoint(vid, "1080p"));
                    }
                }
                if live.is_none() {
                    for key in ["play_addr", "play_addr_h264", "play_addr_lowbr", "download_addr"] {
                        let addr = live_video.g(key);
                        if !addr.is_object() {
                            continue;
                        }
                        if let Some(u) = addr
                            .g("url_list")
                            .or(addr.g("download_url_list"))
                            .arr()
                            .iter()
                            .find_map(|u| u.as_str().filter(|u| !u.trim().is_empty()))
                        {
                            live = Some(u.to_string());
                            break;
                        }
                        if let Some(uri) = addr.g("uri").s() {
                            if !uri.starts_with("http") && !uri.to_lowercase().contains("mp3") {
                                live = Some(Self::build_play_endpoint(&uri, "1080p"));
                                break;
                            }
                        }
                    }
                }
            }
            match (url, live) {
                (url, Some(live)) => results.push(json!({"url": url.unwrap_or_default(), "live_photo_url": live})),
                (Some(url), None) => results.push(Value::String(url)),
                _ => {}
            }
        }
        results
    }
}

fn timestamp_seconds(text: &str) -> f64 {
    let text = text.trim().replace(',', ".");
    let parts: Vec<f64> = match text.split(':').map(|p| p.parse::<f64>()).collect() {
        Ok(parts) => parts,
        Err(_) => return 0.0,
    };
    let value = match parts.as_slice() {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        [m, s] => m * 60.0 + s,
        [s] => *s,
        _ => return 0.0,
    };
    (value * 100.0).round() / 100.0
}

/// WebVTT / SRT into `[{start, end, text}]`.
pub fn parse_webvtt(text: &str) -> Option<Value> {
    let cue = re!(r"((?:\d+:)?\d+:\d+(?:[\.,]\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:[\.,]\d+)?)");
    let mut segments = Vec::new();
    let mut current: Option<(f64, f64)> = None;
    let mut lines: Vec<String> = Vec::new();
    let flush = |current: &mut Option<(f64, f64)>, lines: &mut Vec<String>, segments: &mut Vec<Value>| {
        if let Some((start, end)) = *current {
            if !lines.is_empty() {
                let joined = lines.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
                let clean = re!(r"<[^>]+>").replace_all(&joined, "").trim().to_string();
                if !clean.is_empty() {
                    segments.push(json!({"start": start, "end": end, "text": clean}));
                }
            }
        }
        *current = None;
        lines.clear();
    };
    for line in text.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            flush(&mut current, &mut lines, &mut segments);
            continue;
        }
        if stripped.starts_with("WEBVTT") || stripped.starts_with("NOTE") || stripped.starts_with("STYLE") {
            continue;
        }
        if let Some(c) = cue.captures(stripped) {
            flush(&mut current, &mut lines, &mut segments);
            current = Some((timestamp_seconds(&c[1]), timestamp_seconds(&c[2])));
        } else if current.is_some() {
            lines.push(stripped.to_string());
        }
    }
    flush(&mut current, &mut lines, &mut segments);
    (!segments.is_empty()).then(|| Value::Array(segments))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vtt_and_play_urls() {
        let vtt = "WEBVTT\n\n00:00.640 --> 00:02.120\n<c>第一句</c>\n\n00:00:02.2 --> 00:00:04.5\n第二句\n";
        let segments = parse_webvtt(vtt).unwrap();
        assert_eq!(segments[0], json!({"start": 0.64, "end": 2.12, "text": "第一句"}));
        assert_eq!(segments[1]["end"], 4.5);
        let addr = json!({"url_list": ["https://a/playwm/?ratio=720p", "b", "https://origin/playwm/x"]});
        assert_eq!(Douyin::best_play_url(&addr).as_deref(), Some("https://origin/play/x"));
        assert!(Douyin::best_play_url(&json!({"uri": "v0abc"})).unwrap().contains("video_id=v0abc&ratio=1080p"));
    }

    #[test]
    fn signs_secsdk_like_upstream() {
        let signed = Douyin::sign_secsdk("https://x/api?a=1+2&b=%E4%B8%AD", "uid", Some(10));
        let expected_query = "a=1%202&b=%E4%B8%AD&uifid=uid&timestamp=10";
        let digest = md5_hex(format!("uid_10_A96D855A08C0A9707F8BEF0D9A527E4E_{expected_query}"));
        assert_eq!(signed, format!("https://x/api?{expected_query}&x-secsdk-web-signature={digest}"));
    }
}
