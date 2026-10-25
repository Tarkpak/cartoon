//! 酷狗音乐, 网易云音乐.

use super::super::core::*;
use std::sync::Arc;

pub fn valid_url(value: &Value) -> Option<String> {
    value.as_str().filter(|s| s.starts_with("http://") || s.starts_with("https://")).map(str::to_string)
}

fn size(value: &Value) -> Option<String> {
    value.as_str().map(|s| s.replace("{size}", "400"))
}

const KUGOU_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

pub fn kugou(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields {
        title: Some(String::new()),
        author: Some(author("", "", "")),
        ..Fields::default()
    };
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => KUGOU_UA, "Referer" => "https://m.kugou.com/"};
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    let path = parts.path.clone();
    let lower = path.to_lowercase();
    let (kind, id) = if let Some(c) = re!(r"(?i)/mvweb/html/mv_([0-9a-f]{32})\.html").captures(&path) {
        ("mv", Some(c[1].to_string()))
    } else if lower.contains("/mv") {
        ("mv", query.get("hash"))
    } else if let Some(c) = re!(r"/share/([a-zA-Z0-9_-]+)\.html")
        .captures(&path)
        .filter(|c| !matches!(c[1].to_lowercase().as_str(), "song" | "default" | "index"))
    {
        ("song", Some(c[1].to_string()))
    } else if let Some(chain) = query.get("chain") {
        ("song", Some(chain))
    } else if lower.contains("/share/song") || lower.contains("/song") || lower.contains("/share/default") {
        ("song", None)
    } else {
        ("", None)
    };
    match (kind, id) {
        ("mv", Some(hash)) => kugou_mv(&session, &headers, &hash, &mut out),
        ("song", id) => kugou_song(&session, &headers, real_url, id, &mut out),
        _ => {}
    }
    out
}

fn kugou_mv(session: &Session, headers: &Headers, hash: &str, out: &mut Fields) {
    let timestamp = now_millis().to_string();
    let mut params: Vec<(&str, String)> = vec![
        ("cmd", "100".into()),
        ("hash", hash.into()),
        ("ext", "mp4".into()),
        ("ismp3", "1".into()),
        ("ssl", "1".into()),
        ("srcappid", "2919".into()),
        ("clientver", "20000".into()),
        ("clienttime", timestamp.clone()),
        ("mid", timestamp.clone()),
        ("uuid", timestamp),
        ("dfid", "-".into()),
    ];
    let mut sorted = params.clone();
    sorted.sort_by(|a, b| a.0.cmp(b.0));
    let salt = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
    let source: String = sorted.iter().map(|(k, v)| format!("{k}={v}")).collect();
    params.push(("signature", md5_hex(format!("{salt}{source}{salt}"))));
    let Some(payload) = session.get("https://m3ws.kugou.com/api/v1/mv/infov2").query(&params).headers(headers).json_value() else {
        return;
    };
    if !payload.is_object() || !(payload.g("errcode").is_null() || payload.g("errcode").as_i64() == Some(0)) {
        return;
    }
    out.title = Some(payload.g("songname").str_or_empty());
    out.cover = size(payload.g("mvicon"));
    out.author = Some(author(payload.g("singer").str_or_empty(), payload.g("id").str_or_empty(), ""));
    let data = payload.g("mvdata");
    for key in ["sq", "rq", "le", "sd"] {
        let item = data.g(key);
        if !item.is_object() {
            continue;
        }
        let candidates = std::iter::once(item.g("downurl")).chain(item.g("backupdownurl").arr().iter());
        if let Some(url) = candidates.filter_map(valid_url).next() {
            out.videos.push(url);
        }
    }
}

