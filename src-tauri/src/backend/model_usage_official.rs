use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_official_price_cases() {
        let cases: Value =
            serde_json::from_str(include_str!("../../../shared/openai-pricing-cases.json"))
                .unwrap();
        for entry in cases.as_array().unwrap() {
            let result = estimate(
                entry["model"].as_str().unwrap(),
                entry["operation"].as_str().unwrap_or("generateText"),
                entry,
            );
            assert_eq!(
                result.map(|v| v.0),
                entry["expected"].as_i64(),
                "case: {entry}"
            );
        }
    }
}

pub(super) fn estimate(model: &str, operation: &str, usage: &Value) -> Option<(i64, Value)> {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../shared/openai-pricing.json"))
            .expect("official pricing catalog")
    });
    let image = operation == "generateImage";
    if !image && operation != "generateText" {
        return None;
    }
    let models = catalog[if image { "image" } else { "text" }].as_object()?;
    let normalized = normalize_model_id_for_remote(model);
    let (id, rules) = models.iter().find(|(id, _)| {
        normalized == **id
            || normalized.strip_prefix(id.as_str()).is_some_and(|suffix| {
                suffix.len() == 11
                    && suffix.starts_with('-')
                    && chrono::NaiveDate::parse_from_str(&suffix[1..], "%Y-%m-%d").is_ok()
            })
    })?;
    let input = usage["inputTokens"].as_i64().filter(|v| *v >= 0)?;
    let output = usage["outputTokens"].as_i64().filter(|v| *v >= 0)?;
    let cached = usage["cachedTokens"].as_i64().unwrap_or(0);
    if cached < 0 || cached > input || usage["cacheWriteTokens"].as_i64().unwrap_or(0) > 0 {
        return None;
    }
    let tier = match usage["serviceTier"].as_str().unwrap_or("default") {
        "priority" => "fast",
        tier => tier,
    };
    let long = input > 272_000 && !rules["default"]["long"].is_null();
    let selected = &rules[tier][if long { "long" } else { "short" }];
    let rates = selected.as_array()?;
    let a = rates.first()?.as_i64()? as i128;
    let b = rates.get(1)?.as_i64();
    let c = rates.get(2)?.as_i64()? as i128;
    let base = if image {
        let text = usage["textInputTokens"].as_i64().filter(|v| *v >= 0)?;
        let im = usage["imageInputTokens"].as_i64().filter(|v| *v >= 0)?;
        if text.checked_add(im) != Some(input)
            || cached != 0
            || usage["textOutputTokens"].as_i64().unwrap_or(0) != 0
        {
            return None;
        }
        text as i128 * a + im as i128 * rates.get(3)?.as_i64()? as i128 + output as i128 * c
    } else {
        if cached > 0 && b.is_none() {
            return None;
        }
        (input - cached) as i128 * a + cached as i128 * b.unwrap_or(0) as i128 + output as i128 * c
    };
    let cost = (base + 500) / 1000;
    if cost > 9_007_199_254_740_991 {
        return None;
    }
    Some((
        cost as i64,
        json!({"version":catalog["version"],"source":catalog["source"],"basis":"official-reference","model":id,"serviceTier":tier,"context":if long {"long"}else{"short"},"ratesMicroUsdPerMillion":selected}),
    ))
}
