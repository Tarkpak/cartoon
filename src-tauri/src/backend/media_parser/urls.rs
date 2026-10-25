//! `UrlParser` / `WebFetcher` from upstream `utils/web_fetcher.py`.

use super::core::*;

pub fn get_url(text: &str) -> Option<String> {
    let pattern = fre!(
        r"https?:\/\/(?:www\.|[-a-zA-Z0-9.@:%_+~#=]{1,256}\.[a-zA-Z0-9()]{1,24})\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*?)(?=(?:https?:\/\/|$|\s))"
    );
    let raw = pattern.find(text).ok().flatten()?.as_str().to_string();
    if let Some(c) = re!(r"^(https?://v\.douyin\.com/[a-zA-Z0-9_-]+)/\d+(?:\.\d+)?/?$").captures(&raw) {
        return Some(format!("{}/", &c[1]));
    }
    if let Some(c) = re!(r"^(https?://v\.kuaishou\.com/[a-zA-Z0-9_-]+)/\d+(?:\.\d+)?/?$").captures(&raw) {
        return Some(format!("{}/", &c[1]));
    }
    Some(raw)
}

pub fn get_domain(url: &str) -> String {
    UrlParts::parse(url).hostname().trim_end_matches('.').to_string()
}

pub fn get_platform(url: &str) -> Option<&'static str> {
    let domain = get_domain(url);
    let path = UrlParts::parse(url).path;
    if matches!(domain.as_str(), "www.iesdouyin.com" | "iesdouyin.com") && path.starts_with("/xg/") {
        return Some("西瓜视频");
    }
    if let Some(platform) = domain_platform(&domain) {
        return Some(platform);
    }
    let ends = |suffix: &str| domain.ends_with(suffix);
    if ends(".m.chenzhongtech.com") {
        return Some("快手");
    }
    if domain == "lofter.com" || ends(".lofter.com") {
        return Some("网易LOFTER");
    }
    if ends(".dewu.com") || ends(".poizon.com") {
        return Some("得物");
    }
    if domain == "butterflyai.cn" || ends(".butterflyai.cn") {
        return Some("星绘AI");
    }
    if matches!(domain.as_str(), "cctv.com" | "cctv.cn") || ends(".cctv.com") || ends(".cctv.cn") {
        return Some("央视");
    }
    if matches!(domain.as_str(), "yangshipin.cn" | "yspapp.cn") || ends(".yangshipin.cn") || ends(".yspapp.cn") {
        return Some("央视频");
    }
    None
}