fn kugou_song(session: &Session, headers: &Headers, real_url: &str, id: Option<String>, out: &mut Fields) {
    let target = id
        .map(|chain| format!("https://m.kugou.com/share/song.html?chain={chain}"))
        .unwrap_or_else(|| real_url.to_string());
    let html = match session.get(&target).headers(headers).text() {
        Some(html) => html,
        None if target != real_url => match session.get(real_url).headers(headers).text() {
            Some(html) => html,
            None => return,
        },
        None => return,
    };
    if let Some(payload) = re!(r"(?s)var\s+phpParam\s*=\s*(\{.*?\});").captures(&html).and_then(|c| parse_json(&c[1])) {
        let data = payload.at("song_info.data");
        out.title = Some(first([data.g("songName"), data.g("fileName")]).str_or_empty());
        out.cover = size(data.g("album_img").or(data.g("imgUrl")));
        let first_author = data.g("authors").i(0);
        if first_author.is_object() {
            out.author = Some(author(
                first([first_author.g("author_name"), first_author.g("name")]).str_or_empty(),
                first([first_author.g("author_id"), first_author.g("id")]).str_or_empty(),
                first_author.g("avatar").str_or_empty().replace("{size}", "400"),
            ));
        } else if let Some(singer) = data.g("singerName").s() {
            if let Some(Value::Object(map)) = out.author.as_mut() {
                map.insert("nickname".into(), json!(singer));
            }
        }
        let pay = data.g("pay_type");
        let paid = !(pay.is_null() || pay.as_i64() == Some(0) || pay.as_str() == Some("0"));
        if !(data.g("error").truthy() || paid) {
            out.audio = valid_url(data.g("url"));
        }
        return;
    }
    if let Some(list) = re!(r"(?s)var\s+dataFromSmarty\s*=\s*(\[.*?\]);").captures(&html).and_then(|c| parse_json(&c[1])) {
        let item = list.i(0);
        if item.is_object() {
            out.title = Some(first([item.g("song_name"), item.g("audio_name")]).str_or_empty());
            out.author = Some(author(item.g("author_name").str_or_empty(), item.g("author_id").str_or_empty(), ""));
        }
    }
}

const NETEASE_MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const NETEASE_DESKTOP_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

struct Netease {
    session: Session,
    headers: Headers,
    out: Fields,
}

fn ranked(mut entries: Vec<(f64, String)>) -> Vec<String> {
    entries.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    dedupe(entries.into_iter().map(|(_, url)| url).collect())
}

fn nested_videos(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let is_video = valid_url(child).is_some_and(|u| {
                    let base = u.to_lowercase();
                    let base = base.split('?').next().unwrap_or("");
                    base.ends_with(".mp4") || base.ends_with(".mov") || base.ends_with(".m3u8")
                });
                if key.to_lowercase().contains("url") && is_video {
                    found.push(child.as_str().unwrap().to_string());
                } else {
                    nested_videos(child, found);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|c| nested_videos(c, found)),
        _ => {}
    }
}

impl Netease {
    fn request(&self, url: &str, params: &[(&str, String)]) -> Value {
        self.session
            .get(url)
            .query(params)
            .headers(&self.headers)
            .json_value()
            .filter(Value::is_object)
            .unwrap_or(Value::Null)
    }

    fn nickname(&self) -> String {
        self.out.author.as_ref().map(|a| a.g("nickname").str_or_empty()).unwrap_or_default()
    }

    fn set_author(&mut self, profile: &Value) {
        if profile.is_object() {
            self.out.author = Some(author(
                first([profile.g("nickname"), profile.g("name")]).str_or_empty(),
                first([profile.g("userId"), profile.g("id")]).str_or_empty(),
                first([profile.g("avatarUrl"), profile.g("avatar")]).str_or_empty(),
            ));
        }
    }

    fn mv(&mut self, id: &str) {
        let data = self.request("https://music.163.com/api/mv/detail", &[("id", id.into())]).g("data").clone();
        self.out.title = Some(data.g("name").str_or_empty());
        self.out.cover = data.g("cover").s();
        let artist = data.g("artists").i(0);
        if artist.is_object() {
            self.out.author = Some(author(
                first([artist.g("name"), data.g("artistName")]).str_or_empty(),
                first([artist.g("id"), data.g("artistId")]).str_or_empty(),
                artist.g("img1v1Url").str_or_empty(),
            ));
        } else if let Some(name) = data.g("artistName").s() {
            self.out.author = Some(author(name, data.g("artistId").str_or_empty(), ""));
        }
        let streams = data
            .g("brs")
            .obj()
            .map(|map| {
                map.iter()
                    .filter_map(|(q, url)| valid_url(url).map(|u| (q.parse::<f64>().map(|v| v.trunc()).unwrap_or(0.0), u)))
                    .collect()
            })
            .unwrap_or_default();
        self.out.videos = ranked(streams);
    }

    fn initial_props(&self, url: &str) -> Value {
        let headers = headers! {"User-Agent" => NETEASE_MOBILE_UA, "Referer" => "https://music.163.com/"};
        self.session
            .get(url)
            .headers(&headers)
            .text()
            .and_then(|html| {
                re!(r"(?s)window\.__INITIAL_PROPS__\s*=\s*(\{.*?\})\s*</script>")
                    .captures(&html)
                    .and_then(|c| parse_json(&c[1]))
            })
            .unwrap_or(Value::Null)
    }

