//! 今日头条 and 西瓜视频: mobile SSR + ByteDance VOD, then the Douyin chain.

use super::super::core::*;
use super::douyin::Douyin;
use std::sync::Arc;

const MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

#[derive(Clone, Copy, PartialEq)]
enum Site {
    Toutiao,
    Xigua,
}

impl Site {
    fn info_key(self) -> &'static str {
        match self {
            Site::Toutiao => "toutiao_article_info",
            Site::Xigua => "xigua_article_info",
        }
    }
}

pub struct ByteDanceArticle {
    site: Site,
    inner: Douyin,
}

fn mobile_headers() -> Headers {
    headers! {
        "User-Agent" => MOBILE_UA,
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language" => "zh-CN,zh-Hans;q=0.9",
    }
}

fn vod_data(session: &Session, info: &Value) -> Value {
    let Some(token) = info.g("playAuthTokenV2").s() else { return Value::Null };
    let Some(query) = b64_decode(&token)
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|t| parse_json(&t))
        .and_then(|t| t.g("GetPlayInfoToken").s())
    else {
        return Value::Null;
    };
    session
        .get(format!("https://vod.bytedanceapi.com/?{query}"))
        .timeout(5.0)
        .send()
        .ok()
        .filter(|r| r.status == 200)
        .and_then(|r| r.json())
        .map(|j| j.at("Result.Data").clone())
        .unwrap_or(Value::Null)
}

/// Toutiao micro-posts keep text, images and author under `articleInfo.thread.threadBase`.
fn normalize_article(raw: &Value) -> Option<Value> {
    let mut info = raw.g("articleInfo").clone();
    if !info.is_object() {
        return None;
    }
    let base = info.at("thread.threadBase").clone();
    if base.truthy() {
        let user = base.at("user.info").clone();
        if !info.g("title").truthy() {
            let seo = raw.at("seoTDK.title").str_or_empty();
            let seo = seo.strip_suffix("-今日头条").unwrap_or(&seo).trim().to_string();
            info["title"] = if seo.is_empty() { base.g("title").clone() } else { json!(seo) };
        }
        if !info.g("content").truthy() {
            info["content"] = base.g("content").or(base.g("richContent")).clone();
        }
        if !info.g("mediaUser").truthy() && user.truthy() {
            info["mediaUser"] = json!({"screenName": user.g("name"), "avatarUrl": user.g("avatarUrl")});
        }
        let images: Vec<Value> = base
            .g("largeImageList")
            .or(base.g("originImageList"))
            .arr()
            .iter()
            .filter_map(|i| i.g("url").s().map(Value::String))
            .collect();
        info["threadImageList"] = Value::Array(images);
    }
    Some(info)
}

fn mobile_ssr(site: Site, session: &Session, item_id: Option<&str>) -> Option<Value> {
    let id = item_id.filter(|i| !i.is_empty())?;
    let candidates: Vec<String> = match site {
        Site::Toutiao => vec![
            format!("https://m.toutiao.com/w/{id}/"),
            format!("https://m.toutiao.com/video/{id}/"),
            format!("https://m.toutiao.com/i{id}/"),
            format!("https://m.toutiao.com/group/{id}/"),
            format!("https://m.toutiao.com/item/{id}/"),
        ],
        Site::Xigua => vec![
            format!("https://m.ixigua.com/video/{id}/"),
            format!("https://m.ixigua.com/group/{id}/"),
            format!("https://www.ixigua.com/{id}"),
        ],
    };
    for url in candidates {
        let Ok(response) = session.get(&url).headers(&mobile_headers()).timeout(5.0).send() else { continue };
        if response.status != 200 || response.bytes.is_empty() {
            continue;
        }
        let doc = Html::parse(&response.text());
        let script = match site {
            Site::Toutiao => doc.script_by_id("RENDER_DATA"),
            Site::Xigua => doc.script_by_id("RENDER_DATA").or_else(|| doc.script_by_id("_SSR_DATA")),
        };
        let Some(raw) = script.filter(|s| !s.trim().is_empty()).and_then(|s| parse_json(&unquote(s.trim()))) else { continue };
        let info = match site {
            Site::Toutiao => normalize_article(&raw),
            Site::Xigua => Some(raw.g("articleInfo").or(raw.g("videoInfo")).clone()).filter(Value::is_object),
        };
        let Some(info) = info.filter(Value::truthy) else { continue };
        let vod = vod_data(session, &info);
        let mut data = json!({"vod_data": vod});
        data[site.info_key()] = info;
        return Some(data);
    }
    None
}

impl ByteDanceArticle {
    fn new(site: Site, real_url: &str, ctx: &Arc<Ctx>) -> ByteDanceArticle {
        let hook = move |session: &Session, id: Option<&str>| mobile_ssr(site, session, id);
        ByteDanceArticle { site, inner: Douyin::with_prefetch(real_url, ctx, Some(&hook)) }
    }

