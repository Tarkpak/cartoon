//! 央视频 (upstream `yangshipin_parser.py`).

use super::super::core::*;
use std::sync::Arc;

const PLAY_API: &str = "https://playvv.yangshipin.cn/playvinfo";

/// cKey for `playvinfo` (AES-128-CBC over a JS-style 32-bit hash prefix).
pub fn ckey(vid: &str, rnd: &str, guid: &str) -> String {
    let base = format!(
        "|{vid}|{rnd}|mg3c3b04ba|1.3.5|{guid}|4330701|https://m.yangshipin.cn/|mozilla/5.0 (iphone; cpu||Mozilla|Netscape|iPhone|"
    );
    let mut hash: u32 = 0;
    for ch in base.chars() {
        hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(ch as u32);
    }
    let plain = format!("|{}{base}", hash as i32);
    let key = hex::decode("4e2918885fd98109869d14e0231a0bf4").unwrap();
    let iv = hex::decode("16b17e519ddd0ce5b79d7a63a4dd801c").unwrap();
    let encrypted = aes_cbc_encrypt(&key, &iv, plain.as_bytes()).unwrap_or_default();
    format!("--01{}", hex::encode_upper(encrypted))
}

fn jsonp_body(text: &str) -> Option<Value> {
    parse_json(text.trim().trim_matches(['(', ')']))
}

struct Yangshipin {
    session: Session,
    headers: Headers,
    real_url: String,
    vid: Option<String>,
    article_id: Option<String>,
    out: Fields,
}

impl Yangshipin {
    fn title_empty(&self) -> bool {
        self.out.title.as_deref().map_or(true, str::is_empty)
    }

    fn fetch_video(&mut self, vid: &str) {
        let guid = uuid::Uuid::new_v4().simple().to_string();
        let headers = headers! {"User-Agent" => ua_m_at(0), "Referer" => "https://m.yangshipin.cn/", "Accept" => "*/*"};
        let Ok(probe) = self
            .session
            .get(PLAY_API)
            .query(&[("vid", vid), ("platform", "4330701"), ("otype", "json")])
            .headers(&headers)
            .timeout(5.0)
            .send()
        else {
            return;
        };
        let Some(probe) = jsonp_body(&probe.text()) else { return };
        let cur_time = probe.g("curTime").text().filter(|_| probe.g("curTime").truthy()).unwrap_or_else(|| now_secs().to_string());
        let params = [
            ("charge", "0".to_string()),
            ("defaultfmt", "auto".into()),
            ("otype", "json".into()),
            ("guid", guid.clone()),
            ("flowid", format!("{guid}_4330701")),
            ("platform", "4330701".into()),
            ("sdtfrom", "v7007".into()),
            ("defnpayver", "1".into()),
            ("appVer", "1.3.5".into()),
            ("host", "m.yangshipin.cn".into()),
            ("ehost", format!("https://m.yangshipin.cn/portrait_video?vid={vid}")),
            ("refer", "m.yangshipin.cn".into()),
            ("sphttps", "1".into()),
            ("sphls", "1".into()),
            ("_rnd", cur_time.clone()),
            ("spwm", "4".into()),
            ("vid", vid.into()),
            ("defn", "fhd".into()),
            ("encryptVer", "8.1".into()),
            ("cKey", ckey(vid, &cur_time, &guid)),
        ];
        let Ok(response) = self.session.get(PLAY_API).query(&params).headers(&headers).timeout(5.0).send() else { return };
        let Some(data) = jsonp_body(&response.text()) else { return };
        let vi = data.at("vl.vi.0");
        if !vi.truthy() {
            return;
        }
        let base = vi.at("ul.ui.0.url").s();
        if let (Some(base), Some(fname), Some(key)) = (base, vi.g("fn").s(), vi.g("fvkey").s()) {
            self.out.video = Some(format!("{base}{fname}?vkey={key}&platform=2"));
        }
        if self.title_empty() {
            if let Some(title) = vi.g("ti").s() {
                self.out.title = Some(title);
            }
        }
    }

