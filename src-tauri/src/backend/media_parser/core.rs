//! Shared helpers for the Rust port of ucmao/media-parser.
//!
//! Parsers run on a blocking thread. Every HTTP request checks the parse
//! deadline and cancellation flag, so a dropped request stops at the next call.

use rand::seq::SliceRandom;
use rand::Rng;
use reqwest::blocking::Client;
use reqwest::cookie::{CookieStore, Jar};
pub use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

pub static NULL: Value = Value::Null;

/// Compile a regex once. Patterns follow Python `re` syntax supported by `regex`.
macro_rules! re {
    ($pattern:expr) => {{
        static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        RE.get_or_init(|| regex::Regex::new($pattern).expect($pattern))
    }};
}
/// Same as `re!` for patterns that need look-around or back-references.
macro_rules! fre {
    ($pattern:expr) => {{
        static RE: std::sync::OnceLock<fancy_regex::Regex> = std::sync::OnceLock::new();
        RE.get_or_init(|| fancy_regex::Regex::new($pattern).expect($pattern))
    }};
}
pub(crate) use fre;
pub(crate) use re;

// ---------------------------------------------------------------------------
// JSON access with Python dict semantics
// ---------------------------------------------------------------------------

pub trait J {
    /// `dict.get(key)`; `Null` when missing or not an object.
    fn g(&self, key: &str) -> &Value;
    /// `list[index]`; `Null` when missing or not an array.
    fn i(&self, index: usize) -> &Value;
    /// Dotted path, numeric segments index arrays: `"a.b.0.c"`.
    fn at(&self, path: &str) -> &Value;
    /// Python truthiness.
    fn truthy(&self) -> bool;
    /// Python `a or b`.
    fn or<'a>(&'a self, other: &'a Value) -> &'a Value;
    /// Non-empty string value.
    fn s(&self) -> Option<String>;
    /// Non-empty string, or a number/bool rendered like `str(x)`.
    fn text(&self) -> Option<String>;
    /// `str(x)` for scalars (`""` for null/containers).
    fn str_or_empty(&self) -> String;
    fn arr(&self) -> &[Value];
    fn obj(&self) -> Option<&Map<String, Value>>;
    fn has(&self, key: &str) -> bool;
    /// `int(x or 0)` tolerant of numeric strings.
    fn int(&self) -> i64;
    fn num(&self) -> f64;
}

impl J for Value {
    fn g(&self, key: &str) -> &Value {
        match self {
            Value::Object(map) => map.get(key).unwrap_or(&NULL),
            _ => &NULL,
        }
    }
    fn i(&self, index: usize) -> &Value {
        match self {
            Value::Array(items) => items.get(index).unwrap_or(&NULL),
            _ => &NULL,
        }
    }
    fn at(&self, path: &str) -> &Value {
        let mut current = self;
        for part in path.split('.') {
            current = match current {
                Value::Object(map) => map.get(part).unwrap_or(&NULL),
                Value::Array(items) => part
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| items.get(index))
                    .unwrap_or(&NULL),
                _ => &NULL,
            };
        }
        current
    }
    fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::Number(number) => number.as_f64().map(|n| n != 0.0).unwrap_or(true),
            Value::String(text) => !text.is_empty(),
            Value::Array(items) => !items.is_empty(),
            Value::Object(map) => !map.is_empty(),
        }
    }
    fn or<'a>(&'a self, other: &'a Value) -> &'a Value {
        if self.truthy() {
            self
        } else {
            other
        }
    }
    fn s(&self) -> Option<String> {
        self.as_str().filter(|s| !s.is_empty()).map(str::to_string)
    }
    fn text(&self) -> Option<String> {
        match self {
            Value::String(text) if !text.is_empty() => Some(text.clone()),
            Value::Number(number) => Some(py_number(number)),
            Value::Bool(value) => Some(if *value { "True" } else { "False" }.into()),
            _ => None,
        }
    }
    fn str_or_empty(&self) -> String {
        match self {
            Value::String(text) => text.clone(),
            Value::Number(number) => py_number(number),
            Value::Bool(value) => if *value { "True" } else { "False" }.into(),
            _ => String::new(),
        }
    }
    fn arr(&self) -> &[Value] {
        match self {
            Value::Array(items) => items,
            _ => &[],
        }
    }
    fn obj(&self) -> Option<&Map<String, Value>> {
        self.as_object()
    }
    fn has(&self, key: &str) -> bool {
        self.as_object().is_some_and(|map| map.contains_key(key))
    }
    fn int(&self) -> i64 {
        match self {
            Value::Number(number) => number
                .as_i64()
                .or_else(|| number.as_f64().map(|n| n as i64))
                .unwrap_or(0),
            Value::String(text) => text.trim().parse::<f64>().map(|n| n as i64).unwrap_or(0),
            Value::Bool(value) => *value as i64,
            _ => 0,
        }
    }
    fn num(&self) -> f64 {
        match self {
            Value::Number(number) => number.as_f64().unwrap_or(0.0),
            Value::String(text) => text.trim().parse::<f64>().unwrap_or(0.0),
            Value::Bool(value) => *value as i64 as f64,
            _ => 0.0,
        }
    }
}

fn py_number(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    let value = number.as_f64().unwrap_or(0.0);
    if value.fract() == 0.0 && value.abs() < 1e16 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

/// First truthy value among candidates (Python `a or b or c`).
pub fn first<'a>(values: impl IntoIterator<Item = &'a Value>) -> &'a Value {
    let mut last = &NULL;
    for value in values {
        if value.truthy() {
            return value;
        }
        last = value;
    }
    last
}

pub fn first_str<'a>(values: impl IntoIterator<Item = &'a Value>) -> Option<String> {
    values.into_iter().find_map(|value| value.s())
}

