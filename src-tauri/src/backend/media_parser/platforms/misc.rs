//! 梨视频, 网易LOFTER, 美拍, 配音秀.

use super::super::core::*;
use super::super::urls;
use std::sync::Arc;

pub fn lishipin(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let headers = headers! {
        "content-type" => "application/json; charset=UTF-8",
        "User-Agent" => ua_pc(),
        "referer" => real_url,
    };
    let video_id = urls::get_video_id(real_url).unwrap_or_default();
    let cont_id: String = video_id.chars().filter(|c| c.is_ascii_digit()).collect();
    let mrd: f64 = rand::random();
    let data = session
        .get("https://www.pearvideo.com/videoStatus.jsp")
        .query(&[("contId", cont_id), ("mrd", mrd.to_string())])
        .headers(&headers)
        .timeout(5.0)
        .send()
        .ok()
        .filter(|r| r.status == 200)
        .and_then(|r| r.json())
        .unwrap_or(Value::Null);
    let html = session.get(real_url).headers(&headers).timeout(5.0).text().unwrap_or_default();
    let doc = Html::parse(&html);
    let video = data.at("videoInfo.videos.srcUrl").s().map(|src| {
        re!(r"(\d+)-(\d+-hd\.mp4)")
            .replace_all(&src, format!("cont-{video_id}-${{2}}").as_str())
            .into_owned()
    });
    let mut out = Fields {
        title: Some(doc.text("div.summary").unwrap_or_default()),
        video,
        cover: Some(data.at("videoInfo.video_image").str_or_empty()),
        author: Some(json!({})),
        ..Fields::default()
    };
    if let Some(node) = doc.one("div.thiscat") {
        let pick = |css: &str| scraper::Selector::parse(css).ok().and_then(|s| node.select(&s).next());
        let nickname = pick("div.col-name").map(|n| element_text(&n)).unwrap_or_default();
        let avatar = pick("img").and_then(|n| n.value().attr("src").map(str::to_string)).unwrap_or_default();
        let unique_id = pick("div.column-subscribe")
            .and_then(|n| n.value().attr("data-userid").map(str::to_string))
            .or_else(|| {
                scraper::Selector::parse("a[href]").ok().and_then(|s| {
                    node.select(&s).find_map(|a| {
                        re!(r"author_(\d+)").captures(a.value().attr("href")?).map(|c| c[1].to_string())
                    })
                })
            })
            .unwrap_or_default();
        out.author = Some(author(nickname, unique_id, avatar));
    }
    out
}

fn strip_tags(text: &str) -> String {
    re!(r"<[^>]+>").replace_all(text, "").trim().to_string()
}

fn lofter_init_data(html: &str) -> Option<Value> {
    if let Some(index) = html.find("window.__initialize_data__") {
        if let Some(start) = html[index..].find('{').map(|p| p + index) {
            if let Some(end) = html[start..].find("</script>").map(|p| p + start) {
                if let Some(data) = parse_json(html[start..end].trim_end_matches(';').trim()) {
                    return Some(data);
                }
            }
        }
    }
    re!(r"(?s)window\.__initialize_data__\s*=\s*(\{.*?\})\s*(?:;|</script>)")
        .captures(html)
        .and_then(|c| parse_json(&c[1]))
}

fn blog_author(blog: &Value) -> Option<Value> {
    name_avatar(
        first_str([blog.g("blogNickName"), blog.g("blogName")]),
        first_str([blog.g("bigAvaImg"), blog.g("avaImg")]),
    )
}