    fn fetch_article(&mut self, id: &str) {
        let headers = headers! {
            "User-Agent" => ua_m_at(0),
            "Referer" => "https://m.yangshipin.cn/",
            "Accept" => "application/json, text/plain, */*",
        };
        let params = [
            ("vappid", "59306155"),
            ("vsecret", "b42702bf7309a179d102f3d51b1add2fda0bc7ada64cb801"),
            ("raw", "1"),
            ("targetId", "1"),
            ("id", id),
        ];
        for api in [
            "https://comment.yangshipin.cn/web/article/article_info",
            "https://h5access.yangshipin.cn/web/article/article_info",
        ] {
            let Ok(response) = self.session.get(api).query(&params).headers(&headers).timeout(5.0).send() else { continue };
            if response.status != 200 {
                continue;
            }
            let Some(result) = response.json() else { continue };
            let data = result.g("data");
            if !data.truthy() || data.g("errCode").as_i64() != Some(0) {
                continue;
            }
            let head = data.g("head");
            if self.title_empty() {
                self.out.title = Some(trimmed(head.g("title")).unwrap_or_default());
            }
            if self.out.cover.is_none() {
                self.out.cover = head.g("coverImage").s();
            }
            if let (Some(source), None) = (head.g("source").s(), &self.out.author) {
                self.out.author = Some(json!({"name": source, "avatar": null}));
            }
            let content = data.g("content");
            for img in content.g("images").arr() {
                if img.truthy() && !self.out.images.contains(img) {
                    self.out.images.push(img.clone());
                }
            }
            let raw_html = content.g("content").str_or_empty();
            if !raw_html.is_empty() {
                let blocks = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "section", "article"];
                self.out.desc = opt(Some(rich_text_lines(&raw_html, &blocks, &["script", "style"]).join("\n\n")));
            }
            let capsule = data.g("audioCapsule");
            if capsule.is_object() && capsule.g("audioUrl").truthy() {
                self.out.audio = capsule.g("audioUrl").s();
            } else if let Some(url) = capsule.as_str().filter(|s| s.starts_with("http")) {
                self.out.audio = Some(url.to_string());
            }
            let mut vids: Vec<String> = content
                .g("videos")
                .arr()
                .iter()
                .filter_map(|v| if v.is_object() { v.g("vid").text() } else { v.s() })
                .collect();
            if vids.is_empty() && !raw_html.is_empty() {
                vids = re!(r#"(?i)<cctv_video\s+[^>]*id=['"]([^'"]+)['"]"#)
                    .captures_iter(&raw_html)
                    .map(|c| c[1].to_string())
                    .collect();
            }
            if !vids.is_empty() {
                if self.vid.is_none() {
                    self.vid = Some(vids[0].clone());
                }
                for vid in vids {
                    self.fetch_video(&vid);
                    if let Some(url) = self.out.video.clone() {
                        if !self.out.videos.contains(&url) {
                            self.out.videos.push(url);
                        }
                    }
                }
            }
            break;
        }
    }

    fn fetch_html(&self) -> Option<String> {
        self.session.get(&self.real_url).headers(&self.headers).timeout(5.0).text()
    }

    fn ids_from(&mut self, url: &str, replace_vid: bool) {
        let query = query_of(url);
        if replace_vid {
            self.vid = query.get("vid");
        }
        if self.article_id.is_none() {
            self.article_id = query.any(&["articleid", "articleId", "id"]);
        }
    }

    fn fallback_without_html(&mut self) {
        if let Some(id) = self.article_id.clone() {
            self.fetch_article(&id);
        } else if let Some(vid) = self.vid.clone() {
            self.fetch_video(&vid);
        }
    }