    fn mlog(&mut self, real_url: &str) {
        let payload = self.initial_props(real_url);
        let resource = payload.at("mlogInfo.resource");
        let content = resource.g("content");
        let video = content.g("video");
        self.set_author(resource.g("profile"));
        let nickname = self.nickname();
        self.out.title = Some(first_str([content.g("title"), content.g("text")]).unwrap_or_else(|| {
            if nickname.is_empty() { "网易云音乐动态".into() } else { format!("{nickname}的音乐动态") }
        }));
        self.out.cover = first_str([video.g("coverUrl"), video.g("frameUrl"), video.at("frameImage.imageUrl")]);
        self.out.videos = ranked(
            video
                .g("urlInfos")
                .arr()
                .iter()
                .filter_map(|e| {
                    let url = valid_url(e.g("url"))?;
                    let q = e.g("resolution").or(e.g("r"));
                    Some((if q.is_number() { q.num() } else { 0.0 }, url))
                })
                .collect(),
        );
        if self.out.videos.is_empty() {
            self.out.videos = valid_url(video.at("urlInfo.url")).into_iter().collect();
        }
        let images: Vec<String> = content
            .g("image")
            .arr()
            .iter()
            .filter_map(|e| match e {
                Value::String(_) => valid_url(e),
                Value::Object(_) => valid_url(first([e.g("originUrl"), e.g("url"), e.g("imageUrl"), e.g("picUrl")])),
                _ => None,
            })
            .collect();
        self.out.images = dedupe(images).into_iter().map(Value::String).collect();
        let song = content.g("song").or(resource.g("song")).clone();
        if song.g("id").truthy() && self.out.videos.is_empty() {
            self.song(song.g("id"), &song, false);
        }
    }

    fn event(&mut self, real_url: &str, id: &str) {
        let query = query_of(real_url);
        let mut params = vec![("id".to_string(), id.to_string())];
        if let Some(uid) = query.any(&["uid", "userid"]) {
            params.push(("uid".into(), uid));
        }
        let url = format!("https://music.163.com/event?{}", urlencode(&params));
        let headers = headers! {"User-Agent" => NETEASE_DESKTOP_UA, "Referer" => "https://music.163.com/"};
        let Some(payload) = self.session.get(&url).headers(&headers).text().and_then(|html| {
            re!(r#"(?s)<textarea[^>]+id="event-data"[^>]*>\s*(.*?)\s*</textarea>"#)
                .captures(&html)
                .and_then(|c| parse_json(&unescape_html(&c[1])))
        }) else {
            return;
        };
        if !payload.truthy() {
            return;
        }
        self.set_author(payload.g("user"));
        let content = payload.g("json").s().and_then(|raw| parse_json(&raw)).unwrap_or(Value::Null);
        let song = content.g("song").clone();
        self.out.title = Some(first([content.g("title"), content.g("msg"), song.g("name")]).str_or_empty());
        self.out.images = payload
            .g("pics")
            .arr()
            .iter()
            .filter_map(|e| {
                let url = valid_url(first([e.g("originUrl"), e.g("pcRectangleUrl"), e.g("rectangleUrl")]))?;
                let live = valid_url(e.g("videoOriginalUrl").or(e.g("videoUrl")));
                Some(json!({"url": url, "live_photo_url": opt_value(live)}))
            })
            .collect();
        let mut found = Vec::new();
        nested_videos(content.g("videoData"), &mut found);
        self.out.videos = dedupe(found);
        if song.g("id").truthy() {
            self.song(song.g("id"), &song, true);
        }
    }

    fn song(&mut self, id: &Value, fallback: &Value, preserve_title: bool) {
        let Some(numeric) = id.text().and_then(|t| t.trim().parse::<i64>().ok()) else { return };
        let ids = format!("[{numeric}]");
        let detail = self.request("https://music.163.com/api/song/detail/", &[("id", numeric.to_string()), ("ids", ids.clone())]);
        let first_song = detail.g("songs").i(0);
        let song = if first_song.is_object() { first_song.clone() } else { fallback.clone() };
        let current = self.out.title.clone().unwrap_or_default();
        if !preserve_title || current.is_empty() {
            self.out.title = Some(song.g("name").s().unwrap_or(current));
        }
        let album = song.g("album");
        if self.out.cover.is_none() {
            self.out.cover = first_str([album.g("picUrl"), album.g("blurPicUrl")]);
        }
        let artist = song.g("artists").i(0);
        if artist.is_object() && self.nickname().is_empty() {
            self.out.author = Some(author(
                artist.g("name").str_or_empty(),
                artist.g("id").str_or_empty(),
                first([artist.g("img1v1Url"), artist.g("picUrl")]).str_or_empty(),
            ));
        }
        let player = self.request(
            "https://music.163.com/api/song/enhance/player/url",
            &[("id", numeric.to_string()), ("ids", ids), ("br", "320000".into())],
        );
        if let Some(url) = valid_url(player.g("data").i(0).g("url")) {
            self.out.audio = Some(url);
        }
        let lyric = self.request(
            "https://music.163.com/api/song/lyric",
            &[("id", numeric.to_string()), ("lv", "1".into()), ("kv", "1".into()), ("tv", "-1".into())],
        );
        if let Some(text) = lyric.at("lrc.lyric").as_str() {
            self.out.subtitles = parse_lrc(text);
        }
    }
}

/// `[mm:ss.xx]text` lines into `[{start, text}]`.
pub fn parse_lrc(text: &str) -> Option<Value> {
    let mut lines = Vec::new();
    for line in text.lines() {
        if let Some(c) = re!(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)").captures(line.trim()) {
            let words = c[3].trim();
            if words.is_empty() {
                continue;
            }
            let start = c[1].parse::<f64>().unwrap_or(0.0) * 60.0 + c[2].parse::<f64>().unwrap_or(0.0);
            lines.push(json!({"start": (start * 1000.0).round() / 1000.0, "text": words}));
        }
    }
    (!lines.is_empty()).then(|| Value::Array(lines))
}

