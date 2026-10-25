//! 拼多多, 松果时刻, 皮皮搞笑, 皮皮虾.

use super::super::core::*;
use super::super::signer;
use super::super::urls;
use super::music::valid_url;
use std::sync::Arc;

pub fn pinduoduo(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let mut headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Referer" => "https://mobile.yangkeduo.com/",
        "Accept" => "application/json, text/plain, */*",
    };
    let cookie = platform_cookie("pinduoduo", None);
    if !cookie.is_empty() {
        headers.set("Cookie", cookie);
    }
    let mut out = Fields::default();
    let query = query_of(real_url);
    let feed_id = query.get("feed_id");
    let goods_id = query.get("goods_id");
    let review_id = query.get("review_id");
    let ps = query.get("ps");
    let goods_title = || {
        goods_id.as_ref().map(|goods| match &review_id {
            Some(review) => format!("拼多多评价分享 (商品ID: {goods}, 评价ID: {review})"),
            None => format!("拼多多商品 (商品ID: {goods})"),
        })
    };
    if let Some(oak) = query.get("_oak_share_url").map(|raw| unquote(&raw)) {
        out.images.push(json!(oak));
        out.cover = Some(oak);
        out.title = goods_title();
    }
    if let Some(feed) = &feed_id {
        pdd_video(&session, &headers, real_url, feed, &mut out);
    }
    if out.video.is_none() && out.images.is_empty() {
        pdd_goods(&session, &headers, real_url, &mut out);
    }
    if out.title.is_none() {
        out.title = goods_title()
            .or_else(|| feed_id.as_ref().map(|f| format!("多多视频 (FeedID: {f})")))
            .or_else(|| ps.as_ref().map(|p| format!("拼多多分享 (短链: {p})")));
    }
    out.title = Some(out.title.unwrap_or_default());
    out.videos = out.video.clone().into_iter().collect();
    out
}