pub fn opt(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

pub fn author(nickname: impl Into<Value>, author_id: impl Into<Value>, avatar: impl Into<Value>) -> Value {
    json!({"nickname": nickname.into(), "author_id": author_id.into(), "avatar": avatar.into()})
}

pub fn opt_value(value: Option<String>) -> Value {
    value.map(Value::String).unwrap_or(Value::Null)
}

pub fn image_with_live(url: impl Into<String>, live: Option<String>) -> Value {
    match live {
        Some(live) if !live.is_empty() => json!({"url": url.into(), "live_photo_url": live}),
        _ => Value::String(url.into()),
    }
}

pub fn parse_json(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok()
}

/// Python `json.dumps(value)` (default separators, `ensure_ascii=True`).
pub fn py_json(value: &Value) -> String {
    py_json_with(value, ", ", ": ", true)
}

/// Python `json.dumps(value, separators=(',', ':'), ensure_ascii=False)`.
pub fn compact_json(value: &Value) -> String {
    py_json_with(value, ",", ":", false)
}

pub fn py_json_with(value: &Value, item: &str, key: &str, ascii: bool) -> String {
    fn string(out: &mut String, text: &str, ascii: bool) {
        out.push('"');
        for ch in text.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                '\u{08}' => out.push_str("\\b"),
                '\u{0c}' => out.push_str("\\f"),
                c if (c as u32) < 0x20 || (ascii && (c as u32) > 0x7e) => {
                    let mut buf = [0u16; 2];
                    for unit in c.encode_utf16(&mut buf) {
                        out.push_str(&format!("\\u{unit:04x}"));
                    }
                }
                c => out.push(c),
            }
        }
        out.push('"');
    }
    fn walk(out: &mut String, value: &Value, item: &str, key: &str, ascii: bool) {
        match value {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => out.push_str(&n.to_string()),
            Value::String(s) => string(out, s, ascii),
            Value::Array(items) => {
                out.push('[');
                for (index, child) in items.iter().enumerate() {
                    if index > 0 {
                        out.push_str(item);
                    }
                    walk(out, child, item, key, ascii);
                }
                out.push(']');
            }
            Value::Object(map) => {
                out.push('{');
                for (index, (name, child)) in map.iter().enumerate() {
                    if index > 0 {
                        out.push_str(item);
                    }
                    string(out, name, ascii);
                    out.push_str(key);
                    walk(out, child, item, key, ascii);
                }
                out.push('}');
            }
        }
    }
    let mut out = String::new();
    walk(&mut out, value, item, key, ascii);
    out
}

/// Extract the balanced JSON object starting at the first `{` after `marker`.
pub fn json_object_after(text: &str, marker: &str) -> Option<Value> {
    let index = text.find(marker)?;
    let raw = balanced_from(text, index + marker.len(), b'{', b'}')?;
    parse_json(raw)
}

/// Return the balanced `{...}` / `[...]` slice beginning at the first opener at or after `from`.
pub fn balanced_from(text: &str, from: usize, open: u8, close: u8) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = from + bytes.get(from..)?.iter().position(|b| *b == open)?;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (offset, &byte) in bytes[start..].iter().enumerate() {
        if in_str {
            if escape {
                escape = false;
            } else if byte == b'\\' {
                escape = true;
            } else if byte == b'"' {
                in_str = false;
            }
            continue;
        }
        if byte == b'"' {
            in_str = true;
        } else if byte == open {
            depth += 1;
        } else if byte == close {
            depth -= 1;
            if depth == 0 {
                return text.get(start..start + offset + 1);
            }
        }
    }
    None
}