pub fn netease(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut parser = Netease {
        session: Session::new(ctx),
        headers: headers! {"User-Agent" => NETEASE_MOBILE_UA, "Referer" => "https://music.163.com/"},
        out: Fields { title: Some(String::new()), author: Some(author("", "", "")), ..Fields::default() },
    };
    let parts = UrlParts::parse(real_url);
    let path = parts.path.to_lowercase();
    let id = parts.qs().get("id");
    if path.contains("/landing/mlog") {
        parser.mlog(real_url);
    } else if path.contains("/landing/mv") || re!(r"/(?:mv|mvdetail)(?:/|$)").is_match(&path) {
        let id = id.or_else(|| parts.path.trim_end_matches('/').rsplit('/').next().map(str::to_string));
        if let Some(id) = id.filter(|i| !i.is_empty()) {
            parser.mv(&id);
        }
    } else if path.contains("/event") {
        if let Some(id) = id {
            parser.event(real_url, &id);
        }
    } else if path.contains("/song") {
        if let Some(id) = id {
            parser.song(&json!(id), &Value::Null, false);
        }
    }
    parser.out
}

const QQ_API: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const QQ_MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const QQ_DESKTOP_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Default)]
struct QqMedia {
    kind: Option<&'static str>,
    vid: Option<String>,
    songmid: Option<String>,
    songid: Option<String>,
}

fn qq_detect(url: &str) -> QqMedia {
    let parts = UrlParts::parse(url);
    let query = parts.qs();
    if let Some(vid) = query.get("vid") {
        return QqMedia { kind: Some("mv"), vid: Some(vid), ..QqMedia::default() };
    }
    if let Some(c) = re!(r"/(?:mv|mvDetail)/([A-Za-z0-9]+)(?:/|$)").captures(&parts.path) {
        return QqMedia { kind: Some("mv"), vid: Some(c[1].to_string()), ..QqMedia::default() };
    }
    let songmid = query.any(&["songmid", "songMid"]);
    let songid = query.any(&["songid", "songId", "id"]);
    if songmid.is_some() || songid.is_some() {
        return QqMedia { kind: Some("song"), songmid, songid, ..QqMedia::default() };
    }
    if let Some(c) = re!(r"/(?:songDetail|song)/([A-Za-z0-9]+)(?:/|$)").captures(&parts.path) {
        return QqMedia { kind: Some("song"), songmid: Some(c[1].to_string()), ..QqMedia::default() };
    }
    if parts.path.contains("playsong") {
        return QqMedia { kind: Some("song"), ..QqMedia::default() };
    }
    QqMedia::default()
}

fn pmid(value: &Value) -> Option<String> {
    value.as_str().map(|s| s.trim_end_matches(['_', '1']).to_string())
}

struct QqMusic {
    out: Fields,
    media: QqMedia,
}

impl QqMusic {
    fn nickname_empty(&self) -> bool {
        self.out.author.as_ref().map_or(true, |a| a.g("nickname").str_or_empty().is_empty())
    }

    fn title_empty(&self) -> bool {
        self.out.title.as_deref().map_or(true, str::is_empty)
    }