fn pdd_video(session: &Session, headers: &Headers, real_url: &str, feed_id: &str, out: &mut Fields) {
    let anti = signer::pinduoduo_anti_content();
    let ext = json!({"feed_id_list": [feed_id], "page_from": "602100", "load_author": true, "load_data": true, "url": real_url});
    let payload = json!({
        "base": {
            "scene_id": "55", "mode": 0, "direction": 0,
            "list_id": random_string("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 10),
            "ext": py_json(&ext),
        },
        "anti_content": anti,
    });
    let mut api_headers = headers! {
        "Content-Type" => "application/json;charset=UTF-8",
        "User-Agent" => headers.get("User-Agent").unwrap_or_default(),
        "Referer" => real_url,
        "Origin" => "https://mobile.yangkeduo.com",
        "anti-content" => anti.as_str(),
    };
    let cookie = env("PINDUODUO_COOKIE");
    if !cookie.is_empty() {
        api_headers.set("Cookie", cookie);
    }
    for endpoint in [
        "https://mobile.yangkeduo.com/proxy/api/api/hub/dsp_detail/weak/list/get",
        "https://api.pinduoduo.com/api/hub/dsp_detail/weak/list/get",
    ] {
        let Ok(response) = session.post(endpoint).json(&payload).headers(&api_headers).send() else { continue };
        if response.status != 200 || response.bytes.is_empty() {
            continue;
        }
        let Some(data) = response.json() else { continue };
        let feeds = data.at("result.feeds");
        if feeds.arr().is_empty() {
            continue;
        }
        let feed = feeds.i(0).g("data");
        let title = first([feed.g("feedTitle"), feed.g("title"), feed.g("feedDesc"), feed.g("desc"), feed.at("goods_v2.goods_info.goods_name")]);
        if title.truthy() {
            out.title = Some(title.str_or_empty().trim().to_string());
        }
        for media in feed.g("feedMedia").arr() {
            let url = first_str([media.g("url"), media.g("playUrl")]);
            match (media.g("mediaType").as_i64(), url) {
                (Some(1), Some(url)) if out.video.is_none() => out.video = Some(url),
                (Some(2), Some(url)) if out.cover.is_none() => out.cover = Some(url),
                _ => {}
            }
        }
        if out.video.is_none() {
            out.video = first_str([feed.g("h5_auto_play_url"), feed.g("native_auto_play_url"), feed.g("playUrl"), feed.g("linkUrl")]);
        }
        if out.cover.is_none() {
            out.cover = first_str([feed.g("cover"), feed.g("blur_cover"), feed.g("thumbUrl")]);
        }
        let info = feed.g("author_info").or(feed.g("authorInfo"));
        if info.truthy() {
            out.author = Some(json!({
                "nickname": first([info.g("authorName"), info.g("nickname")]).str_or_empty(),
                "avatar": info.g("avatar").str_or_empty(),
                "author_id": first([info.g("authorId"), info.g("mallId"), info.g("room_id")]).str_or_empty(),
            }));
        }
        return;
    }
}

fn pdd_goods(session: &Session, headers: &Headers, real_url: &str, out: &mut Fields) {
    let Some(html) = session.get(real_url).headers(headers).timeout(5.0).text() else { return };
    let Some(raw) = re!(r"(?s)window\.rawData\s*=\s*(\{.*?\});\s*</script>").captures(&html).and_then(|c| parse_json(&c[1])) else { return };
    let goods = raw.at("store.initDataObj.goods");
    if !goods.truthy() {
        return;
    }
    if out.title.is_none() {
        out.title = goods.g("goods_name").s();
    }
    for item in first([goods.g("banner"), goods.g("gallery"), goods.g("top_gallery")]).arr() {
        let url = if item.is_string() { item.s() } else { item.g("url").s() };
        if let Some(url) = url {
            if !out.images.iter().any(|i| i.as_str() == Some(&url)) {
                out.images.push(json!(url));
            }
        }
    }
    let video = goods.g("video");
    if video.truthy() {
        out.video = match video {
            Value::Object(_) => first_str([video.g("url"), video.g("play_url")]),
            Value::String(s) => Some(s.clone()),
            _ => out.video.take(),
        };
    }
    if out.cover.is_none() {
        out.cover = first_str([goods.g("hd_thumb_url"), goods.g("thumb_url")]);
    }
}

pub fn pinecone(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), author: Some(author("", "", "")), ..Fields::default() };
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    let path: Vec<&str> = parts.path.split('/').filter(|p| !p.is_empty()).collect();
    let story_id = query.any(&["item_id", "story_id"]).or_else(|| {
        (path.len() >= 2 && path[path.len() - 2] == "story").then(|| path[path.len() - 1].to_string())
    });
    let Some(story_id) = story_id else { return out };
    let mut params = vec![
        ("item_type".to_string(), query.any(&["item_type", "story_type"]).unwrap_or_else(|| "1".into())),
        ("item_id".to_string(), story_id),
    ];
    for key in ["sharer_id", "author_id", "channel", "version", "style_id", "share_id"] {
        if let Some(value) = query.get(key) {
            params.push((key.into(), value));
        }
    }
    let headers = headers! {
        "User-Agent" => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Referer" => "https://m.pineconemoment.com/",
    };
    let Some(payload) = Session::new(ctx).get("https://m.pineconemoment.com/share/item/detail").query(&params).headers(&headers).json_value() else {
        return out;
    };
    if !matches!(payload.g("code").as_i64(), Some(0 | 200)) {
        return out;
    }
    let data = payload.g("data");
    let story = data.g("story").or(data.g("interactive_comic"));
    if !story.is_object() {
        return out;
    }
    out.title = Some(story.g("title").str_or_empty());
    let creator = story.g("creator").or(story.g("sharer"));
    out.author = Some(author(
        creator.g("nickname").str_or_empty(),
        first([creator.g("user_id"), creator.g("short_id")]).str_or_empty(),
        creator.g("avatar").str_or_empty(),
    ));
    let images = story.g("images").arr();
    out.images = images.iter().filter_map(|i| valid_url(i.g("url")).map(|u| json!({"url": u}))).collect();
    out.videos = dedupe(images.iter().filter_map(|i| valid_url(i.g("video_url"))).collect());
    let first_image = images.first().filter(|i| i.is_object()).unwrap_or(&NULL);
    out.cover = first_str([first_image.g("video_cover_url"), first_image.g("url"), story.g("cover_uri")]);
    out.audio = valid_url(story.at("dubbing.h5_audio.audio_url"));
    out
}