/// Recursively visit every object in a JSON tree (pre-order).
pub fn walk_objects<'a>(value: &'a Value, visit: &mut dyn FnMut(&'a Map<String, Value>) -> bool) -> bool {
    match value {
        Value::Object(map) => {
            if visit(map) {
                return true;
            }
            map.values().any(|child| walk_objects(child, visit))
        }
        Value::Array(items) => items.iter().any(|child| walk_objects(child, visit)),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Strings, HTML and URLs
// ---------------------------------------------------------------------------

pub fn unescape_html(text: &str) -> String {
    html_escape::decode_html_entities(text).into_owned()
}

pub fn https(url: Option<String>) -> Option<String> {
    let url = url.filter(|url| !url.is_empty())?;
    Some(match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url,
    })
}

pub fn https_str(url: &str) -> String {
    https(Some(url.to_string())).unwrap_or_default()
}

/// `urllib.parse.quote(text, safe)`.
pub fn quote(text: &str, safe: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || "_.-~".contains(ch) || (byte.is_ascii() && safe.contains(ch)) {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `urllib.parse.quote_plus(text)`.
pub fn quote_plus(text: &str) -> String {
    quote(text, " ").replace(' ', "+")
}

/// `urllib.parse.unquote(text)`.
pub fn unquote(text: &str) -> String {
    percent_encoding::percent_decode_str(text)
        .decode_utf8_lossy()
        .into_owned()
}

pub fn unquote_plus(text: &str) -> String {
    unquote(&text.replace('+', " "))
}

/// `urlencode(pairs)` using `quote_plus`.
pub fn urlencode<K: AsRef<str>, V: AsRef<str>>(pairs: &[(K, V)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", quote_plus(k.as_ref()), quote_plus(v.as_ref())))
        .collect::<Vec<_>>()
        .join("&")
}

/// `urlencode(pairs, quote_via=quote)`.
pub fn urlencode_quote<K: AsRef<str>, V: AsRef<str>>(pairs: &[(K, V)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", quote(k.as_ref(), ""), quote(v.as_ref(), "")))
        .collect::<Vec<_>>()
        .join("&")
}

/// Minimal `urllib.parse.urlsplit`.
#[derive(Clone, Debug, Default)]
pub struct UrlParts {
    pub scheme: String,
    pub netloc: String,
    pub path: String,
    pub query: String,
    pub fragment: String,
}

impl UrlParts {
    pub fn parse(url: &str) -> UrlParts {
        let mut rest = url.trim_start();
        let mut parts = UrlParts::default();
        if let Some(index) = rest.find(':') {
            let candidate = &rest[..index];
            if !candidate.is_empty()
                && candidate.chars().next().unwrap().is_ascii_alphabetic()
                && candidate.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
            {
                parts.scheme = candidate.to_ascii_lowercase();
                rest = &rest[index + 1..];
            }
        }
        if let Some(after) = rest.strip_prefix("//") {
            let end = after.find(['/', '?', '#']).unwrap_or(after.len());
            parts.netloc = after[..end].to_string();
            rest = &after[end..];
        }
        if let Some(index) = rest.find('#') {
            parts.fragment = rest[index + 1..].to_string();
            rest = &rest[..index];
        }
        if let Some(index) = rest.find('?') {
            parts.query = rest[index + 1..].to_string();
            rest = &rest[..index];
        }
        parts.path = rest.to_string();
        parts
    }

    fn host_port(&self) -> (&str, &str) {
        let netloc = self.netloc.rsplit('@').next().unwrap_or("");
        if let Some(stripped) = netloc.strip_prefix('[') {
            let end = stripped.find(']').unwrap_or(stripped.len());
            let host = &stripped[..end];
            let port = stripped[end..].strip_prefix("]:").unwrap_or("");
            return (host, port);
        }
        match netloc.rfind(':') {
            Some(index) => (&netloc[..index], &netloc[index + 1..]),
            None => (netloc, ""),
        }
    }

    pub fn hostname(&self) -> String {
        self.host_port().0.to_ascii_lowercase()
    }

    /// `Ok(None)` without a port, `Err` when the port is invalid (Python raises).
    pub fn port(&self) -> Result<Option<u16>, ()> {
        let (_, port) = self.host_port();
        if port.is_empty() {
            return Ok(None);
        }
        port.parse::<u16>().map(Some).map_err(|_| ())
    }

    pub fn has_userinfo(&self) -> bool {
        self.netloc.contains('@')
    }

    pub fn qs(&self) -> Query {
        Query::parse(&self.query)
    }
}

/// Parsed query string with Python `parse_qs` semantics (blank values dropped).
#[derive(Clone, Debug, Default)]
pub struct Query(pub Vec<(String, String)>);

impl Query {
    pub fn parse(query: &str) -> Query {
        Query(
            query
                .split('&')
                .filter(|pair| !pair.is_empty())
                .filter_map(|pair| {
                    let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
                    let value = unquote_plus(value);
                    (!value.is_empty()).then(|| (unquote_plus(key), value))
                })
                .collect(),
        )
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    pub fn any(&self, keys: &[&str]) -> Option<String> {
        keys.iter().find_map(|key| self.get(key))
    }

    /// `[(k, qs[k][0]) for k in keys if k in qs]`.
    pub fn keep(&self, keys: &[&str]) -> Vec<(String, String)> {
        keys.iter()
            .filter_map(|key| self.get(key).map(|value| (key.to_string(), value)))
            .collect()
    }
}

pub fn query_of(url: &str) -> Query {
    UrlParts::parse(url).qs()
}

pub fn urljoin(base: &str, reference: &str) -> String {
    match url::Url::parse(base).and_then(|base| base.join(reference)) {
        Ok(joined) => joined.to_string(),
        Err(_) => reference.to_string(),
    }
}

pub struct Html(scraper::Html);

impl Html {
    pub fn parse(html: &str) -> Html {
        Html(scraper::Html::parse_document(html))
    }
    pub fn select(&self, css: &str) -> Vec<scraper::ElementRef<'_>> {
        match scraper::Selector::parse(css) {
            Ok(selector) => self.0.select(&selector).collect(),
            Err(_) => Vec::new(),
        }
    }
    pub fn one(&self, css: &str) -> Option<scraper::ElementRef<'_>> {
        self.select(css).into_iter().next()
    }
    pub fn attr(&self, css: &str, name: &str) -> Option<String> {
        self.select(css)
            .into_iter()
            .find_map(|el| el.value().attr(name).map(str::to_string))
    }
    /// `get_text(strip=True)` of the first match.
    pub fn text(&self, css: &str) -> Option<String> {
        self.one(css).map(|el| element_text(&el)).filter(|t| !t.is_empty())
    }
    /// Raw text of every `<script>` tag.
    pub fn scripts(&self) -> Vec<String> {
        self.select("script")
            .into_iter()
            .map(|el| el.text().collect::<String>())
            .collect()
    }
    pub fn script_by_id(&self, id: &str) -> Option<String> {
        self.select("script")
            .into_iter()
            .find(|el| el.value().attr("id") == Some(id))
            .map(|el| el.text().collect::<String>())
    }
}

/// BeautifulSoup `get_text(strip=True)`.
pub fn element_text(element: &scraper::ElementRef<'_>) -> String {
    element
        .text()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect::<String>()
}

/// Base parser `parse_html_data`: first script whose text matches `pattern`.
pub fn script_json(html: &str, pattern: &regex::Regex) -> Option<String> {
    for script in Html::parse(html).scripts() {
        if let Some(captures) = pattern.captures(&script) {
            let raw = captures.get(1)?.as_str().trim_end_matches(';');
            return Some(raw.replace("undefined", "null"));
        }
    }
    None
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn md5_hex(text: impl AsRef<[u8]>) -> String {
    use md5::Digest;
    hex::encode(md5::Md5::digest(text.as_ref()))
}

pub fn random_string(charset: &str, length: usize) -> String {
    let chars: Vec<char> = charset.chars().collect();
    let mut rng = rand::thread_rng();
    (0..length).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

// ---------------------------------------------------------------------------
// Configuration bundled from upstream
// ---------------------------------------------------------------------------

struct BusinessConfig {
    domains: std::collections::HashMap<String, String>,
    user_agent_pc: Vec<String>,
    user_agent_m: Vec<String>,
}

fn business_config() -> &'static BusinessConfig {
    static CONFIG: OnceLock<BusinessConfig> = OnceLock::new();
    CONFIG.get_or_init(|| {
        let raw: Value = serde_json::from_str(include_str!("assets/business_config.json"))
            .expect("bundled business_config.json");
        let strings = |key: &str| {
            raw.g(key)
                .arr()
                .iter()
                .filter_map(|v| v.s())
                .collect::<Vec<_>>()
        };
        BusinessConfig {
            domains: raw
                .g("DOMAIN_TO_NAME")
                .obj()
                .map(|map| {
                    map.iter()
                        .filter_map(|(k, v)| v.s().map(|v| (k.clone(), v)))
                        .collect()
                })
                .unwrap_or_default(),
            user_agent_pc: strings("USER_AGENT_PC"),
            user_agent_m: strings("USER_AGENT_M"),
        }
    })
}

pub fn domain_platform(domain: &str) -> Option<&'static str> {
    business_config().domains.get(domain).map(String::as_str)
}

pub fn user_agents_pc() -> &'static [String] {
    &business_config().user_agent_pc
}

pub fn user_agents_m() -> &'static [String] {
    &business_config().user_agent_m
}

pub fn ua_pc() -> String {
    user_agents_pc()
        .choose(&mut rand::thread_rng())
        .cloned()
        .unwrap_or_default()
}

pub fn ua_m() -> String {
    user_agents_m()
        .choose(&mut rand::thread_rng())
        .cloned()
        .unwrap_or_default()
}

/// `USER_AGENT_M[index]` with Python negative indexing.
pub fn ua_m_at(index: isize) -> String {
    let list = user_agents_m();
    let len = list.len() as isize;
    let index = if index < 0 { len + index } else { index };
    list.get(index.max(0) as usize).cloned().unwrap_or_default()
}

pub fn ua_pc_at(index: isize) -> String {
    let list = user_agents_pc();
    let len = list.len() as isize;
    let index = if index < 0 { len + index } else { index };
    list.get(index.max(0) as usize).cloned().unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Platform cookies (environment only; desktop users configure `.env`)
// ---------------------------------------------------------------------------

fn cookie_aliases(platform: &str) -> &'static [&'static str] {
    match platform {
        "xhs" | "xiaohongshu" => &["XHS_COOKIE", "XIAOHONGSHU_COOKIE"],
        "pinduoduo" => &["PINDUODUO_COOKIE", "PDD_COOKIE"],
        "douyin" => &["DOUYIN_COOKIE", "DY_COOKIE"],
        "yuanbao" | "wechat_channels" => &["YUANBAO_COOKIE", "WECHAT_CHANNELS_COOKIE"],
        "doubao" => &["DOUBAO_COOKIE"],
        "jimeng" => &["JIMENG_COOKIE"],
        "weibo" => &["WEIBO_COOKIE"],
        "kuaishou" => &["KUAISHOU_COOKIE", "KS_COOKIE"],
        _ => &[],
    }
}

pub fn clean_cookie_quotes(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return value[1..value.len() - 1].trim().to_string();
    }
    value.to_string()
}

pub fn env(key: &str) -> String {
    std::env::var(key).unwrap_or_default().trim().to_string()
}

/// `get_platform_cookie(platform, env_var)`.
pub fn platform_cookie(platform: &str, env_var: Option<&str>) -> String {
    let normalized = platform.to_lowercase().replace('-', "_");
    let primary = env_var
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}_COOKIE", normalized.to_uppercase()));
    std::iter::once(primary.as_str())
        .chain(cookie_aliases(&normalized).iter().copied())
        .map(env)
        .find(|value| !value.is_empty())
        .map(|value| clean_cookie_quotes(&value))
        .unwrap_or_default()
}