    fn apply_song(&mut self, track: &Value) {
        if !track.is_object() {
            return;
        }
        if self.title_empty() {
            self.out.title = Some(first([track.g("name"), track.g("title")]).str_or_empty());
        }
        let album = track.g("album");
        let album_mid = album.g("mid").s().or_else(|| pmid(album.g("pmid"))).filter(|m| !m.is_empty());
        if let (Some(mid), None) = (album_mid, &self.out.cover) {
            self.out.cover = Some(format!("https://y.qq.com/music/photo_new/T002R800x800M000{mid}.jpg"));
        }
        let singer = track.g("singer").or(track.g("singers")).i(0);
        if singer.is_object() && self.nickname_empty() {
            let mid = singer.g("mid").s().or_else(|| pmid(singer.g("pmid"))).unwrap_or_default();
            let avatar = if mid.is_empty() { String::new() } else { format!("https://y.qq.com/music/photo_new/T001R300x300M000{mid}.jpg") };
            self.out.author = Some(author(
                first([singer.g("name"), singer.g("title")]).str_or_empty(),
                first([singer.g("mid"), singer.g("id")]).str_or_empty(),
                avatar,
            ));
        }
    }

    fn apply_mv(&mut self, video: &Value) {
        if !video.is_object() {
            return;
        }
        if self.title_empty() {
            self.out.title = Some(first([video.g("name"), video.g("raw_name")]).str_or_empty());
        }
        if self.out.cover.is_none() {
            self.out.cover = first_str([video.g("cover_pic"), video.g("first_frame_pic")]);
        }
        let singer = video.g("singers").or(video.g("related_singers")).i(0);
        if singer.is_object() && self.nickname_empty() {
            self.out.author = Some(author(
                first([singer.g("name"), singer.g("title")]).str_or_empty(),
                first([singer.g("mid"), singer.g("id")]).str_or_empty(),
                first([singer.g("picurl"), singer.g("avatar")]).str_or_empty(),
            ));
        }
        if self.nickname_empty() && video.g("uploader_nick").truthy() {
            self.out.author = Some(author(
                video.g("uploader_nick").str_or_empty(),
                first([video.g("uploader_encuin"), video.g("uploader_uin")]).str_or_empty(),
                video.g("uploader_headurl").str_or_empty(),
            ));
        }
    }

    fn page(&mut self, session: &Session, real_url: &str) {
        let headers = headers! {"User-Agent" => QQ_MOBILE_UA, "Referer" => "https://y.qq.com/"};
        let Ok(response) = session.get(real_url).headers(&headers).ok() else { return };
        let m = &self.media;
        if m.kind.is_none() && m.vid.is_none() && m.songmid.is_none() && m.songid.is_none() {
            self.media = qq_detect(&response.url);
        }
        let html = response.text();
        let Some(payload) = re!(r#"(?s)window\.__ssrFirstPageData__\s*=\s*("(?:\\.|[^"\\])*")"#)
            .captures(&html)
            .and_then(|c| serde_json::from_str::<String>(&c[1]).ok())
            .and_then(|s| parse_json(&s))
        else {
            return;
        };
        let data = if payload.g("data").truthy() { payload.g("data").clone() } else { payload.clone() };
        let video = data.g("video");
        if video.is_object() && video.truthy() {
            self.media.kind = self.media.kind.or(Some("mv"));
            self.apply_mv(video);
            let creator = data.g("creator").i(0);
            if creator.is_object() {
                self.out.author = Some(author(
                    first([creator.g("nick"), creator.g("name")]).str_or_empty(),
                    first([creator.g("mid"), creator.g("uin")]).str_or_empty(),
                    first([creator.g("avatar"), creator.g("headurl")]).str_or_empty(),
                ));
            }
        }
        let song = data.g("song");
        if song.is_object() && song.truthy() {
            self.media.kind = self.media.kind.or(Some("song"));
            if self.media.songmid.is_none() {
                self.media.songmid = song.g("mid").s();
            }
            if self.media.songid.is_none() && song.g("id").truthy() {
                self.media.songid = song.g("id").text();
            }
            self.apply_song(song);
        }
    }

    fn song(&mut self, session: &Session) {
        let numeric = self.media.songid.as_deref().and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0);
        let mid = self.media.songmid.clone().unwrap_or_default();
        let payload = json!({
            "comm": {"cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
                     "notice": 0, "platform": "yqq.json", "needNewCode": 1, "uin": 0},
            "songinfo": {"module": "music.pf_song_detail_svr", "method": "get_song_detail_yqq",
                         "param": {"song_mid": mid, "song_id": numeric}},
            "playUrl": {"module": "vkey.GetVkeyServer", "method": "CgiGetVkey",
                        "param": {"guid": "2333333333", "songmid": if mid.is_empty() { json!([]) } else { json!([mid]) },
                                  "songtype": [0], "uin": "0", "loginflag": 1, "platform": "20"}},
            "lyric": {"module": "music.musichallSong.PlayLyricInfo", "method": "GetPlayLyricInfo",
                      "param": {"songMID": mid, "songID": numeric}},
        });
        let headers = headers! {"User-Agent" => QQ_DESKTOP_UA, "Referer" => "https://y.qq.com/", "Content-Type" => "application/json"};
        let Some(result) = session.post(QQ_API).json(&payload).headers(&headers).json_value() else { return };
        let track = result.at("songinfo.data.track_info").clone();
        if track.truthy() {
            self.apply_song(&track);
        }
        let play = result.at("playUrl.data");
        let sips = play.g("sip").arr();
        if let Some(purl) = play.g("midurlinfo").i(0).g("purl").s() {
            if !sips.is_empty() {
                let sip = sips.iter().find_map(|s| s.as_str().filter(|s| s.starts_with("http"))).map(str::to_string).unwrap_or_else(|| sips[0].str_or_empty());
                self.out.audio = Some(format!("{sip}{purl}"));
            }
        }
        if let Some(lyric) = result.at("lyric.data.lyric").s() {
            if let Some(bytes) = b64_decode(&lyric) {
                self.out.subtitles = parse_lrc(&String::from_utf8_lossy(&bytes));
            }
        }
    }

