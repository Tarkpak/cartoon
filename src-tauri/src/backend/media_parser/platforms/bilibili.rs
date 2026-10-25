//! 哔哩哔哩 (upstream `bilibili_parser.py`).

use super::super::core::*;
use std::collections::HashMap;
use std::sync::Arc;

const API_VIEW: &str = "https://api.bilibili.com/x/web-interface/view";
const API_PLAYURL: &str = "https://api.bilibili.com/x/player/playurl";
const API_PGC_PLAYURL: &str = "https://api.bilibili.com/pgc/player/web/playurl";
const API_DYNAMIC_DETAIL: &str = "https://api.bilibili.com/x/polymer/web-dynamic/v1/detail";
const API_SEASON_VIEW: &str = "https://api.bilibili.com/pgc/view/web/season";

pub struct Bilibili {
    session: Session,
    headers: Headers,
    bvid: Option<String>,
    ep_id: Option<String>,
    dynamic_info: Value,
    season_info: Value,
    ep_info: Value,
    video_info: Value,
    play_cache: HashMap<String, Value>,
}

fn capture(pattern: &regex::Regex, text: &str) -> Option<String> {
    pattern.captures(text).map(|c| c[1].to_string())
}

fn https_avatar(value: &Value) -> String {
    let avatar = value.str_or_empty();
    match avatar.strip_prefix("//") {
        Some(rest) => format!("https://{rest}"),
        None => avatar,
    }
}

impl Bilibili {
    pub fn new(real_url: &str, ctx: &Arc<Ctx>) -> Bilibili {
        let mut parser = Bilibili {
            session: Session::new(ctx),
            headers: headers! {"User-Agent" => ua_pc(), "Referer" => "https://www.bilibili.com/"},
            bvid: capture(re!(r"(BV[a-zA-Z0-9]+)"), real_url),
            ep_id: capture(re!(r"(?:bangumi/play/ep|b23\.tv/ep|ep_id=)(\d+)"), real_url),
            dynamic_info: Value::Null,
            season_info: Value::Null,
            ep_info: Value::Null,
            video_info: Value::Null,
            play_cache: HashMap::new(),
        };
        let season_id = if parser.ep_id.is_none() {
            capture(re!(r"(?:bangumi/play/ss|season_id=)(\d+)"), real_url)
        } else {
            None
        };
        let dynamic_id = if parser.bvid.is_some() || parser.ep_id.is_some() || season_id.is_some() {
            None
        } else {
            capture(re!(r"(?:t\.bilibili\.com/|opus/|dynamic_id=)(\d{17,20})"), real_url)
        };
        if parser.ep_id.is_some() || season_id.is_some() {
            parser.season_info = parser.fetch_season(season_id);
            if parser.season_info.truthy() {
                let mut episodes: Vec<Value> = parser.season_info.g("episodes").arr().to_vec();
                for section in parser.season_info.g("section").arr() {
                    episodes.extend(section.g("episodes").arr().iter().cloned());
                }
                if let Some(ep) = &parser.ep_id {
                    parser.ep_info = episodes
                        .iter()
                        .find(|e| e.g("id").str_or_empty() == *ep)
                        .cloned()
                        .unwrap_or(Value::Null);
                }
                if !parser.ep_info.truthy() {
                    parser.ep_info = episodes.first().cloned().unwrap_or(Value::Null);
                }
                if let Some(bvid) = parser.ep_info.g("bvid").s() {
                    parser.bvid = Some(bvid);
                }
            }
        }
        if parser.bvid.is_none() {
            if let Some(id) = dynamic_id {
                parser.dynamic_info = parser.fetch_dynamic(&id);
                let major = parser.dynamic_info.at("modules.module_dynamic.major");
                if major.g("type").as_str() == Some("MAJOR_TYPE_ARCHIVE") {
                    if let Some(bvid) = major.at("archive.bvid").s() {
                        parser.bvid = Some(bvid);
                    }
                }
            }
        }
        if let Some(bvid) = parser.bvid.clone() {
            let headers = headers! {"User-Agent" => "okhttp/4.9.3", "Referer" => "https://www.bilibili.com/"};
            parser.video_info = parser
                .session
                .get(API_VIEW)
                .query(&[("bvid", bvid)])
                .headers(&headers)
                .json_value()
                .filter(|r| r.g("code").as_i64() == Some(0))
                .map(|r| r.g("data").clone())
                .unwrap_or(Value::Null);
        }
        parser
    }

    fn fetch_season(&self, season_id: Option<String>) -> Value {
        let params = match (&self.ep_id, season_id) {
            (Some(ep), _) => vec![("ep_id", ep.clone())],
            (None, Some(season)) => vec![("season_id", season)],
            _ => return Value::Null,
        };
        self.session
            .get(API_SEASON_VIEW)
            .query(&params)
            .headers(&self.headers)
            .json_value()
            .filter(|r| r.g("code").as_i64() == Some(0))
            .map(|r| r.g("result").clone())
            .unwrap_or(Value::Null)
    }

    fn fetch_dynamic(&self, id: &str) -> Value {
        let headers = headers! {
            "User-Agent" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer" => "https://t.bilibili.com/",
        };
        self.session
            .get(API_DYNAMIC_DETAIL)
            .query(&[("id", id)])
            .headers(&headers)
            .json_value()
            .filter(|r| r.g("code").as_i64() == Some(0))
            .map(|r| r.at("data.item").clone())
            .unwrap_or(Value::Null)
    }