fn keep_params(platform: &str) -> Option<&'static [&'static str]> {
    Some(match platform {
        "小红书" => &["xsec_token", "xsec_source", "source", "xhsshare", "app_platform"],
        // The first upstream branch for 闲鱼/酷狗音乐 wins; later duplicates are unreachable.
        "闲鱼" => &["id", "itemId", "item_id", "price", "tk"],
        "酷狗音乐" => &["hash", "sruserid", "kgsscty1", "chain"],
        "抖音" => &["modal_id", "ep_id", "album_id", "episode_id", "playlet_id", "series_id"],
        "豆包" => &["share_id", "source_type", "video_id", "share_scene", "vid"],
        "即梦AI" => &[
            "item_id", "id", "published_item_id", "search_keyword", "share_token", "share_sec_uid",
            "share_sec_did", "share_campaign_key", "share_category", "share_from", "ct", "ab_vid",
            "scene", "reward_type", "is_self_create_apperance", "author_id", "template_type_id",
            "workDetailType", "itemType", "act_key",
        ],
        "夸克AI" => &["shareId", "share_id", "authorId", "author_id", "channel_from", "biz_id", "qwcontainer", "url", "env"],
        "可灵AI" => &["creative_id", "work_id", "creative_type"],
        "汽水音乐" => &["track_id", "ugc_video_id"],
        "QQ音乐" => &["vid", "songid", "songId", "songmid", "songMid", "id", "__"],
        "松果时刻" => &[
            "sharer_id", "author_id", "channel", "version", "style_id", "share_id", "project_id",
            "story_type", "story_id", "item_type", "item_id",
        ],
        "剪映" => &["template_id", "item_type"],
        "快影" => &["id", "templateId", "template_id", "userId", "app_name", "page_name"],
        "微信公众号" => &["__biz", "mid", "idx", "sn", "scene", "subscene", "clicktime", "enterid"],
        "通义千问" => &[
            "shareId", "share_id", "authorId", "author_id", "bizId", "biz_id", "enter_from", "fp_from",
            "channel_from", "image_index", "qwcontainer", "env",
        ],
        "拼多多" => &[
            "goods_id", "feed_id", "review_id", "ps", "_oak_share_url", "_t_timestamp", "share_uin",
            "refer_share_uin", "refer_share_id", "channel", "page_from",
        ],
        "得物" => &["trendId", "shareId", "source", "shareType", "shareChannel", "isScreenShot"],
        "网易LOFTER" => &["incantation", "permalink", "postId", "blogId"],
        "星绘AI" => &["share_code", "share_id", "entity_type", "is_mine", "resource_count", "share_token"],
        "央视" => &["item_id", "articleId", "pid", "guid"],
        "央视频" => &["vid", "cid", "type", "serverFrom", "articleid", "articleId", "id"],
        _ => return None,
    })
}

pub fn extract_video_address(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    let parts = UrlParts::parse(url);
    let domain = get_domain(url);
    let platform = get_platform(url).unwrap_or("");
    let mut address = format!("{}://{}{}", parts.scheme, domain, parts.path);
    if address.ends_with('/') {
        address.pop();
    }
    let query = parts.qs();
    let append = |address: &mut String, pairs: Vec<(String, String)>| {
        if !pairs.is_empty() {
            *address = format!("{address}?{}", urlencode(&pairs));
        }
    };
    let single = |address: &mut String, key: &str| {
        if let Some(value) = query.get(key) {
            *address = format!("{address}?{}", urlencode(&[(key, value)]));
        }
    };
    match platform {
        "好看视频" => {
            let pairs = query.keep(&["vid", "id", "context", "pd", "src", "nid", "sign", "word", "oword", "atn", "frsrcid"]);
            if !pairs.is_empty() {
                address = format!("{address}?{}", urlencode_quote(&pairs));
            }
        }
        "微视" => {
            if let Some(id) = query.get("id") {
                address = format!("{address}?id={id}");
            }
        }
        "快手" => address = address.replace("http://", "https://"),
        "全民K歌" => {
            if let Some(s) = query.get("s") {
                address = format!("{address}?s={s}");
            }
        }
        "最右" => {
            if let Some(pid) = query.get("pid") {
                address = format!("{address}?pid={pid}");
            }
        }
        "微博" => single(&mut address, "fid"),
        "腾讯频道" => single(&mut address, "b"),
        "视频号" => single(&mut address, "id"),
        "绿洲" => single(&mut address, "sid"),
        "腾讯元宝" => single(&mut address, "userId"),
        "Soul" => {
            if let Some((path, fragment_query)) = parts.fragment.split_once('?') {
                let pairs = Query::parse(fragment_query).keep(&["postIdEcpt", "sign", "signVersion"]);
                if !pairs.is_empty() {
                    address = format!("{address}#{path}?{}", urlencode(&pairs));
                }
            }
        }
        "网易云音乐" => {
            let mut query = query.clone();
            let fragment = parts.fragment.trim_start_matches('/');
            if let Some((path, fragment_query)) = fragment.split_once('?') {
                if matches!(path, "song" | "mv" | "event") {
                    address = format!("{}://{}/{}", parts.scheme, domain, path);
                    query = Query::parse(fragment_query);
                }
            }
            let pairs: Vec<_> = query
                .keep(&["id", "uid", "userid", "type", "eventId", "songId"])
                .into_iter()
                .filter(|(_, value)| value != "null")
                .collect();
            append(&mut address, pairs);
        }
        "红果短剧" | "番茄小说" | "红果漫剧" | "小云雀AI" => {
            if !parts.query.is_empty() {
                address = format!("{address}?{}", parts.query);
            }
        }
        other => {
            if let Some(keys) = keep_params(other) {
                append(&mut address, query.keep(keys));
            }
        }
    }
    Some(address)
}

