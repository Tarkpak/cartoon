//! Conservative provider-independent input guard. This is a byte upper bound,
//! not an exact tokenizer; custom providers may expose smaller context windows.
pub(super) const INPUT_BUDGET: usize = 48_000;

pub(super) fn check(prompt: &str) -> Result<(), String> {
    check_with_limit(prompt, INPUT_BUDGET)
}

pub(super) fn check_with_limit(prompt: &str, limit: usize) -> Result<(), String> {
    if prompt.len() > limit {
        return Err(format!(
            "完整提示词超过安全输入预算（{} / {} 字节），请减少自定义提示词或人物资料后重试；原文未被截断",
            prompt.len(), limit
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budgets_utf8_bytes_instead_of_character_count() {
        assert!(check(&"a".repeat(INPUT_BUDGET)).is_ok());
        assert!(check(&"中".repeat(INPUT_BUDGET / 3 + 1)).is_err());
    }
}