    fn play_info(&mut self, cid: &Value) -> Value {
        let Some(cid) = cid.text() else { return Value::Null };
        if let Some(cached) = self.play_cache.get(&cid) {
            return cached.clone();
        }
        if self.ep_info.truthy() || self.season_info.truthy() {
            let mut params = vec![
                ("otype".to_string(), "json".to_string()),
                ("qn".into(), "80".into()),
                ("fnval".into(), "1".into()),
                ("cid".into(), cid.clone()),
            ];
            if let Some(ep) = self.ep_info.g("id").text().or_else(|| self.ep_id.clone()) {
                params.push(("ep_id".into(), ep));
            }
            if let Some(bvid) = &self.bvid {
                params.push(("bvid".into(), bvid.clone()));
            }
            if let Some(result) = self
                .session
                .get(API_PGC_PLAYURL)
                .query(&params)
                .headers(&self.headers)
                .json_value()
                .filter(|r| r.g("code").as_i64() == Some(0))
            {
                let info = result.g("result").or(result.g("data")).clone();
                if info.g("durl").truthy() {
                    self.play_cache.insert(cid, info.clone());
                    return info;
                }
            }
        }
        let Some(bvid) = self.bvid.clone() else { return Value::Null };
        let params = [
            ("otype", "json"),
            ("fnver", "0"),
            ("fnval", "3"),
            ("player", "3"),
            ("qn", "112"),
            ("bvid", &bvid),
            ("cid", &cid),
            ("platform", "html5"),
            ("high_quality", "1"),
        ];
        let Some(result) = self.session.get(API_PLAYURL).query(&params).headers(&self.headers).json_value() else {
            return Value::Null;
        };
        if result.g("code").as_i64() != Some(0) {
            return Value::Null;
        }
        let info = result.g("data").clone();
        self.play_cache.insert(cid, info.clone());
        info
    }

    fn pages(&self) -> Vec<Value> {
        if self.ep_info.g("cid").truthy() {
            return vec![json!({"cid": self.ep_info.g("cid"), "page": 1, "part": self.ep_info.g("title").str_or_empty()})];
        }
        self.video_info.g("pages").arr().to_vec()
    }

    fn dynamic_pics(&self) -> Vec<String> {
        let major = self.dynamic_info.at("modules.module_dynamic.major");
        if major.g("opus").truthy() {
            return major.at("opus.pics").arr().iter().filter_map(|p| p.g("url").s()).collect();
        }
        if major.g("draw").truthy() {
            return major.at("draw.items").arr().iter().filter_map(|p| p.g("src").s()).collect();
        }
        Vec::new()
    }
}

impl Parser for Bilibili {
    fn title(&mut self) -> Option<String> {
        if self.season_info.truthy() && self.ep_info.truthy() {
            let full = format!(
                "{} {} {}",
                self.season_info.g("title").str_or_empty(),
                self.ep_info.g("title").str_or_empty(),
                self.ep_info.g("long_title").str_or_empty()
            )
            .trim()
            .to_string();
            if !full.is_empty() {
                return Some(full);
            }
        }
        if self.video_info.truthy() {
            return self.video_info.g("title").s();
        }
        self.dynamic_info.at("modules.module_dynamic.major.opus.title").s()
    }

    fn description(&mut self) -> Option<String> {
        if self.season_info.truthy() {
            return first_str([self.season_info.g("evaluate"), self.season_info.g("subtitle"), self.video_info.g("desc")]);
        }
        if self.video_info.truthy() {
            return self.video_info.g("desc").s();
        }
        if self.dynamic_info.truthy() {
            let module = self.dynamic_info.at("modules.module_dynamic");
            let desc = module.at("desc.text");
            if module.at("major.opus").truthy() {
                return first_str([module.at("major.opus.summary.text"), desc]);
            }
            return desc.s();
        }
        None
    }

    fn cover_url(&mut self) -> Option<String> {
        if self.ep_info.truthy() {
            if let Some(cover) = first_str([self.ep_info.g("cover"), self.season_info.g("cover")]) {
                return Some(cover);
            }
        }
        if self.video_info.truthy() {
            return self.video_info.g("pic").s();
        }
        self.dynamic_pics().into_iter().next()
    }

    fn author(&mut self) -> Option<Value> {
        let up = self.season_info.g("up_info");
        if up.truthy() {
            return Some(author(up.g("uname").str_or_empty(), up.g("mid").str_or_empty(), https_avatar(up.g("avatar"))));
        }
        if self.video_info.truthy() {
            let owner = self.video_info.g("owner");
            return Some(author(owner.g("name").str_or_empty(), owner.g("mid").str_or_empty(), https_avatar(owner.g("face"))));
        }
        if self.dynamic_info.truthy() {
            let a = self.dynamic_info.at("modules.module_author");
            return Some(author(a.g("name").str_or_empty(), a.g("mid").str_or_empty(), https_avatar(a.g("face"))));
        }
        Some(author("", "", ""))
    }

    fn video_url(&mut self) -> Option<String> {
        let page = self.pages().into_iter().next()?;
        self.play_info(page.g("cid")).g("durl").i(0).g("url").s()
    }

    fn video_list(&mut self) -> Vec<String> {
        if !self.video_info.truthy() {
            return Vec::new();
        }
        let pages = self.pages();
        if pages.len() <= 1 {
            return Vec::new();
        }
        pages
            .iter()
            .filter_map(|page| self.play_info(page.g("cid")).g("durl").i(0).g("url").s())
            .collect()
    }

    fn image_list(&mut self) -> Vec<Value> {
        self.dynamic_pics().into_iter().map(Value::String).collect()
    }
}