    fn parse(&mut self) {
        let url = self.real_url.clone();
        self.ids_from(&url, true);
        let Some(mut html) = self.fetch_html() else {
            self.fallback_without_html();
            return;
        };
        if let Some(c) = re!(r#"(?i)<meta\s+http-equiv=["']refresh["']\s+content=["'][^;]+;\s*URL=['"]([^'"]+)['"]"#).captures(&html) {
            let mut redirect = c[1].trim().to_string();
            if redirect.starts_with('/') {
                redirect = format!("https://m.yangshipin.cn{redirect}");
            }
            self.real_url = redirect.clone();
            let replace = self.vid.is_none() || self.vid.as_deref() == Some("5Sqx");
            self.ids_from(&redirect, replace);
            match self.fetch_html() {
                Some(next) => html = next,
                None => {
                    self.fallback_without_html();
                    return;
                }
            }
        }
        if self.article_id.is_none() && UrlParts::parse(&self.real_url).path.contains("article") {
            self.article_id = re!(r"article(?:id)?=([0-9a-zA-Z_]+)").captures(&self.real_url).map(|c| c[1].to_string());
        }
        if let Some(id) = self.article_id.clone() {
            self.fetch_article(&id);
        }
        let state = |key: &str| -> Option<Value> {
            let index = html.find(key)?;
            let start = html[index..].find('{')? + index;
            serde_json::Deserializer::from_str(&html[start..]).into_iter::<Value>().next()?.ok()
        };
        if let Some(data) = state("window.__STATE_video__") {
            let video = data.at("payloads.sharevideo");
            if self.vid.is_none() {
                self.vid = video.g("vid").s();
            }
            if self.title_empty() {
                self.out.title = Some(trimmed(video.g("title")).unwrap_or_default());
            }
            if self.out.cover.is_none() {
                self.out.cover = video.g("cover_pic").s();
            }
            if let (Some(name), None) = (video.at("om_info.title").s(), &self.out.author) {
                self.out.author = Some(json!({"name": name, "avatar": null}));
            }
        }
        if let Some(data) = state("window.__STATE_portrait_video__") {
            let item = data.at("payloads.videoDataList.items.0");
            if item.truthy() {
                let video = item.g("videoData");
                if self.vid.is_none() {
                    self.vid = video.g("vid").s();
                }
                if self.title_empty() {
                    self.out.title = Some(trimmed(video.g("title")).unwrap_or_default());
                }
                if self.out.cover.is_none() {
                    self.out.cover = first_str([video.at("shareItem.shareImgUrl"), video.at("poster.poster.imageUrl")]);
                }
                let actor = video.at("detailFollowItem.actorItem");
                if actor.truthy() && self.out.author.is_none() {
                    self.out.author = name_avatar(actor.at("nickName.text").s(), actor.g("headUrl").s());
                }
            }
        }
        if self.title_empty() || self.out.cover.is_none() {
            let doc = Html::parse(&html);
            let meta = |property: &str| {
                doc.select("meta")
                    .into_iter()
                    .find(|m| m.value().attr("property") == Some(property))
                    .and_then(|m| m.value().attr("content").filter(|c| !c.is_empty()).map(|c| c.trim().to_string()))
            };
            if self.title_empty() {
                if let Some(title) = meta("og:title").or_else(|| doc.one("title").map(|t| t.text().collect::<String>().trim().to_string())) {
                    self.out.title = Some(title);
                }
            }
            if self.out.cover.is_none() {
                self.out.cover = meta("og:image");
            }
        }
        if self.vid.is_none() && self.article_id.is_none() {
            self.vid = re!(r"[?&]vid=([0-9a-zA-Z_]+)")
                .captures(&self.real_url)
                .or_else(|| re!(r#"["']vid["']\s*:\s*["']([0-9a-zA-Z_]+)["']"#).captures(&html))
                .map(|c| c[1].to_string());
        }
        if let (Some(vid), None) = (self.vid.clone(), &self.out.video) {
            self.fetch_video(&vid);
        }
        if let Some(title) = self.out.title.take() {
            self.out.title = Some(re!(r"<[^>]+>").replace_all(&title, "").trim().to_string());
        }
        if self.out.video.is_none() && self.out.images.is_empty() {
            if let Some(cover) = self.out.cover.clone() {
                self.out.images.push(json!(cover));
            }
        }
    }
}

pub fn yangshipin(real_url: &str, ctx: &Arc<Ctx>) -> Fields {
    let mut parser = Yangshipin {
        session: Session::new(ctx),
        headers: headers! {
            "User-Agent" => ua_m_at(0),
            "Referer" => "https://m.yangshipin.cn/",
            "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        real_url: real_url.to_string(),
        vid: None,
        article_id: None,
        out: Fields { title: Some(String::new()), ..Fields::default() },
    };
    parser.parse();
    let mut out = parser.out;
    out.title = Some(out.title.unwrap_or_default());
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn builds_ckey_like_upstream() {
        assert_eq!(super::ckey("vid1", "1700000000", "guid"), "--0134B8D730AB130F2D78A21896D552F3AFAEC07F9518FF55B887E2BBB6C24089DD741F9D7ED40D5EB9A99070B9B0E45C757F9BF600BFA50B0EE02175C97D19E0A883A381E1412A3E72537021244334CAB2198C3611D523C894C6D253FBE7A6226A6F1A9D30DCAC75EC54E9B08E0315481CEDE8684CFE87BA6763AE33CD62AD2283FA92C25C9390100188424A48580830E1");
    }
}