pub fn pipigaoxiao(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let headers = headers! {
        "content-type" => "application/json; charset=UTF-8",
        "User-Agent" => ua_pc(),
        "referer" => real_url,
    };
    let data = urls::get_video_id(real_url)
        .and_then(|pid| pid.parse::<i64>().ok())
        .and_then(|pid| {
            Session::new(ctx)
                .post("https://h5.pipigx.com/ppapi/share/fetch_content")
                .json(&json!({"mid": "null", "pid": pid, "type": "post"}))
                .headers(&headers)
                .timeout(5.0)
                .send()
                .ok()
                .filter(|r| r.status == 200)
                .and_then(|r| r.json())
        })
        .unwrap_or(Value::Null);
    let post = data.at("data.post");
    let imgs = post.g("imgs").arr();
    let video = imgs.first().and_then(|first| post.g("videos").g(&first.g("id").str_or_empty()).g("url").s());
    let mut images = Vec::new();
    for img in imgs {
        if !img.is_object() || img.g("video").truthy() {
            continue;
        }
        let urls = img.g("urls");
        let url = ["origin", "540", "360"]
            .iter()
            .flat_map(|k| urls.g(k).g("urls").arr().iter())
            .find_map(|u| u.s())
            .or_else(|| img.g("id").truthy().then(|| format!("https://file.ippzone.com/img/view/id/{}", img.g("id").str_or_empty())));
        images.extend(url.map(Value::String));
    }
    let user = data.at("data.user");
    let avatar = user.g("avatar").str_or_empty();
    let avatar = if !avatar.is_empty() && avatar.chars().all(|c| c.is_ascii_digit()) {
        format!("https://file.ippzone.com/img/view/id/{avatar}")
    } else {
        avatar
    };
    Fields {
        video,
        desc: post.g("content").s(),
        images,
        cover: Some(imgs.first().map(|i| format!("https://file.ippzone.com/img/view/id/{}", i.g("id").str_or_empty())).unwrap_or_default()),
        author: Some(if data.truthy() {
            author(user.g("name").str_or_empty(), user.g("mid").or(post.g("mid")).str_or_empty(), avatar)
        } else {
            json!({})
        }),
        ..Fields::default()
    }
}

fn strip_ppx_suffix(title: &str) -> String {
    re!(r"\s*-\s*皮皮虾\s*$").replace(title, "").trim().to_string()
}

