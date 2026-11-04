//! Separate explicit document metadata from the script to be filmed. Ranges stay
//! in the original document so the editor can still slice by episode offsets.
use serde_json::{json, Value};
use std::ops::Range;

fn heading(line: &str) -> Option<(usize, &str)> {
    let line = line.trim();
    let level = line.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&level) || !line[level..].starts_with(char::is_whitespace) {
        return None;
    }
    Some((
        level,
        line[level..]
            .trim()
            .trim_end_matches('#')
            .trim()
            .trim_end_matches(['：', ':']),
    ))
}

pub(super) fn body_range(text: &str) -> Range<usize> {
    let mut start = 0;
    let mut end = text.len();
    let mut body_level = None;
    let mut offset = 0;
    let mut fenced = false;
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
        }
        if let Some((level, title)) = (!fenced).then(|| heading(line)).flatten() {
            if body_level.is_none() && matches!(title, "分场剧本" | "剧本正文" | "正文") {
                start = offset + line.len();
                body_level = Some(level);
            } else if matches!(title, "识别存疑项" | "识别疑点" | "识别备注" | "ASR备注")
                && body_level.is_none_or(|body_level| level <= body_level)
            {
                end = offset;
                break;
            }
        }
        offset += line.len();
    }
    // Trimming must also move the offsets, rather than changing the source text.
    let body = &text[start..end];
    let leading = body.len() - body.trim_start().len();
    start += leading;
    end = start + body.trim().len();
    start..end
}

pub(super) fn context(text: &str, range: &Range<usize>) -> String {
    let prefix = text[..range.start].trim();
    let suffix = text[range.end..].trim();
    if prefix.is_empty() && suffix.is_empty() {
        return String::new();
    }
    format!("\n\n【文档背景资料（不是待拍摄正文）】\n以下角色说明、梗概或识别备注仅用于理解身份与消歧，不得为其生成分镜或选取分集锚点。仅【输入文本】或【输入原文】中的正文属于本次处理范围。\n{prefix}\n{suffix}")
}

pub(super) fn restore_episode_offsets(episodes: &mut [Value], prefix: &str) {
    let offset = prefix.chars().count();
    for episode in episodes {
        for key in ["startOffset", "endOffset"] {
            if let Some(value) = episode.get(key).and_then(Value::as_u64) {
                episode[key] = json!(value + offset as u64);
            }
        }
    }
}

/// Also handles old directories whose first episode still includes the synopsis,
/// and last-episode slices containing trailing recognition notes.
pub(super) fn prepare_parse_body(mut body: Value) -> Result<Value, String> {
    if body.get("scriptParseMode").and_then(Value::as_str) == Some("origin_explainer") {
        return Ok(body);
    }
    let text = body.get("text").and_then(Value::as_str).unwrap_or("");
    let range = body_range(text);
    let source = text[range.clone()].to_string();
    if source.is_empty() {
        return Err("剧本正文为空，请在正文标题下补充内容".into());
    }
    let context = context(text, &range);
    if !context.is_empty() {
        body["scriptDocumentContext"] = json!(context);
        // Parse requests contain exactly one selected episode (validated by API).
        if let Some(episodes) = body.get_mut("episodePlan").and_then(Value::as_array_mut) {
            for episode in episodes {
                episode["startOffset"] = json!(0);
                episode["endOffset"] = json!(source.encode_utf16().count());
                episode["charCount"] = json!(source.chars().count());
            }
        }
    }
    body["text"] = json!(source);
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_metadata_is_not_part_of_the_episode_source() {
        let text = "# 炒鸡😀\n## 角色\n主人公\n## 剧情梗概\n旧摊冲突，新摊拒收隔夜菜。\n## 分场剧本\n\n### 场景一\n老板娘：“五十。”\n### 场景二\n唐小满：“三十八。”\n## 识别存疑项\n小洛疑似小六。";
        let range = body_range(text);
        let source = &text[range.clone()];
        assert!(source.starts_with("### 场景一"));
        assert!(source.ends_with("唐小满：“三十八。”"));
        assert!(!source.contains("隔夜菜"));
        let split = source.find("### 场景二").unwrap();
        let mut episodes = vec![
            json!({"startOffset":0,"endOffset":source[..split].chars().count()}),
            json!({"startOffset":source[..split].chars().count(),"endOffset":source.chars().count()}),
        ];
        restore_episode_offsets(&mut episodes, &text[..range.start]);
        super::super::script_offsets::episode_offsets_to_utf16(text, &mut episodes);
        let utf16 = text.encode_utf16().collect::<Vec<_>>();
        let first = String::from_utf16(
            &utf16[episodes[0]["startOffset"].as_u64().unwrap() as usize
                ..episodes[0]["endOffset"].as_u64().unwrap() as usize],
        )
        .unwrap();
        assert_eq!(first, &source[..split]);
        assert_eq!(episodes[0]["endOffset"], episodes[1]["startOffset"]);
    }

    #[test]
    fn existing_episode_slices_drop_metadata_without_changing_identity() {
        let body = prepare_parse_body(json!({"text":"## 剧情梗概\n全剧结局\n## 分场剧本\n甲：“你好😀。”", "episodePlan":[{"id":"ep1","startOffset":0,"endOffset":99}]})).unwrap();
        assert_eq!(body["text"], "甲：“你好😀。”");
        assert_eq!(body["episodePlan"][0]["id"], "ep1");
        assert_eq!(
            body["episodePlan"][0]["endOffset"],
            "甲：“你好😀。”".encode_utf16().count()
        );
        let last =
            prepare_parse_body(json!({"text":"乙：“再见。”\n## 识别存疑项\n姓名存疑"})).unwrap();
        assert_eq!(last["text"], "乙：“再见。”");
    }

    #[test]
    fn unstructured_scripts_and_explainers_are_preserved() {
        for text in [
            "甲：你好\n乙：再见",
            "# 第一章\n这是正文里的剧情梗概一词。",
            "## 剧情梗概\n只有梗概也可以直接创作。",
            "```\n## 正文\n```\n故事继续",
        ] {
            assert_eq!(&text[body_range(text)], text);
        }
        assert!(prepare_parse_body(json!({"text":"## 正文\n\n## 识别存疑项\n备注"})).is_err());
        let explainer = json!({"text":"## 正文\n原理\n## 识别存疑项\n备注","scriptParseMode":"origin_explainer"});
        assert_eq!(prepare_parse_body(explainer.clone()).unwrap(), explainer);
    }
}