/// Parse `a=b; c=d` into ordered pairs.
pub fn cookie_pairs(cookie: &str) -> Vec<(String, String)> {
    cookie
        .split(';')
        .filter_map(|item| {
            let (key, value) = item.split_once('=')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .filter(|(key, _)| !key.is_empty())
        .collect()
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct HttpError(pub String);

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

pub type HttpResult<T> = Result<T, HttpError>;

/// Per-parse budget shared by every session of one parse.
pub struct Ctx {
    pub deadline: Instant,
    pub cancelled: Arc<AtomicBool>,
    cookie_required: AtomicBool,
}

impl Ctx {
    pub fn new(budget: Duration, cancelled: Arc<AtomicBool>) -> Arc<Ctx> {
        Arc::new(Ctx {
            deadline: Instant::now() + budget,
            cancelled,
            cookie_required: AtomicBool::new(false),
        })
    }
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    pub fn check(&self) -> HttpResult<Duration> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(HttpError("解析已取消".into()));
        }
        let remaining = self.remaining();
        if remaining.is_zero() {
            return Err(HttpError("解析超时，请稍后重试".into()));
        }
        Ok(remaining)
    }
    pub fn report_cookie_required(&self) {
        self.cookie_required.store(true, Ordering::Relaxed);
    }
    pub fn cookie_required(&self) -> bool {
        self.cookie_required.load(Ordering::Relaxed)
    }
    pub fn sleep(&self, seconds: f64) {
        let wait = Duration::from_secs_f64(seconds.max(0.0)).min(self.remaining());
        std::thread::sleep(wait);
    }
}

fn login_path(url: &str) -> bool {
    let path = UrlParts::parse(url).path.to_lowercase();
    path.split('/')
        .any(|part| matches!(part, "login" | "signin" | "captcha" | "verify"))
}

pub const DEFAULT_UA: &str = "python-requests/2.33.0";

/// requests.Session equivalent: cookie jar + redirects, bounded by `Ctx`.
pub struct Session {
    ctx: Arc<Ctx>,
    jar: Arc<Jar>,
    follow: Client,
    manual: Client,
}

fn build_client(jar: &Arc<Jar>, ctx: &Arc<Ctx>, follow: bool) -> Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::USER_AGENT, DEFAULT_UA.parse().unwrap());
    headers.insert(reqwest::header::ACCEPT, "*/*".parse().unwrap());
    let ctx = ctx.clone();
    let policy = if follow {
        reqwest::redirect::Policy::custom(move |attempt| {
            if login_path(attempt.url().as_str()) {
                ctx.report_cookie_required();
            }
            if attempt.previous().len() >= 30 {
                attempt.error("too many redirects")
            } else {
                attempt.follow()
            }
        })
    } else {
        reqwest::redirect::Policy::none()
    };
    Client::builder()
        .cookie_provider(jar.clone())
        .default_headers(headers)
        .redirect(policy)
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("http client")
}