    fn mv(&mut self, session: &Session) {
        let Some(vid) = self.media.vid.clone() else { return };
        let payload = json!({
            "comm": {"ct": 24, "cv": 0},
            "mvInfo": {"module": "video.VideoDataServer", "method": "get_video_info_batch", "param": {
                "vidlist": [vid],
                "required": ["vid", "type", "sid", "cover_pic", "duration", "singers", "video_pay", "hint", "code",
                             "msg", "name", "desc", "playcnt", "pubdate", "isfav", "gmid"]}},
            "mvUrl": {"module": "gosrf.Stream.MvUrlProxy", "method": "GetMvUrls", "param": {"vids": [vid], "request_typet": 10001}},
        });
        let headers = headers! {"User-Agent" => QQ_MOBILE_UA, "Referer" => "https://y.qq.com/", "Content-Type" => "application/json"};
        let Some(result) = session.post(QQ_API).json(&payload).headers(&headers).json_value() else { return };
        let meta = result.at("mvInfo.data").g(&vid).clone();
        self.apply_mv(&meta);
        let data = result.at("mvUrl.data").g(&vid);
        let mut streams: Vec<(f64, String)> = Vec::new();
        for kind in ["mp4", "hls"] {
            for item in data.g(kind).arr() {
                if !item.is_object() || !(item.g("code").is_null() || item.g("code").as_i64() == Some(0)) {
                    continue;
                }
                let candidates = first([item.g("url"), item.g("freeflow_url"), item.g("comm_url")]);
                let list: Vec<Value> = match candidates {
                    Value::String(_) => vec![candidates.clone()],
                    other => other.arr().to_vec(),
                };
                let url = list.iter().find_map(valid_url).or_else(|| valid_url(item.g("m3u8")));
                if let Some(url) = url {
                    streams.push((first([item.g("filetype"), item.g("newFileType"), item.g("fileSize")]).num(), url));
                }
            }
        }
        self.out.videos = ranked(streams);
    }
}

pub fn qqmusic(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let mut parser = QqMusic {
        out: Fields { title: Some(String::new()), author: Some(author("", "", "")), ..Fields::default() },
        media: qq_detect(real_url),
    };
    parser.page(&session, real_url);
    let m = &parser.media;
    if m.kind == Some("song") || m.songmid.is_some() || m.songid.is_some() {
        parser.song(&session);
    } else if m.kind == Some("mv") || m.vid.is_some() {
        parser.mv(&session);
    }
    parser.out
}


const QS_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

fn qs_track_id(url: &str) -> Option<String> {
    let decoded = unquote(url);
    let parts = UrlParts::parse(&decoded);
    if let Some(value) = parts.qs().any(&["track_id", "ugc_video_id"]) {
        return Some(value);
    }
    for prefix in ["/track/", "/video/"] {
        if let Some((_, rest)) = parts.path.split_once(prefix) {
            let digits: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                return Some(digits);
            }
        }
    }
    None
}

fn qs_first_url(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Array(items) => items.iter().find_map(|i| i.s()),
        Value::Object(_) => first_str([value.g("url"), value.g("origin_url"), value.g("large_url")]),
        _ => None,
    }
}

fn qs_image(value: &Value) -> Option<String> {
    if value.is_object() && value.g("urls").truthy() {
        let base = qs_first_url(value.g("urls"));
        if let (Some(base), Some(uri)) = (&base, value.g("uri").text().filter(|_| value.g("uri").truthy())) {
            return Some(format!("{}/{}", base.trim_end_matches('/'), uri.trim_start_matches('/')));
        }
        return base;
    }
    qs_first_url(value)
}