    fn info(&self) -> Option<&Value> {
        let data = &self.inner.data;
        data.has(self.site.info_key()).then(|| data.g(self.site.info_key()))
    }

    fn has_vod(&self) -> bool {
        self.inner.data.has("vod_data")
    }
}

pub fn toutiao(real_url: &str, ctx: &Arc<Ctx>) -> ByteDanceArticle {
    ByteDanceArticle::new(Site::Toutiao, real_url, ctx)
}

pub fn xigua(real_url: &str, ctx: &Arc<Ctx>) -> ByteDanceArticle {
    ByteDanceArticle::new(Site::Xigua, real_url, ctx)
}

/// Rich text into paragraph-preserving plain text.
pub fn clean_description(content: &str) -> Option<String> {
    let blocks = ["address", "article", "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "section"];
    opt(Some(rich_text_lines(content, &blocks, &["script", "style", "template"]).join("\n")))
}

impl Parser for ByteDanceArticle {
    fn flags(&self) -> Option<&Flags> {
        self.inner.flags()
    }
    fn flags_mut(&mut self) -> Option<&mut Flags> {
        self.inner.flags_mut()
    }

    fn video_url(&mut self) -> Option<String> {
        if self.has_vod() {
            let data = &self.inner.data;
            let mut streams: Vec<&Value> = data
                .at("vod_data.PlayInfoList")
                .arr()
                .iter()
                .filter(|p| p.g("MainPlayUrl").truthy() || p.g("BackupPlayUrl").truthy())
                .collect();
            streams.sort_by(|a, b| b.g("Bitrate").num().partial_cmp(&a.g("Bitrate").num()).unwrap_or(std::cmp::Ordering::Equal));
            if let Some(best) = streams.first() {
                return first_str([best.g("MainPlayUrl"), best.g("BackupPlayUrl")]);
            }
            let play = data.g(self.site.info_key()).g("playUrlList").i(0);
            if play.truthy() {
                return first_str([play.g("mainUrl"), play.g("backupUrl")]);
            }
        }
        self.inner.video_url()
    }

    fn title(&mut self) -> Option<String> {
        match self.info() {
            Some(info) => info.g("title").s(),
            None => self.inner.title(),
        }
    }

    fn description(&mut self) -> Option<String> {
        match (self.info(), self.site) {
            (Some(info), Site::Toutiao) => info.g("content").as_str().and_then(clean_description),
            (Some(info), Site::Xigua) => info.g("content").s(),
            (None, _) => self.inner.description(),
        }
    }

    fn cover_url(&mut self) -> Option<String> {
        match self.info() {
            Some(info) => first_str([info.g("posterUrl"), self.inner.data.at("vod_data.CoverUrl")]),
            None => self.inner.cover_url(),
        }
    }

    fn author(&mut self) -> Option<Value> {
        let Some(info) = self.info() else { return self.inner.author() };
        let (name, avatar) = match self.site {
            Site::Toutiao => {
                let user = info.g("mediaUser");
                (first([user.g("screenName"), info.g("userName"), info.g("source")]), user.g("avatarUrl"))
            }
            Site::Xigua => {
                let user = info.g("mediaUser").or(info.g("user"));
                (
                    first([user.g("screenName"), user.g("name"), info.g("userName"), info.g("source")]),
                    user.g("avatarUrl").or(user.g("avatar")),
                )
            }
        };
        (name.truthy() || avatar.truthy()).then(|| json!({"author": name, "avatar": avatar}))
    }

    fn video_list(&mut self) -> Vec<String> {
        if self.has_vod() {
            return self.video_url().into_iter().collect();
        }
        self.inner.video_list()
    }

    fn image_list(&mut self) -> Vec<Value> {
        if self.site == Site::Toutiao {
            if let Some(info) = self.info() {
                let mut images: Vec<String> = info.g("threadImageList").arr().iter().filter_map(|i| i.s()).collect();
                if let Some(content) = info.g("content").as_str() {
                    let doc = Html::parse(content);
                    images.extend(doc.select("img").into_iter().filter_map(|img| {
                        img.value()
                            .attr("src")
                            .filter(|s| !s.is_empty())
                            .or_else(|| img.value().attr("data-src"))
                            .map(str::to_string)
                    }));
                }
                let images = dedupe(images);
                if !images.is_empty() {
                    return images.into_iter().map(Value::String).collect();
                }
            }
        }
        self.inner.image_list()
    }

    fn audio_url(&mut self) -> Option<String> {
        self.inner.audio_url()
    }

    fn subtitles(&mut self) -> Option<Value> {
        self.inner.subtitles()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_rich_text() {
        let html = "<p>第一段&nbsp; 文字</p><div>第二段<br>换行</div><script>x()</script><p>  </p>";
        assert_eq!(clean_description(html).as_deref(), Some("第一段 文字\n第二段\n换行"));
    }
}