impl Session {
    pub fn new(ctx: &Arc<Ctx>) -> Session {
        let jar = Arc::new(Jar::default());
        Session {
            follow: build_client(&jar, ctx, true),
            manual: build_client(&jar, ctx, false),
            jar,
            ctx: ctx.clone(),
        }
    }

    pub fn ctx(&self) -> &Arc<Ctx> {
        &self.ctx
    }

    pub fn get(&self, url: impl Into<String>) -> Req<'_> {
        Req::new(self, reqwest::Method::GET, url.into())
    }

    pub fn post(&self, url: impl Into<String>) -> Req<'_> {
        Req::new(self, reqwest::Method::POST, url.into())
    }

    /// Cookie value visible to `url` (like `session.cookies.get(name)` scoped to a domain).
    pub fn cookie(&self, url: &str, name: &str) -> Option<String> {
        let url = url::Url::parse(url).ok()?;
        let header = self.jar.cookies(&url)?;
        cookie_pairs(header.to_str().ok()?)
            .into_iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }

    pub fn cookie_header(&self, url: &str) -> String {
        url::Url::parse(url)
            .ok()
            .and_then(|url| self.jar.cookies(&url))
            .and_then(|value| value.to_str().ok().map(str::to_string))
            .unwrap_or_default()
    }

}

pub enum Body {
    None,
    Raw(Vec<u8>),
    Form(Vec<(String, String)>),
    Json(Value),
}

pub struct Req<'a> {
    session: &'a Session,
    method: reqwest::Method,
    url: String,
    headers: Vec<(String, String)>,
    query: Vec<(String, String)>,
    body: Body,
    timeout: f64,
    redirects: bool,
}

impl<'a> Req<'a> {
    fn new(session: &'a Session, method: reqwest::Method, url: String) -> Req<'a> {
        Req {
            session,
            method,
            url,
            headers: Vec::new(),
            query: Vec::new(),
            body: Body::None,
            timeout: 10.0,
            redirects: true,
        }
    }
    pub fn header(mut self, key: &str, value: impl AsRef<str>) -> Self {
        self.headers.retain(|(k, _)| !k.eq_ignore_ascii_case(key));
        self.headers.push((key.to_string(), value.as_ref().to_string()));
        self
    }
    pub fn headers(mut self, headers: &Headers) -> Self {
        for (key, value) in &headers.0 {
            self = self.header(key, value);
        }
        self
    }
    pub fn query<K: AsRef<str>, V: AsRef<str>>(mut self, pairs: &[(K, V)]) -> Self {
        self.query.extend(
            pairs
                .iter()
                .map(|(k, v)| (k.as_ref().to_string(), v.as_ref().to_string())),
        );
        self
    }
    pub fn form<K: AsRef<str>, V: AsRef<str>>(mut self, pairs: &[(K, V)]) -> Self {
        self.body = Body::Form(
            pairs
                .iter()
                .map(|(k, v)| (k.as_ref().to_string(), v.as_ref().to_string()))
                .collect(),
        );
        self
    }
    /// `json=` keyword: Python `json.dumps` bytes with JSON content type.
    pub fn json(mut self, value: &Value) -> Self {
        self.body = Body::Json(value.clone());
        self
    }
    /// `data=<str>`.
    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = Body::Raw(body.into());
        self
    }
    pub fn timeout(mut self, seconds: f64) -> Self {
        self.timeout = seconds;
        self
    }
    pub fn no_redirect(mut self) -> Self {
        self.redirects = false;
        self
    }

    pub fn send(self) -> HttpResult<Resp> {
        let ctx = self.session.ctx.clone();
        let remaining = ctx.check()?;
        let client = if self.redirects {
            &self.session.follow
        } else {
            &self.session.manual
        };
        let mut url = self.url.clone();
        if !self.query.is_empty() {
            let encoded = urlencode(&self.query);
            url = if url.contains('?') {
                format!("{url}&{encoded}")
            } else {
                format!("{url}?{encoded}")
            };
        }
        let timeout = Duration::from_secs_f64(self.timeout.max(0.1)).min(remaining);
        let mut builder = client.request(self.method.clone(), &url).timeout(timeout);
        let has = |name: &str| self.headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name));
        match self.body {
            Body::None => {}
            Body::Raw(bytes) => builder = builder.body(bytes),
            Body::Form(pairs) => {
                if !has("content-type") {
                    builder = builder.header("Content-Type", "application/x-www-form-urlencoded");
                }
                builder = builder.body(urlencode(&pairs));
            }
            Body::Json(value) => {
                if !has("content-type") {
                    builder = builder.header("Content-Type", "application/json");
                }
                builder = builder.body(py_json(&value));
            }
        }
        for (key, value) in &self.headers {
            builder = builder.header(key.as_str(), value.as_str());
        }
        let response = builder.send().map_err(|error| {
            if ctx.remaining().is_zero() {
                HttpError("解析超时，请稍后重试".into())
            } else {
                HttpError(format!("request failed: {}", error.without_url()))
            }
        })?;
        ctx.check()?;
        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let headers = response.headers().clone();
        let cookies = headers
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(|value| {
                let first = value.split(';').next()?;
                let (name, value) = first.split_once('=')?;
                Some((name.trim().to_string(), value.trim().to_string()))
            })
            .collect();
        let bytes = response
            .bytes()
            .map_err(|error| HttpError(format!("read failed: {}", error.without_url())))?
            .to_vec();
        let location = headers
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or(&final_url);
        if login_path(location) {
            ctx.report_cookie_required();
        }
        Ok(Resp {
            status,
            url: final_url,
            headers,
            bytes,
            cookies,
        })
    }

    /// `send()` then `raise_for_status()`.
    pub fn ok(self) -> HttpResult<Resp> {
        let response = self.send()?;
        if response.status >= 400 {
            return Err(HttpError(format!("HTTP {}", response.status)));
        }
        Ok(response)
    }

    /// GET text body with `raise_for_status()`; `None` on any failure.
    pub fn text(self) -> Option<String> {
        self.ok().ok().map(|response| response.text())
    }

    /// JSON body with `raise_for_status()`; `None` on any failure.
    pub fn json_value(self) -> Option<Value> {
        self.ok().ok().and_then(|response| response.json())
    }
}