pub fn lofter(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let headers = headers! {
        "User-Agent" => ua_m_at(0),
        "Referer" => "https://www.lofter.com/",
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let Some(html) = Session::new(ctx).get(real_url).headers(&headers).timeout(5.0).text() else { return out };
    match lofter_init_data(&html) {
        Some(data) if data.has("answerDetailData") => {
            let answer = data.g("answerDetailData");
            out.author = blog_author(answer.g("blogInfo"));
            out.title = Some(first([answer.g("barrage"), answer.g("answer")]).str_or_empty());
            for img in answer.g("images").arr() {
                out.images.extend(first_str([img.g("orign"), img.g("raw")]).map(Value::String));
            }
        }
        Some(data) => {
            let bundle = data.at("postData.data");
            let post = bundle.at("postData.postView");
            out.author = blog_author(bundle.g("blogInfo"));
            let title = first([post.g("title"), post.g("digest")]).str_or_empty();
            let mut caption = String::new();
            let video = post.g("videoPostView");
            if video.is_object() && video.truthy() {
                let info = video.g("videoInfo");
                out.video = first_str([info.g("originUrl"), info.g("flashurl")]);
                out.cover = first_str([info.g("video_img_url"), info.g("video_first_img")]);
                caption = video.g("caption").str_or_empty();
            }
            let photo = post.g("photoPostView");
            if photo.is_object() && photo.truthy() {
                for item in photo.g("photoLinks").arr() {
                    out.images.extend(first_str([item.g("raw"), item.g("orign")]).map(Value::String));
                }
                let first_image = photo.g("firstImage").or(post.g("firstImage"));
                if first_image.is_object() {
                    out.cover = first_str([first_image.g("raw"), first_image.g("orign")]);
                }
                if caption.is_empty() {
                    caption = photo.g("caption").str_or_empty();
                }
            }
            out.desc = opt(Some(strip_tags(&caption)));
            out.title = Some(title.trim().to_string());
        }
        None => {
            let doc = Html::parse(&html);
            let meta = |property: &str| {
                doc.select("meta")
                    .into_iter()
                    .find(|m| m.value().attr("property") == Some(property))
                    .and_then(|m| m.value().attr("content").filter(|c| !c.is_empty()).map(|c| c.trim().to_string()))
            };
            if let Some(title) = meta("og:title").or_else(|| doc.one("title").map(|t| t.text().collect::<String>().trim().to_string())) {
                out.title = Some(title);
            }
            out.cover = meta("og:image");
            out.video = doc.attr("video", "src").filter(|s| !s.is_empty()).map(|s| s.trim().to_string());
            for img in doc.select("img") {
                let src = img.value().attr("src").filter(|s| !s.is_empty()).or_else(|| img.value().attr("data-src"));
                if let Some(src) = src.filter(|s| s.contains("lf127.net") && !s.contains("ava")) {
                    out.images.push(json!(src));
                }
            }
        }
    }
    if let Some(title) = out.title.take() {
        out.title = Some(strip_tags(&title));
    }
    out
}

/// Meipai's obfuscated base64 video address.
pub fn meipai_decode(encoded: &str) -> Option<String> {
    let head: String = encoded.chars().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    let digits = u64::from_str_radix(&head, 16).ok()?.to_string();
    let nums: Vec<usize> = digits.chars().map(|c| c.to_digit(10).unwrap() as usize).collect();
    if nums.len() < 4 {
        return None;
    }
    let rest: Vec<char> = encoded.chars().skip(4).collect();
    let remove_once = |chars: &[char], start: usize, len: usize| -> Option<Vec<char>> {
        let start = start.min(chars.len());
        let needle: Vec<char> = chars.get(start..(start + len).min(chars.len()))?.to_vec();
        let tail: String = chars[start..].iter().collect();
        let tail = tail.replacen(&needle.iter().collect::<String>(), "", 1);
        Some(chars[..start].iter().copied().chain(tail.chars()).collect())
    };
    let first = remove_once(&rest, nums[0], nums[1])?;
    let tail_index = first.len().checked_sub(nums[2] + nums[3])?;
    let second = remove_once(&first, tail_index, nums[3])?;
    let raw = String::from_utf8(b64_decode(&second.iter().collect::<String>())?).ok()?;
    Some(if let Some(rest) = raw.strip_prefix("//") {
        format!("https://{rest}")
    } else if let Some(rest) = raw.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        raw
    })
}

