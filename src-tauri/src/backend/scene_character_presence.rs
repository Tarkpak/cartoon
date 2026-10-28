use std::sync::LazyLock;

// Keep in sync with app/lib/scene-character-presence.ts. These are conservative
// exclusions: names absent from the description are still eligible references.
pub(super) fn only_mentioned_offscreen(description: &str, name: &str) -> bool {
    static NONVISUAL: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(
        r#"'[^'\n]*'|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』|[（(](?:[^）)\n]*(?:心理|心想|心声|内心|独白|暗想|盘算)[^）)\n]*|\s*\*\*[^）)\n]*[：:][^）)\n]*)[）)]|(?:【(?:台词|对白|对话|心理活动|内心独白|旁白|画外音)】|(?:台词|对白|对话|心理活动|内心独白|旁白|画外音)\s*[：:])[^\n]*"#
    ).expect("valid scene nonvisual pattern"));
    let text = description.split("[引用资产]").next().unwrap_or_default();
    let name = name.trim();
    if name.is_empty() { return false; }
    let ranges: Vec<_> = NONVISUAL.find_iter(text).map(|m| {
        let value = m.as_str();
        let dialogue = ["台词", "对白", "对话"].iter()
            .any(|label| value.trim_start_matches('【').starts_with(label));
        let offset = if dialogue {
            value.char_indices().find(|(_, c)| matches!(c, ':' | '：'))
                .map(|(index, c)| index + c.len_utf8()).unwrap_or(0)
        } else { 0 };
        (m.start() + offset, m.end())
    }).collect();
    let mut found = false;
    for (index, _) in text.match_indices(name) {
        found = true;
        if !ranges.iter().any(|(start, end)| index >= *start && index + name.len() <= *end) {
            return false;
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::only_mentioned_offscreen;
    #[test]
    fn separates_speech_and_thoughts_from_visual_actions() {
        let description = "张建军笑了（**算盘打得深：郑学军会来送枪**）\n【台词】张建军（笃定）：郑学军会主动送过来。\n[引用资产]\n@郑学军";
        assert!(only_mentioned_offscreen(description, "郑学军"));
        assert!(!only_mentioned_offscreen(description, "张建军"));
        assert!(!only_mentioned_offscreen("【台词】张建军：郑学军会来。\n闪回画面：郑学军走进来。", "郑学军"));
        assert!(only_mentioned_offscreen("【画外音】郑学军：张建军还在等。", "郑学军"));
        assert!(!only_mentioned_offscreen("矿场大门。", "郑学军"));
    }
}