pub fn pipixia(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => ua_pc(), "Referer" => "https://h5.pipix.com/"};
    let mut title = String::new();
    let mut item = Value::Null;
    let response = session.get(real_url).headers(&headers).no_redirect().send().ok();
    let html = response.as_ref().map(|r| r.text()).unwrap_or_default();
    if !html.is_empty() {
        for c in re!(r"(?s)<script[^>]*>(.*?)</script>").captures_iter(&html) {
            let text = c[1].trim();
            let payload = if text.contains("%22ppxItemDetail%22") || text.contains("%22itemId%22") || text.contains("%7B%22") {
                parse_json(&unquote(text))
            } else if text.contains("ppxItemDetail") {
                parse_json(text)
            } else {
                None
            };
            let Some(payload) = payload else { continue };
            let found = payload.at("ppxItemDetail.item");
            if found.truthy() {
                if title.is_empty() {
                    title = strip_ppx_suffix(&payload.at("seoTDK.title").str_or_empty());
                }
                item = found.clone();
                break;
            }
        }
        if title.is_empty() {
            title = og_title(&html);
        }
    }
    if !item.truthy() {
        let location = response
            .as_ref()
            .and_then(|r| r.header("location"))
            .or_else(|| response.as_ref().map(|r| r.url.clone()))
            .unwrap_or_else(|| real_url.to_string());
        let location = urljoin(real_url, &location);
        let id = location.split('?').next().unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
            let api = format!("https://api.pipix.com/bds/cell/cell_comment/?offset=0&cell_type=1&api_version=1&cell_id={id}&ac=wifi&channel=huawei_1319_64&aid=1319&app_name=super");
            if let Some(data) = session.get(api).headers(&headers).json_value() {
                item = data.at("data.cell_comments.0.comment_info.item").clone();
                if title.is_empty() {
                    title = session.get(&location).headers(&headers).send().map(|r| og_title(&r.text())).unwrap_or_default();
                }
            }
        }
    }
    let first_url = |v: &Value| v.g("url_list").i(0).g("url").s();
    let video = item.g("video");
    let video_url = ["video_download", "video_high", "video_fallback", "video_mid", "video_low"]
        .iter()
        .find_map(|k| video.g(k).g("url_list").truthy().then(|| first_url(video.g(k))).flatten());
    let images = item
        .at("note.multi_image")
        .arr()
        .iter()
        .filter(|i| i.g("url_list").truthy())
        .filter_map(first_url)
        .map(Value::String)
        .collect();
    let cover = if item.at("cover.url_list").truthy() { first_url(item.g("cover")) } else { first_url(video.g("cover_image")) };
    let author_node = item.g("author");
    let avatar_list = author_node.at("avatar.download_list").or(author_node.at("avatar.url_list"));
    let avatar = match avatar_list.i(0) {
        Value::Object(_) => avatar_list.i(0).g("url").str_or_empty(),
        Value::Null => String::new(),
        other => other.str_or_empty(),
    };
    Fields {
        title: opt(Some(title)),
        desc: item.g("content").s(),
        video: video_url,
        images,
        cover,
        author: Some(author(
            author_node.g("name").str_or_empty(),
            author_node.g("id").or(author_node.g("id_str")).str_or_empty(),
            avatar,
        )),
        ..Fields::default()
    }
}