pub fn get_video_id(url: &str) -> Option<String> {
    if let Some(c) = re!(
        r#"(?:["%22]|%22)?(?:vid|video_id|content_id|material_id)(?:["%22]|%22)?\s*(?:[:=]|%3A)\s*(?:["%22]|%22)?(\d{15,22})"#
    )
    .captures(url)
    {
        return Some(c[1].to_string());
    }
    let parts = UrlParts::parse(url);
    let query = parts.qs();
    let groups: &[&[&str]] = &[
        &["trendId"], &["shareId"], &["vid"], &["songid", "songId", "songmid", "songMid"], &["hash"],
        &["itemId", "item_id"], &["id"], &["modal_id"], &["ep_id"], &["episode_id"], &["album_id"],
        &["playlet_id"], &["series_id"], &["v"], &["s"], &["pid"], &["video_id"], &["creative_id"],
        &["work_id"],
    ];
    for keys in groups {
        if let Some(value) = query.any(keys) {
            return Some(value);
        }
    }
    if let Some((_, fragment_query)) = parts.fragment.split_once('?') {
        if let Some(value) = Query::parse(fragment_query).get("postIdEcpt") {
            return Some(value);
        }
    }
    let later: &[&[&str]] = &[
        &["track_id"], &["ugc_video_id"], &["template_id"], &["feed_id"], &["goods_id"], &["review_id"],
        &["ps"], &["share_code"], &["item_id"], &["articleId", "articleid"], &["guid"],
    ];
    for keys in later {
        if let Some(value) = query.any(keys) {
            return Some(value);
        }
    }
    let last = parts.path.trim_matches('/').rsplit('/').next().unwrap_or("").to_string();
    let last = last
        .strip_suffix(".html")
        .or_else(|| last.strip_suffix(".shtml"))
        .unwrap_or(&last)
        .to_string();
    if let Some(c) = re!(r"^mv_([0-9a-fA-F]{32})$").captures(&last) {
        return Some(c[1].to_string());
    }
    opt(Some(last))
}

pub fn is_allowed_target(url: &str) -> bool {
    if url.trim().is_empty() {
        return false;
    }
    let parts = UrlParts::parse(url);
    if !matches!(parts.scheme.as_str(), "http" | "https") {
        return false;
    }
    if parts.hostname().is_empty() || parts.has_userinfo() {
        return false;
    }
    match parts.port() {
        Ok(None) | Ok(Some(80)) | Ok(Some(443)) => {}
        _ => return false,
    }
    get_platform(url).is_some()
}

const DIRECT_PLATFORMS: &[&str] = &[
    "知乎", "绿洲", "新片场", "夸克AI", "通义千问", "微博", "小云雀AI", "哔哩哔哩", "快影", "微信公众号",
    "海螺AI", "网易LOFTER", "得物", "央视",
];
const SHORT_DOMAINS: &[&str] = &["t.cn", "b23.tv", "xhslink.cn", "xhslink.com", "hy.fan", "dw4.co", "yspapp.cn"];