fn qs_lrc(text: &str) -> Option<Value> {
    let mut items = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(c) = re!(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)").captures(line) {
            let words = c[3].trim();
            if !words.is_empty() {
                let start = c[1].parse::<f64>().unwrap_or(0.0) * 60.0 + c[2].parse::<f64>().unwrap_or(0.0);
                items.push(json!({"start": (start * 1000.0).round() / 1000.0, "text": words}));
            }
        } else if !line.starts_with('[') {
            items.push(json!({"text": line}));
        }
    }
    (!items.is_empty()).then(|| Value::Array(items))
}

fn qs_subtitles(data: &Value) -> Option<Value> {
    if !data.is_object() {
        return None;
    }
    let sentences = first([data.g("songMakerTeamSentences"), data.g("sentences"), data.g("lyrics"), data.g("subtitles")]);
    let mut items = Vec::new();
    for line in sentences.arr() {
        match line {
            Value::String(s) if !s.trim().is_empty() => items.push(json!({"text": s.trim()})),
            Value::Object(_) => {
                let text = first([line.g("text"), line.g("content"), line.g("sentence"), line.g("lyric")]);
                if text.truthy() {
                    let mut item = json!({"text": text.str_or_empty().trim()});
                    if line.has("start_time") || line.has("startTime") {
                        item["start"] = line.g("start_time").or(line.g("startTime")).clone();
                    }
                    if line.has("end_time") || line.has("endTime") {
                        item["end"] = line.g("end_time").or(line.g("endTime")).clone();
                    }
                    items.push(item);
                }
            }
            _ => {}
        }
    }
    if !items.is_empty() {
        return Some(Value::Array(items));
    }
    first([data.g("lrc"), data.g("lyric"), data.g("lyrics_text"), data.g("lyric_string")])
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .and_then(qs_lrc)
}

struct QsMusic {
    out: Fields,
    nickname: String,
    author_id: String,
    avatar: String,
}

impl QsMusic {
    fn set_title(&mut self, candidates: &[&Value]) {
        if self.out.title.as_deref().map_or(true, str::is_empty) {
            self.out.title = Some(first(candidates.iter().copied()).str_or_empty());
        }
    }

    fn duration(&mut self, full: &Value, clip: &Value) {
        if !full.is_number() || full.num() <= 0.0 {
            return;
        }
        let full = full.num();
        self.out.duration = Some(json!((full * 1000.0).round() / 1000.0));
        if clip.is_number() && clip.num() > 0.0 {
            self.out.preview = clip.num() < full - 1.0;
        }
    }

    fn artist(&mut self, artist: &Value, avatar_keys: [&str; 2]) {
        if !artist.is_object() {
            return;
        }
        if self.nickname.is_empty() {
            self.nickname = first([artist.g("nickname"), artist.g("name")]).str_or_empty();
        }
        if self.author_id.is_empty() {
            self.author_id = first([artist.g("id"), artist.g("user_id")]).str_or_empty();
        }
        if self.avatar.is_empty() {
            self.avatar = qs_image(first([artist.g(avatar_keys[0]), artist.g(avatar_keys[1])])).unwrap_or_default();
        }
    }

