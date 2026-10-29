use serde_json::{json, Value};

/// Internal planning counts Unicode scalars; browser String.slice uses UTF-16 units.
/// Convert only at the API boundary, after all chunk offsets have been merged.
pub(super) fn episode_offsets_to_utf16(text: &str, episodes: &mut [Value]) {
    let mut offsets = vec![0usize];
    for character in text.chars() {
        offsets.push(offsets.last().copied().unwrap() + character.len_utf16());
    }
    for episode in episodes {
        for key in ["startOffset", "endOffset"] {
            if let Some(index) = episode.get(key).and_then(Value::as_u64) {
                if let Some(offset) = offsets.get(index as usize) {
                    episode[key] = json!(offset);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_supplementary_characters_and_keeps_adjacent_boundaries() {
        let mut episodes = vec![
            json!({"startOffset":0,"endOffset":4}),
            json!({"startOffset":4,"endOffset":7}),
        ];
        episode_offsets_to_utf16("甲😀乙\n𠮷丙丁", &mut episodes);
        assert_eq!(
            episodes,
            vec![
                json!({"startOffset":0,"endOffset":5}),
                json!({"startOffset":5,"endOffset":9})
            ]
        );
    }

    #[test]
    fn keeps_bmp_text_and_empty_input_unchanged() {
        let mut episodes = vec![json!({"startOffset":0,"endOffset":3})];
        episode_offsets_to_utf16("甲\n乙", &mut episodes);
        assert_eq!(episodes[0], json!({"startOffset":0,"endOffset":3}));
        episode_offsets_to_utf16("", &mut []);
    }
}