pub fn meipai(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), ..Fields::default() };
    let Some(id) = re!(r"\d{15,}").find(real_url.trim()).map(|m| m.as_str().to_string()) else { return out };
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => ua_m_at(0), "Referer" => "https://www.meipai.com/"};
    let Some(html) = session.get(format!("http://www.meipai.com/media/{id}")).headers(&headers).text() else { return out };
    let marker = "window.PHPDATA = ";
    let Some(start) = html.find(marker) else { return out };
    let Some(Ok(phpdata)) = serde_json::Deserializer::from_str(&html[start + marker.len()..]).into_iter::<Value>().next() else {
        return out;
    };
    let media = phpdata.g("mediaInfo");
    if let Some(title) = first_str([media.g("caption_origin"), media.g("caption")]) {
        out.title = Some(strip_tags(&title));
    }
    if let Some(mut cover) = media.g("cover_pic").s() {
        if cover.starts_with("//") {
            cover = format!("https:{cover}");
        }
        out.cover = Some(cover.split('!').next().unwrap_or("").to_string());
    }
    let user = media.g("user");
    if user.is_object() && user.truthy() {
        let mut avatar = user.g("avatar").str_or_empty();
        if avatar.starts_with("//") {
            avatar = format!("https:{avatar}");
        }
        let id = if user.g("id").truthy() { user.g("id").str_or_empty() } else { String::new() };
        out.author = Some(author(user.g("screen_name").str_or_empty(), id, avatar));
    }
    if let Some(raw) = media.g("video").s().and_then(|v| meipai_decode(&v)) {
        let cdn = format!("https://cracl.meitubase.com/resource/get_cdn_url?url={raw}");
        out.video = Some(match session.get(cdn).headers(&headers).timeout(5.0).send() {
            Ok(r) if r.status == 200 => r.url,
            _ => raw,
        });
    }
    out
}

fn absolute(url: Option<String>) -> Option<String> {
    let url = url.filter(|u| !u.is_empty())?;
    if url.starts_with("//") {
        return Some(format!("https:{url}"));
    }
    (url.starts_with("http://") || url.starts_with("https://")).then_some(url)
}