pub struct Resp {
    pub status: u16,
    pub url: String,
    pub headers: reqwest::header::HeaderMap,
    pub bytes: Vec<u8>,
    pub cookies: Vec<(String, String)>,
}

impl Resp {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
    pub fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.bytes).ok()
    }
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }
    pub fn cookie(&self, name: &str) -> Option<String> {
        self.cookies
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }
}

/// Ordered, case-insensitive header list (Python headers dict).
#[derive(Clone, Default, Debug)]
pub struct Headers(pub Vec<(String, String)>);

impl Headers {
    pub fn set(&mut self, key: &str, value: impl Into<String>) -> &mut Self {
        let value = value.into();
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
            slot.1 = value;
        } else {
            self.0.push((key.to_string(), value));
        }
        self
    }
    pub fn with(&self, key: &str, value: impl Into<String>) -> Headers {
        let mut headers = self.clone();
        headers.set(key, value);
        headers
    }
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

macro_rules! headers {
    ($($key:expr => $value:expr),* $(,)?) => {{
        let mut headers = $crate::backend::media_parser::core::Headers::default();
        $( headers.set($key, $value); )*
        headers
    }};
}
pub(crate) use headers;

// ---------------------------------------------------------------------------
// Parser contract
// ---------------------------------------------------------------------------

/// Flags the engine reads after extraction (Python parser attributes).
#[derive(Default)]
pub struct Flags {
    pub terminal_error: Option<Value>,
    pub no_media_in_content: bool,
    pub cookie_required: bool,
}

pub trait Parser {
    fn title(&mut self) -> Option<String>;
    fn description(&mut self) -> Option<String> {
        None
    }
    fn video_url(&mut self) -> Option<String>;
    fn video_list(&mut self) -> Vec<String> {
        Vec::new()
    }
    fn cover_url(&mut self) -> Option<String>;
    fn author(&mut self) -> Option<Value> {
        None
    }
    /// Strings or `{url, live_photo_url}` objects.
    fn image_list(&mut self) -> Vec<Value> {
        Vec::new()
    }
    fn audio_url(&mut self) -> Option<String> {
        None
    }
    fn subtitles(&mut self) -> Option<Value> {
        None
    }
    fn is_preview(&mut self) -> bool {
        false
    }
    fn full_duration(&mut self) -> Option<Value> {
        None
    }
    fn flags(&self) -> Option<&Flags> {
        None
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        None
    }
}

pub fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

pub fn dedupe_values(values: Vec<Value>) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter(|value| value.truthy() && seen.insert(value.to_string()))
        .collect()
}

/// `json.loads(text, strict=False)`: tolerate raw control characters inside strings.
pub fn parse_json_lenient(text: &str) -> Option<Value> {
    if let Some(value) = parse_json(text) {
        return Some(value);
    }
    let mut out = String::with_capacity(text.len());
    let mut in_str = false;
    let mut escape = false;
    for ch in text.chars() {
        if in_str {
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_str = false;
            } else if (ch as u32) < 0x20 {
                out.push_str(&format!("\\u{:04x}", ch as u32));
                continue;
            }
        } else if ch == '"' {
            in_str = true;
        }
        out.push(ch);
    }
    parse_json(&out)
}