    fn router(&mut self, html: &str) {
        let Some(data) = re!(r"(?s)_ROUTER_DATA\s*=\s*(\{.*?\});").captures(html).and_then(|c| parse_json(&c[1])) else { return };
        let Some(loader) = data.g("loaderData").obj() else { return };
        for page in loader.values() {
            if !page.is_object() {
                continue;
            }
            let options = page.g("videoOptions");
            if options.truthy() {
                self.set_title(&[options.g("videoName"), options.g("title")]);
                if self.nickname.is_empty() {
                    self.nickname = options.g("artistName").str_or_empty();
                }
                if options.g("artistThumbAvatarArr").truthy() && self.avatar.is_empty() {
                    self.avatar = qs_first_url(options.g("artistThumbAvatarArr")).unwrap_or_default();
                }
                if self.out.cover.is_none() {
                    self.out.cover = first_str([options.g("coverURL"), options.g("firstFrameURL")]);
                }
                if let Some(url) = options.g("url").s() {
                    if url.contains("video_mp4") || url.contains("douyinvod.com") {
                        self.out.video.get_or_insert(url);
                    } else {
                        self.out.audio.get_or_insert(url);
                    }
                }
                if self.out.subtitles.is_none() {
                    self.out.subtitles = qs_subtitles(options);
                }
            }
            let lyrics = page.g("audioWithLyricsOption");
            if lyrics.is_object() && lyrics.g("url").truthy() {
                if self.out.audio.is_none() {
                    self.out.audio = lyrics.g("url").s();
                }
                self.set_title(&[lyrics.g("trackName")]);
                if self.nickname.is_empty() {
                    self.nickname = lyrics.g("artistName").str_or_empty();
                }
                if self.author_id.is_empty() {
                    self.author_id = lyrics.g("artistIdStr").str_or_empty();
                }
                if self.out.cover.is_none() {
                    self.out.cover = lyrics.g("coverURL").s();
                }
                self.duration(lyrics.g("duration"), lyrics.g("offsetDuration").or(lyrics.g("duration")));
            }
            let mut track = first([page.g("trackOptions"), page.g("track"), page.g("seo_track")]);
            if track.g("track").is_object() {
                track = track.g("track");
            }
            if !track.is_object() || !track.truthy() {
                continue;
            }
            self.set_title(&[track.g("name"), track.g("title")]);
            let first_artist = track.g("artists").i(0);
            let artist = first([track.g("artist"), first_artist.g("user_info"), first_artist]).clone();
            self.artist(&artist, ["avatar_url", "url_avatar"]);
            let album = track.g("album");
            if self.out.cover.is_none() {
                self.out.cover = qs_image(album.g("cover_url").or(album.g("url_cover"))).or_else(|| qs_image(track.g("cover_url")));
            }
            if self.out.audio.is_none() {
                self.out.audio = first_str([track.g("audio_url"), track.g("play_url"), track.g("main_url")]);
            }
            if self.out.subtitles.is_none() {
                self.out.subtitles = qs_subtitles(if lyrics.truthy() { lyrics } else { track });
            }
        }
    }

    fn track_payload(&mut self, session: &Session, track_id: &str) {
        let headers = headers! {
            "User-Agent" => QS_UA,
            "X-Requested-With" => "XMLHttpRequest",
            "Referer" => format!("https://music.douyin.com/qishui/share/track?track_id={track_id}"),
        };
        let payload = ["/luna/h5/track_v2", "/luna/h5/seo_track"].iter().find_map(|path| {
            session
                .get(format!("https://beta-luna.douyin.com{path}"))
                .query(&[("track_id", track_id), ("device_platform", "web")])
                .headers(&headers)
                .timeout(15.0)
                .json_value()
                .filter(Value::is_object)
        });
        let Some(payload) = payload.filter(Value::truthy) else { return };
        let mut track = payload.g("track").or(payload.at("seo_track.track")).clone();
        if !track.is_object() {
            track = Value::Null;
        }
        self.set_title(&[track.g("name")]);
        let first_artist = track.g("artists").i(0);
        let artist = first_artist.g("user_info").or(first_artist).clone();
        self.artist(&artist, ["medium_avatar_url", "url_avatar"]);
        let album = track.g("album");
        if self.out.cover.is_none() {
            self.out.cover = qs_image(album.g("cover_url").or(album.g("url_cover")));
        }
        let model = match payload.at("track_player.video_model") {
            Value::String(raw) => parse_json(raw).unwrap_or(Value::Null),
            other => other.clone(),
        };
        if model.is_object() && model.truthy() {
            let video = model.g("video_list").i(0);
            if self.out.audio.is_none() {
                self.out.audio = first_str([video.g("main_url"), video.g("backup_url")]);
            }
            self.duration(&json!(track.g("duration").num() / 1000.0), model.g("video_duration"));
        }
    }
}

pub fn qsmusic(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let mut parser = QsMusic {
        out: Fields { title: Some(String::new()), ..Fields::default() },
        nickname: String::new(),
        author_id: String::new(),
        avatar: String::new(),
    };
    let mut track_id = qs_track_id(real_url);
    if let Ok(response) = session.get(real_url).header("User-Agent", QS_UA).timeout(15.0).send() {
        track_id = track_id.or_else(|| qs_track_id(&response.url));
        parser.router(&response.text());
    }
    let missing_title = parser.out.title.as_deref().map_or(true, str::is_empty);
    if missing_title || (parser.out.video.is_none() && parser.out.audio.is_none()) {
        if let Some(id) = &track_id {
            parser.track_payload(&session, id);
        }
    }
    parser.out.videos = parser.out.video.clone().into_iter().collect();
    parser.out.author = Some(author(parser.nickname, parser.author_id, parser.avatar));
    parser.out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lyrics() {
        let lyric = parse_lrc("[00:01.50]第一句\n[01:02.123]第二句\n[00:03.00]\n").unwrap();
        assert_eq!(lyric, json!([{"start": 1.5, "text": "第一句"}, {"start": 62.123, "text": "第二句"}]));
        assert_eq!(pmid(&json!("abc_1_1")).as_deref(), Some("abc"));
    }
}