fn og_title(html: &str) -> String {
    let title = re!(r#"(?i)<meta\s+property=["']og:title["']\s+content=["'](.*?)["']"#)
        .captures(html)
        .map(|c| c[1].to_string())
        .unwrap_or_default();
    strip_ppx_suffix(&title)
}

/// Soul requires signed share parameters; `None` mirrors upstream's constructor error.
pub fn soul(real_url: &str, ctx: &Arc<Ctx>) -> Option<Fields> {
    let parts = UrlParts::parse(real_url);
    let query = parts.qs();
    let fragment = parts.fragment.split_once('?').map(|(_, q)| Query::parse(q)).unwrap_or_default();
    let mut params = Vec::new();
    for key in ["postIdEcpt", "sign", "signVersion"] {
        params.push((key, query.get(key).or_else(|| fragment.get(key))?));
    }
    let session = Session::new(ctx);
    let headers = headers! {
        "User-Agent" => ua_m(),
        "Accept" => "application/json, text/plain, */*",
        "Referer" => "https://w13.soulsmile.cn/",
        "Origin" => "https://w13.soulsmile.cn",
    };
    let fetch = |url: &str, params: &[(&str, String)]| {
        session.get(url).query(params).headers(&headers).timeout(15.0).json_value().unwrap_or(Value::Null)
    };
    let result = fetch("https://api-h5.soulapp.cn/html/v3/post/detail", &params);
    let post = if result.g("success").truthy() && result.at("data.post").is_object() { result.at("data.post").clone() } else { Value::Null };
    let user = match post.g("authorIdEcpt").s() {
        Some(id) => {
            let result = fetch("https://api-h5.soulapp.cn/html/v2/user/info", &[("userIdEcpt", id)]);
            if result.g("success").truthy() && result.g("data").is_object() { result.g("data").clone() } else { Value::Null }
        }
        None => Value::Null,
    };
    let normalize = |v: &Value| v.truthy().then(|| v.str_or_empty().replace("\\/", "/"));
    let attachments = post.g("attachments").arr();
    let video = attachments.iter().find(|a| a.g("type").as_str() == Some("VIDEO")).unwrap_or(&NULL);
    let ext = video.g("ext").s().and_then(|e| parse_json(&e)).unwrap_or(Value::Null);
    let images = attachments
        .iter()
        .filter(|a| a.is_object() && a.g("type").as_str() != Some("VIDEO"))
        .filter_map(|a| {
            ["fileUrl", "imageUrl", "imageOriginUrl", "pictureUrl"].iter().find(|k| a.g(k).truthy()).and_then(|k| normalize(a.g(k)))
        })
        .map(Value::String)
        .collect();
    Some(Fields {
        video: normalize(video.g("fileUrl")),
        title: post.g("title").s(),
        desc: post.g("content").s(),
        cover: normalize(video.g("videoCoverUrl").or(ext.g("videoCoverUrl"))),
        author: Some(json!({
            "nickname": user.g("nickName").str_or_empty(),
            "author_id": post.g("authorIdEcpt").str_or_empty(),
            "avatar": normalize(user.g("headImgurl")).unwrap_or_default(),
            "description": first([user.g("signature"), post.g("signature")]).str_or_empty(),
        })),
        images,
        ..Fields::default()
    })
}

fn tc_text(value: Option<String>) -> String {
    value.map(|v| unescape_html(&v).trim().to_string()).unwrap_or_default()
}

fn tc_url(value: Option<String>) -> Option<String> {
    opt(Some(tc_text(value))).map(|v| v.replace("\\/", "/").replace("&amp;", "&"))
}

pub fn tencent_channel(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let headers = headers! {
        "User-Agent" => ua_pc(),
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer" => "https://pd.qq.com/",
    };
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let (mut nickname, mut avatar, mut author_id, mut guild) = (String::new(), String::new(), String::new(), String::new());
    if let Ok(response) = session.get(real_url).headers(&headers).timeout(15.0).send() {
        let html = solve_edgeone(&session, &headers, real_url, response.text());
        let find = |pattern: &str| {
            regex::Regex::new(&format!("(?is){pattern}"))
                .ok()
                .and_then(|r| r.captures(&html).map(|c| c[1].to_string()))
        };
        let find_any = |patterns: &[&str]| patterns.iter().find_map(|p| find(p));
        let mut title = String::new();
        for c in re!(r#"(?s)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>"#).captures_iter(&html) {
            let Some(data) = parse_json(&c[1]).filter(Value::is_object) else { continue };
            if title.is_empty() {
                title = tc_text(first([data.g("headline"), data.g("text")]).text());
            }
            let a = data.g("author");
            if a.is_object() {
                if nickname.is_empty() {
                    nickname = tc_text(a.g("name").text());
                }
                if avatar.is_empty() {
                    avatar = tc_url(a.g("url").text()).unwrap_or_default();
                }
            }
            let v = data.g("video");
            if v.is_object() {
                if out.video.is_none() {
                    out.video = tc_url(v.g("contentUrl").text());
                }
                if out.cover.is_none() {
                    out.cover = tc_url(v.g("thumbnailUrl").text());
                }
            }
        }
        if title.is_empty() {
            title = tc_text(find(r#"<meta[^>]+property=["']og:title["'][^>]+content=["'](.*?)["']"#));
        }
        if out.cover.is_none() {
            out.cover = tc_url(find(r#"<meta[^>]+property=["']og:image["'][^>]+content=["'](.*?)["']"#));
        }
        if out.video.is_none() {
            out.video = tc_url(find_any(&[
                r#"<video[^>]+src=["']([^"']+)["']"#,
                r#""contentUrl"\s*:\s*"([^"]+qchannelvideo[^"]+)""#,
                r#"(https?://qchannelvideo\.photo\.qq\.com/[^"'< >\s]+\.mp4[^"'< >\s]*)"#,
            ]));
        }
        if nickname.is_empty() {
            nickname = tc_text(find_any(&[r#""poster":\{.*?"nick":"([^"]+)""#, r"发帖作者:([^,，]+)"]));
        }
        if avatar.is_empty() {
            avatar = tc_url(find(r#""poster":\{.*?"avatar":"([^"]+)""#)).unwrap_or_default();
        }
        if author_id.is_empty() {
            author_id = tc_text(find_any(&[r#""poster":\{.*?"str_tiny_id":"([^"]+)""#, r#""poster":\{.*?"tiny_id":([0-9]+)"#]));
        }
        if let Some(c) = re!(r"｜([^｜]+)｜腾讯频道").captures(&title) {
            guild = c[1].trim().to_string();
        }
        out.title = Some(title);
    }
    out.videos = out.video.clone().into_iter().collect();
    out.author = Some(json!({"nickname": nickname, "author_id": author_id, "avatar": avatar, "guild_name": guild}));
    out
}

/// EdgeOne bot challenge: run the first inline script and retry with its token cookie.
fn solve_edgeone(session: &Session, headers: &Headers, url: &str, html: String) -> String {
    if !(html.contains("EO-Bot-Js-Token") || html.contains("Qua7lMrVs")) {
        return html;
    }
    let Some(script) = re!(r"(?s)<script[^>]*>(.*?)</script>").captures(&html).map(|c| c[1].to_string()) else { return html };
    let stub = format!(
        "var window = this;
        var location = {{href: {}, search: '?b=2', pathname: '/s'}};
        var document = {{
            createElement: function() {{ return {{setAttribute: function(){{}}, appendChild: function(){{}}}}; }},
            getElementsByTagName: function() {{ return [{{appendChild: function(){{}}}}]; }},
            head: {{appendChild: function(){{}}}}, body: {{appendChild: function(){{}}}}, cookie: ''
        }};
",
        serde_json::to_string(url).unwrap_or_default()
    );
    let Some(values) = signer::eval_expressions(&[&format!("{stub}{script}")], &["r.token", "c"]) else { return html };
    let Some(token) = values[0].clone().filter(|t| !t.is_empty()) else { return html };
    let name = values[1].clone().filter(|c| !c.is_empty()).unwrap_or_else(|| "EO-Bot-Js-Token".into());
    let existing = session.cookie_header(url);
    let cookie = if existing.is_empty() { format!("{name}={token}") } else { format!("{existing}; {name}={token}") };
    match session.get(url).headers(headers).header("Cookie", cookie).timeout(15.0).send() {
        Ok(response) => {
            let text = response.text();
            if text.chars().count() > html.chars().count() { text } else { html }
        }
        Err(_) => html,
    }
}

const XIANYU_APP_KEY: &str = "12574478";

fn https_prefix(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("//") {
        format!("https://{rest}")
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
}

/// Signed goofish MTOP call: a first unsigned request obtains `_m_h5_tk`.
fn xianyu_mtop(session: &Session, api: &str, item_id: &str, second_timeout: f64) -> Option<Value> {
    let url = format!("https://h5api.m.goofish.com/h5/{api}/1.0/");
    let headers = headers! {
        "User-Agent" => "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Referer" => "https://h5.m.goofish.com/",
        "Accept" => "application/json",
    };
    let data = compact_json(&json!({"itemId": item_id}));
    let params = |t: String, sign: String| {
        vec![
            ("jsv", "2.7.3".to_string()),
            ("appKey", XIANYU_APP_KEY.to_string()),
            ("t", t),
            ("sign", sign),
            ("api", api.to_string()),
            ("v", "1.0".into()),
            ("type", "originaljson".into()),
            ("dataType", "json".into()),
            ("data", data.clone()),
        ]
    };
    let _ = session.get(&url).query(&params(now_millis().to_string(), "dummy".into())).headers(&headers).timeout(5.0).send();
    let token = session
        .cookie(&url, "_m_h5_tk")
        .map(|t| t.split('_').next().unwrap_or("").to_string())
        .unwrap_or_default();
    let t2 = now_millis().to_string();
    let sign = md5_hex(format!("{token}&{t2}&{XIANYU_APP_KEY}&{data}"));
    session.get(&url).query(&params(t2, sign)).headers(&headers).timeout(second_timeout).send().ok()?.json()
}

fn xianyu_video(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if matches!(key.as_str(), "videoUrl" | "mainVideoUrl" | "video_url" | "video") {
                    if let Some(url) = child.as_str().filter(|v| v.starts_with("http")) {
                        return Some(url.to_string());
                    }
                }
                if let Some(found) = xianyu_video(child) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(xianyu_video),
        _ => None,
    }
}

pub fn xianyu(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields::default();
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => ua_m_at(0), "Referer" => "https://e.tb.cn/"};
    let Some(html) = session.get(real_url).headers(&headers).text() else {
        out.title = Some(String::new());
        return out;
    };
    let mut item_id = None;
    let mut price = None;
    if let Some(c) = re!(r"var\s+url\s*=\s*'([^']+)'").captures(&html) {
        let query = query_of(&c[1]);
        item_id = query.any(&["id", "itemId"]);
        price = query.get("price");
    }
    if item_id.is_none() {
        let query = query_of(real_url);
        item_id = query.any(&["itemId", "id", "item_id"]);
        if price.is_none() {
            price = query.get("price");
        }
    }
    if let Some(id) = item_id.clone() {
        out.title = Some(match &price {
            Some(p) => format!("闲鱼商品 (商品ID: {id}, 标价: ¥{p})"),
            None => format!("闲鱼商品 (商品ID: {id})"),
        });
        if let Some(result) = xianyu_mtop(&session, "mtop.taobao.idle.item.info", &id, 10.0).filter(Value::is_object) {
            let ret = result.g("ret").i(0).str_or_empty();
            if ret.contains("RGV587_ERROR") {
                session.ctx().report_cookie_required();
            } else if !ret.contains("FAIL_BIZ_ITEM_DEL_NOT_FOUND") && !ret.contains("FAIL_BIZ_ITEM_QUERY_FAILED") {
                let data = result.g("data");
                if let Some(title) = data.g("title").s() {
                    out.title = Some(title);
                }
                if let Some(desc) = data.g("description").s() {
                    out.desc = Some(desc);
                }
                let images: Vec<String> = data
                    .g("imageInfos")
                    .arr()
                    .iter()
                    .filter_map(|i| i.g("url").s())
                    .map(|u| re!(r"(?i)_[0-9]+x[0-9]+[a-z0-9]*\.(jpg|png|webp)$").replace(&https_prefix(&u), "").into_owned())
                    .collect();
                if !images.is_empty() {
                    out.cover = images.first().cloned();
                    out.images = images.into_iter().map(Value::String).collect();
                }
                if let Some(major) = data.g("absoluteMajorPicture").s() {
                    out.cover = Some(https_prefix(&major));
                }
            }
        }
        if out.author.is_none() || out.video.is_none() {
            if let Some(data) = xianyu_mtop(&session, "mtop.taobao.idle.awesome.detail", &id, 5.0).map(|r| r.g("data").clone()).filter(Value::is_object) {
                let fallback = data.at("sellerDO.nick").s();
                let nick = data
                    .at("flowData.floating.components")
                    .arr()
                    .iter()
                    .find_map(|c| c.g("data").g("nick").or(c.g("data").g("userNick")).s().filter(|n| !n.contains('*')))
                    .or(fallback);
                if let Some(nick) = nick {
                    out.author = Some(Value::String(nick));
                }
                if let Some(video) = xianyu_video(&data).map(|v| https_prefix(&v)) {
                    out.videos = vec![video.clone()];
                    out.video = Some(video);
                }
            }
        }
    }
    out.title = Some(out.title.unwrap_or_default());
    out
}