/// Balanced `{...}` starting exactly at `start`, honouring both quote styles.
pub fn balanced_object_any_quote(text: &str, start: usize) -> Option<&str> {
    let bytes = text.as_bytes();
    if bytes.get(start) != Some(&b'{') {
        return None;
    }
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut escape = false;
    for (offset, &byte) in bytes[start..].iter().enumerate() {
        if let Some(q) = quote {
            if escape {
                escape = false;
            } else if byte == b'\\' {
                escape = true;
            } else if byte == q {
                quote = None;
            }
            continue;
        }
        match byte {
            b'\'' | b'"' => quote = Some(byte),
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return text.get(start..start + offset + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// Depth-first search with Python list-as-stack order for a dict holding all `keys`.
pub fn find_dict_with<'a>(data: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let mut stack = vec![data];
    while let Some(current) = stack.pop() {
        match current {
            Value::Object(map) => {
                if keys.iter().all(|k| map.contains_key(*k)) {
                    return Some(current);
                }
                stack.extend(map.values().filter(|v| v.is_object() || v.is_array()));
            }
            Value::Array(items) => stack.extend(items.iter().filter(|v| v.is_object() || v.is_array())),
            _ => {}
        }
    }
    None
}

/// Parser whose fields are all computed up front.
#[derive(Default)]
pub struct Fields {
    pub flags: Flags,
    pub title: Option<String>,
    pub desc: Option<String>,
    pub cover: Option<String>,
    pub video: Option<String>,
    pub videos: Vec<String>,
    pub images: Vec<Value>,
    pub author: Option<Value>,
    pub audio: Option<String>,
    pub subtitles: Option<Value>,
    pub preview: bool,
    pub duration: Option<Value>,
}

impl Fields {
    pub fn push_image(&mut self, url: Option<String>) {
        if let Some(url) = url.filter(|u| !u.is_empty()) {
            if !self.images.iter().any(|i| i.as_str() == Some(&url)) {
                self.images.push(Value::String(url));
            }
        }
    }
}

impl Parser for Fields {
    fn title(&mut self) -> Option<String> {
        self.title.clone()
    }
    fn description(&mut self) -> Option<String> {
        self.desc.clone()
    }
    fn video_url(&mut self) -> Option<String> {
        self.video.clone()
    }
    fn video_list(&mut self) -> Vec<String> {
        self.videos.clone()
    }
    fn cover_url(&mut self) -> Option<String> {
        self.cover.clone()
    }
    fn author(&mut self) -> Option<Value> {
        self.author.clone()
    }
    fn image_list(&mut self) -> Vec<Value> {
        self.images.clone()
    }
    fn audio_url(&mut self) -> Option<String> {
        self.audio.clone()
    }
    fn subtitles(&mut self) -> Option<Value> {
        self.subtitles.clone()
    }
    fn is_preview(&mut self) -> bool {
        self.preview
    }
    fn full_duration(&mut self) -> Option<Value> {
        self.duration.clone()
    }
    fn flags(&self) -> Option<&Flags> {
        Some(&self.flags)
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        Some(&mut self.flags)
    }
}

/// `(value or "").strip()` returning `None` when empty.
pub fn trimmed(value: &Value) -> Option<String> {
    value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn name_avatar(name: Option<String>, avatar: Option<String>) -> Option<Value> {
    (name.is_some() || avatar.is_some()).then(|| json!({"name": opt_value(name), "avatar": opt_value(avatar)}))
}

pub fn hmac_sha256(key: &[u8], message: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(key).expect("hmac key");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

pub fn b64(bytes: impl AsRef<[u8]>) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn b64_decode(text: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(text.trim()).ok()
}

/// Upstream `HtmlVideoExtractor.parse_page` result.
#[derive(Default, Clone, Debug)]
pub struct PageMedia {
    pub title: Option<String>,
    pub video_url: Option<String>,
    pub cover_url: Option<String>,
    pub author: Option<String>,
}

pub fn clean_page_url(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    let cleaned = unescape_html(&url.replace("\\u002F", "/").replace("\\/", "/")).trim().to_string();
    Some(if cleaned.starts_with("//") { format!("https:{cleaned}") } else { cleaned })
}

pub fn parse_page_media(html: &str) -> PageMedia {
    let mut result = PageMedia::default();
    if html.is_empty() {
        return result;
    }
    if let Some(data) = router_json(html) {
        let found = search_media_json(&data);
        result.title = found.title;
        result.video_url = found.video_url;
        result.cover_url = found.cover_url;
        result.author = found.author;
    }
    let meta = page_meta(html);
    result.title = result.title.or(meta.title);
    result.video_url = result.video_url.or(meta.video_url);
    result.cover_url = result.cover_url.or(meta.cover_url);
    result.author = result.author.or(meta.author);
    result.video_url = result.video_url.and_then(|u| clean_page_url(&u));
    result.cover_url = result.cover_url.and_then(|u| clean_page_url(&u));
    result
}

fn router_json(html: &str) -> Option<Value> {
    let patterns = [
        re!(r"(?s)window\._ROUTER_DATA\s*=\s*(\{.*?\});\s*</script>"),
        re!(r"(?s)window\._ROUTER_DATA\s*=\s*(\{.*?\});"),
        re!(r"(?s)window\._SSR_DATA\s*=\s*(\{.*?\});\s*</script>"),
        re!(r"(?s)window\._SSR_DATA\s*=\s*(\{.*?\});"),
    ];
    for pattern in patterns {
        if let Some(c) = pattern.captures(html) {
            if let Some(value) = parse_json(&c[1]) {
                return Some(value);
            }
        }
    }
    for c in re!(r"(?s)<script[^>]*>\s*(?:var\s+)?(?:window\.\w+\s*=\s*)?(\{.*?\})\s*;?\s*</script>").captures_iter(html) {
        let raw = &c[1];
        if raw.contains("play_url") || raw.contains("video_url") || raw.contains("series_data") {
            if let Some(value) = parse_json(raw) {
                return Some(value);
            }
        }
    }
    None
}

fn search_media_json(data: &Value) -> PageMedia {
    let mut result = PageMedia::default();
    fn has_scheme(v: &str) -> bool {
        v.contains("http://") || v.contains("https://")
    }
    fn visit(value: &Value, result: &mut PageMedia) {
        match value {
            Value::Object(map) => {
                let get = |k: &str| map.get(k).and_then(Value::as_str);
                if result.title.is_none() {
                    result.title = ["title", "series_title", "video_title", "share_title", "name"]
                        .iter()
                        .find_map(|k| get(k).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string));
                }
                if result.video_url.is_none() {
                    result.video_url = ["play_url", "video_url", "video_play_url", "url", "mp4_url"]
                        .iter()
                        .find_map(|k| get(k).filter(|v| has_scheme(v) || v.contains(".mp4") || v.contains("/tos-cn-")).map(str::to_string));
                }
                if result.cover_url.is_none() {
                    result.cover_url = ["cover_url", "poster_url", "cover", "image_url", "og:image"]
                        .iter()
                        .find_map(|k| get(k).filter(|v| has_scheme(v)).map(str::to_string));
                }
                if result.author.is_none() {
                    result.author = ["author", "author_name", "user_name", "nick_name", "nickname"]
                        .iter()
                        .find_map(|k| get(k).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string));
                }
                for child in map.values() {
                    visit(child, result);
                }
            }
            Value::Array(items) => items.iter().for_each(|child| visit(child, result)),
            _ => {}
        }
    }
    visit(data, &mut result);
    result
}

fn page_meta(html: &str) -> PageMedia {
    let mut result = PageMedia::default();
    let mut pairs: Vec<(String, String)> = re!(r#"(?i)<meta\s+[^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']+)["']"#)
        .captures_iter(html)
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect();
    pairs.extend(
        re!(r#"(?i)<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:name|property)\s*=\s*["']([^"']+)["']"#)
            .captures_iter(html)
            .map(|c| (c[1].to_string(), c[2].to_string())),
    );
    for (name, content) in pairs {
        let name = name.to_lowercase();
        let content = unescape_html(&content);
        if matches!(name.as_str(), "og:url" | "twitter:player" | "video:url")
            && (content.contains("mime_type=video") || content.contains(".mp4") || content.contains("/tos-cn-") || content.contains("play"))
        {
            result.video_url.get_or_insert(content);
        } else if matches!(name.as_str(), "og:image" | "twitter:image") {
            result.cover_url.get_or_insert(content);
        } else if matches!(name.as_str(), "og:description" | "description" | "og:title" | "twitter:title") {
            result.title.get_or_insert(content);
        }
    }
    if result.title.is_none() {
        result.title = re!(r"(?is)<title>(.*?)</title>")
            .captures(html)
            .map(|c| unescape_html(&c[1]).trim().to_string());
    }
    if result.video_url.is_none() {
        result.video_url = re!(r#"(?i)<video[^>]+src=["']([^"']+)["']"#)
            .captures(html)
            .map(|c| unescape_html(&c[1]));
    }
    result
}

/// Python `bytes.decode("unicode_escape")` for ASCII-escaped JSON fragments.
pub fn unicode_unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(c) => out.push(c),
                    None => {
                        out.push_str("\\u");
                        out.push_str(&hex);
                    }
                }
            }
            Some('x') => {
                let hex: String = chars.by_ref().take(2).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(c) => out.push(c),
                    None => out.push_str(&hex),
                }
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// `parse_qs` as ordered `(key, [values])`, optionally keeping blank values.
pub fn parse_qs_multi(query: &str, keep_blank: bool) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let (key, value) = (unquote_plus(key), unquote_plus(value));
        if value.is_empty() && !keep_blank {
            continue;
        }
        match out.iter_mut().find(|(k, _)| *k == key) {
            Some((_, values)) => values.push(value),
            None => out.push((key, vec![value])),
        }
    }
    out
}

/// `urlencode(dict_of_lists, doseq=True)`.
pub fn urlencode_multi(pairs: &[(String, Vec<String>)]) -> String {
    let flat: Vec<(&str, &str)> = pairs
        .iter()
        .flat_map(|(k, values)| values.iter().map(move |v| (k.as_str(), v.as_str())))
        .collect();
    urlencode(&flat)
}

/// Rebuild `url` with a new query (urlunparse).
pub fn with_query(url: &str, query: &str) -> String {
    let parts = UrlParts::parse(url);
    let mut out = format!("{}://{}{}", parts.scheme, parts.netloc, parts.path);
    if !query.is_empty() {
        out.push('?');
        out.push_str(query);
    }
    if !parts.fragment.is_empty() {
        out.push('#');
        out.push_str(&parts.fragment);
    }
    out
}

pub fn sha512(bytes: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    sha2::Sha512::digest(bytes).to_vec()
}

pub fn aes_cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    match key.len() {
        16 => cbc::Decryptor::<aes::Aes128>::new_from_slices(key, iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
        24 => cbc::Decryptor::<aes::Aes192>::new_from_slices(key, iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
        32 => cbc::Decryptor::<aes::Aes256>::new_from_slices(key, iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
        _ => None,
    }
}

pub fn aes_cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
    match key.len() {
        16 => Some(cbc::Encryptor::<aes::Aes128>::new_from_slices(key, iv).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
        32 => Some(cbc::Encryptor::<aes::Aes256>::new_from_slices(key, iv).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
        _ => None,
    }
}

/// Decode standard or URL-safe base64 with optional padding.
pub fn b64_any(text: &str) -> Option<Vec<u8>> {
    let mut s = text.trim().replace('-', "+").replace('_', "/");
    while s.len() % 4 != 0 {
        s.push('=');
    }
    b64_decode(&s)
}

/// Visit every object in pre-order (Python `_walk_dicts`).
pub fn all_objects(value: &Value) -> Vec<&Map<String, Value>> {
    let mut out = Vec::new();
    walk_objects(value, &mut |map| {
        out.push(map);
        false
    });
    out
}

/// BeautifulSoup rich text cleanup: drop `skip` tags, `<br>` to newline,
/// newline after `blocks`, then non-empty whitespace-collapsed lines.
pub fn rich_text_lines(html: &str, blocks: &[&str], skip: &[&str]) -> Vec<String> {
    fn walk(element: scraper::ElementRef<'_>, blocks: &[&str], skip: &[&str], out: &mut String) {
        let name = element.value().name();
        if skip.contains(&name) {
            return;
        }
        if name == "br" {
            out.push('\n');
            return;
        }
        for child in element.children() {
            match child.value() {
                scraper::Node::Text(text) => out.push_str(text),
                scraper::Node::Element(_) => {
                    if let Some(child) = scraper::ElementRef::wrap(child) {
                        walk(child, blocks, skip, out);
                    }
                }
                _ => {}
            }
        }
        if blocks.contains(&name) {
            out.push('\n');
        }
    }
    let fragment = scraper::Html::parse_fragment(html);
    let mut text = String::new();
    walk(fragment.root_element(), blocks, skip, &mut text);
    text.replace('\u{a0}', " ")
        .lines()
        .map(|line| re!(r"[\t\x0c\x0b ]+").replace_all(line, " ").trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}