pub fn peiyinxiu(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut out = Fields { title: Some(String::new()), author: Some(author("", "", "")), ..Fields::default() };
    let headers = headers! {
        "User-Agent" => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Referer" => "https://www.peiyinxiu.com/",
    };
    let Some(html) = Session::new(ctx).get(real_url).headers(&headers).text() else { return out };
    let doc = Html::parse(&html);
    let meta = |property: &str| {
        doc.select("meta")
            .into_iter()
            .find(|m| m.value().attr("property") == Some(property))
            .and_then(|m| m.value().attr("content").map(str::to_string))
    };
    let script_value = |key: &str| {
        let pattern = regex::Regex::new(&format!(r#"(?i)\b{key}\s*:\s*['"]([^'"]+)['"]"#)).ok()?;
        absolute(pattern.captures(&html).map(|c| unescape_html(&c[1])))
    };
    let author_id = doc.attr("#wlui", "data-uid").unwrap_or_default();
    let title_tag = doc.one(".filmName");
    out.title = Some(
        title_tag
            .and_then(|t| t.value().attr("data-title").filter(|s| !s.is_empty()).map(str::to_string))
            .or_else(|| title_tag.map(|t| element_text(&t)).filter(|s| !s.is_empty()))
            .or_else(|| meta("og:title").filter(|s| !s.is_empty()))
            .unwrap_or_default(),
    );
    let nickname = doc.text(".athorName span").map(|t| t.trim_start_matches('@').to_string()).unwrap_or_default();
    let avatar = doc.one(".userHead").map(|a| absolute(a.value().attr("src").map(str::to_string))).unwrap_or(Some(String::new()));
    out.author = Some(author(nickname, author_id, opt_value(avatar)));
    out.videos = script_value("filmurl").into_iter().collect();
    out.cover = script_value("filmimg").or_else(|| meta("og:image"));
    out
}

fn zhihu_first_url(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(_) => first_str([value.g("url"), value.g("play_url")]),
        Value::Array(items) => items.iter().find_map(zhihu_first_url),
        _ => None,
    }
}

fn zhihu_playlist(playlist: &Value) -> Option<String> {
    let mut candidates: Vec<&Value> = match playlist {
        Value::Object(map) => map.values().collect(),
        Value::Array(items) => items.iter().collect(),
        _ => return None,
    };
    candidates.retain(|c| c.is_object());
    candidates.sort_by_key(|c| std::cmp::Reverse((c.g("bitrate").int(), c.g("width").int() * c.g("height").int())));
    candidates.iter().find_map(|c| first_str([c.g("play_url"), c.g("url")]))
}

fn html_strings(html: &str, separator: &str) -> String {
    fn walk(element: scraper::ElementRef<'_>, out: &mut Vec<String>) {
        if matches!(element.value().name(), "script" | "style" | "template") {
            return;
        }
        for child in element.children() {
            match child.value() {
                scraper::Node::Text(text) if !text.trim().is_empty() => out.push(text.trim().to_string()),
                scraper::Node::Element(_) => {
                    if let Some(child) = scraper::ElementRef::wrap(child) {
                        walk(child, out);
                    }
                }
                _ => {}
            }
        }
    }
    let fragment = scraper::Html::parse_fragment(html);
    let mut out = Vec::new();
    walk(fragment.root_element(), &mut out);
    out.join(separator)
}

pub fn zhihu(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let session = Session::new(ctx);
    let headers = headers! {"User-Agent" => ua_m_at(0), "Referer" => "https://www.zhihu.com/"};
    let path = UrlParts::parse(real_url).path;
    let patterns: [(&str, &regex::Regex, bool); 5] = [
        ("answers", re!(r"question/\d+/answer/(\d+)"), false),
        ("answers", re!(r"/answer/(\d+)"), false),
        ("videos", re!(r"/zvideo/(\d+)"), false),
        ("pins", re!(r"/pin/(\d+)"), false),
        ("articles", re!(r"(?:zhuanlan\.zhihu\.com/p/|/article/)(\d+)"), true),
    ];
    let found = patterns.iter().find_map(|(api, pattern, whole)| {
        pattern.captures(if *whole { real_url } else { &path }).map(|c| (*api, c[1].to_string()))
    });
    let data = found
        .and_then(|(api, id)| session.get(format!("https://api.zhihu.com/{api}/{id}")).headers(&headers).timeout(15.0).json_value())
        .unwrap_or(Value::Null);
    let pin_video = data.g("content").arr().iter().find(|i| i.g("type").as_str() == Some("video")).cloned().unwrap_or(Value::Null);
    let video = zhihu_playlist(data.g("playlist")).or_else(|| zhihu_playlist(pin_video.g("playlist"))).or_else(|| {
        let content = data.g("content").as_str().unwrap_or("");
        let lens = re!(r#"data-lens-id="(\d+)""#).captures(content)?[1].to_string();
        let info = session.get(format!("https://lens.zhihu.com/api/v4/videos/{lens}")).headers(&headers).timeout(15.0).json_value()?;
        zhihu_playlist(info.g("playlist"))
    });
    let mut images = Vec::new();
    for item in data.g("content").arr() {
        if item.g("type").as_str() == Some("image") {
            images.extend(zhihu_first_url(item.g("url").or(item.g("image"))));
        }
    }
    if let Some(html) = data.g("content").or(data.g("content_html")).as_str() {
        for img in Html::parse(html).select("img") {
            let attrs = img.value();
            let url = ["data-original", "data-actualsrc", "src"].iter().find_map(|k| attrs.attr(k).filter(|v| !v.is_empty()));
            if let Some(url) = url.filter(|u| u.starts_with("http")) {
                images.push(url.to_string());
            }
        }
    }
    let images = dedupe(images);
    let desc = data.g("excerpt").s().or_else(|| {
        data.g("content_html").or(data.g("content")).as_str().map(|html| html_strings(html, " ")).filter(|t| !t.is_empty())
    });
    let cover = zhihu_first_url(pin_video.g("thumbnail"))
        .or_else(|| zhihu_first_url(data.g("thumbnail")))
        .or_else(|| zhihu_first_url(data.g("image_url")))
        .or_else(|| images.first().cloned());
    let a = data.g("author");
    Fields {
        title: first_str([data.at("question.title"), data.g("title"), data.g("excerpt_title")]),
        desc,
        video,
        cover,
        images: images.into_iter().map(Value::String).collect(),
        author: Some(author(a.g("name").str_or_empty(), a.g("id").str_or_empty(), a.g("avatar_url").str_or_empty())),
        ..Fields::default()
    }
}

fn zuiyou_image(node: &Value) -> Option<String> {
    if !node.is_object() {
        return None;
    }
    let urls = node.g("urls");
    if urls.is_object() {
        for key in ["origin", "origin_webp", "540", "540_webp", "360", "360_webp"] {
            if let Some(url) = urls.g(key).g("urls").i(0).s() {
                return Some(url);
            }
        }
    }
    node.g("url").s()
}

fn zuiyou_is_live(video: &Value) -> bool {
    video.is_object() && video.g("dur").is_number() && video.g("dur").num() <= 5.0
}

pub fn zuiyou(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let headers = headers! {
        "Content-Type" => "application/json",
        "User-Agent" => ua_pc(),
        "Referer" => "https://share.xiaochuankeji.cn/",
    };
    let data = query_of(real_url)
        .get("pid")
        .and_then(|pid| pid.trim().parse::<i64>().ok())
        .and_then(|pid| {
            Session::new(ctx)
                .post("https://share.xiaochuankeji.cn/planck/share/post/detail_h5")
                .headers(&headers)
                .json(&json!({"h_av": "5.2.13.011", "pid": pid}))
                .json_value()
        })
        .unwrap_or(Value::Null);
    let post = data.at("data.post");
    let videos = post.g("videos").obj().cloned().unwrap_or_default();
    let imgs = post.g("imgs").arr();
    let mut keys: Vec<String> = imgs.first().map(|i| vec![i.g("id").str_or_empty()]).unwrap_or_default();
    keys.extend(videos.keys().cloned());
    let video = if videos.is_empty() {
        None
    } else {
        keys.iter().find_map(|k| {
            let info = videos.get(k)?;
            (info.g("url").truthy() && !zuiyou_is_live(info)).then(|| info.g("url").str_or_empty())
        })
    };
    let mut images = Vec::new();
    for img in imgs {
        match videos.get(&img.g("id").str_or_empty()) {
            None => images.extend(zuiyou_image(img).map(Value::String)),
            Some(info) => {
                if zuiyou_is_live(info) && info.g("url").truthy() {
                    if let Some(cover) = zuiyou_image(img) {
                        images.push(json!({"url": cover, "live_photo_url": info.g("url")}));
                    }
                }
            }
        }
    }
    let cover = post.g("cover").s().or_else(|| imgs.first().map(|i| zuiyou_image(i).unwrap_or_default()));
    let member = post.g("member");
    Fields {
        video,
        images,
        cover: Some(cover.unwrap_or_default()),
        desc: post.g("content").s(),
        author: Some(author(
            member.g("name").str_or_empty(),
            member.g("id").str_or_empty(),
            member.at("avatar_urls.origin.urls").i(0).str_or_empty(),
        )),
        ..Fields::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_meipai_video() {
        // Vector generated with the upstream Python algorithm.
        let encoded = "1a2bLy9tYYYYYdnZpZGVvLm1laXR1ZGF0YS5jb20vYZZS5tcDQ=";
        assert_eq!(meipai_decode(encoded).as_deref(), Some("https://mvvideo.meitudata.com/a.mp4"));
    }
}