/// `WebFetcher.fetch_redirect_url`: resolve share links without leaving supported domains.
pub fn fetch_redirect_url(session: &Session, url: &str) -> Option<String> {
    if !is_allowed_target(url) {
        return None;
    }
    let domain = get_domain(url);
    if !SHORT_DOMAINS.contains(&domain.as_str())
        && get_platform(url).is_some_and(|p| DIRECT_PLATFORMS.contains(&p))
    {
        return extract_video_address(url);
    }
    let headers = headers! {
        "content-type" => "application/json; charset=UTF-8",
        "User-Agent" => ua_pc(),
    };
    let mut current = url.to_string();
    let mut completed = false;
    for _ in 0..5 {
        let response = session
            .get(&current)
            .headers(&headers)
            .no_redirect()
            .timeout(5.0)
            .ok()
            .ok()?;
        let mut redirect = response.header("location");
        if redirect.is_none() && response.status == 200 {
            let body = response.text();
            if let Some(c) = re!(r#"(?i)<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?[^"']*URL=['"]?([^'" >]+)"#).captures(&body) {
                redirect = Some(c[1].trim_matches(['\'', '"']).to_string());
            }
        }
        let Some(redirect) = redirect else {
            completed = true;
            break;
        };
        let redirect = urljoin(&current, &redirect);
        if ["/login", "/404", "/captcha", "/verify", "/error", "/visitor"]
            .iter()
            .any(|part| redirect.contains(part))
        {
            completed = true;
            break;
        }
        if !is_allowed_target(&redirect) {
            return None;
        }
        current = redirect;
        if get_platform(&current).is_some() {
            completed = true;
            break;
        }
    }
    if !completed {
        return None;
    }
    get_platform(&current)?;
    extract_video_address(&current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_share_urls_like_upstream() {
        assert_eq!(
            get_url("7.46 复制打开抖音 https://v.douyin.com/iAbcDef/ 看看").as_deref(),
            Some("https://v.douyin.com/iAbcDef/")
        );
        assert_eq!(
            get_url("https://v.douyin.com/iAbcDef/3.05/").as_deref(),
            Some("https://v.douyin.com/iAbcDef/")
        );
        assert_eq!(
            get_url("看 http://xhslink.com/a/Bc12 复制").as_deref(),
            Some("http://xhslink.com/a/Bc12")
        );
        assert_eq!(get_url("没有链接"), None);
    }

    #[test]
    fn detects_platforms_and_keeps_parameters() {
        assert_eq!(get_platform("https://www.xiaohongshu.com/explore/1"), Some("小红书"));
        assert_eq!(get_platform("https://abc.m.chenzhongtech.com/x"), Some("快手"));
        assert_eq!(get_platform("https://www.iesdouyin.com/xg/1"), Some("西瓜视频"));
        assert_eq!(get_platform("https://example.com/"), None);
        assert_eq!(
            extract_video_address("https://www.xiaohongshu.com/explore/66/?xsec_token=AB%3D&foo=1&xsec_source=pc").as_deref(),
            Some("https://www.xiaohongshu.com/explore/66?xsec_token=AB%3D&xsec_source=pc")
        );
        assert_eq!(
            extract_video_address("https://www.douyin.com/user/x?modal_id=7300000000000000000").as_deref(),
            Some("https://www.douyin.com/user/x?modal_id=7300000000000000000")
        );
        assert!(!is_allowed_target("https://user@www.douyin.com/"));
        assert!(!is_allowed_target("https://www.douyin.com:8080/"));
        assert!(!is_allowed_target("file:///etc/passwd"));
    }

    #[test]
    fn extracts_video_ids() {
        assert_eq!(get_video_id("https://www.douyin.com/video/7300000000000000001").as_deref(), Some("7300000000000000001"));
        assert_eq!(get_video_id("https://www.douyin.com/user/x?modal_id=73000000000000000").as_deref(), Some("73000000000000000"));
        assert_eq!(get_video_id("https://www.pearvideo.com/video_1790.html").as_deref(), Some("video_1790"));
        assert_eq!(get_video_id("https://www.xiaohongshu.com/explore/abc?id=").as_deref(), Some("abc"));
    }
}
