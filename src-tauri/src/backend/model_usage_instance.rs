use super::*;

pub(super) fn instance(provider: &str, creds: &Value) -> Value {
    let entry = if provider == "custom_openai" {
        custom_openai_provider_entries(&creds["custom_openai"])
            .into_iter()
            .next()
            .unwrap_or(Value::Null)
    } else {
        creds[provider].clone()
    };
    // Identity must remain stable while credentials or the enabled flag change.
    let base = if provider == "custom_openai" {
        entry["baseUrl"]
            .as_str()
            .and_then(normalize_provider_base_url)
    } else {
        provider_sync_base_url(provider, creds)
    }
    .unwrap_or_default();
    // Hash endpoint identity, never include credentials, queries or fragments in public telemetry.
    let endpoint = url::Url::parse(&base)
        .ok()
        .map(|mut u| {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.set_query(None);
            u.set_fragment(None);
            u.to_string().trim_end_matches('/').to_string()
        })
        .unwrap_or_default();
    let digest = hex::encode(Sha256::digest(endpoint.as_bytes()));
    let id = entry["id"].as_str().unwrap_or(provider);
    let label = match provider { "openai" => "OpenAI", "qwen" => "通义千问", "deepseek" => "DeepSeek", "volcengine" => "火山引擎", _ => "自定义供应商" };
    json!({"id":format!("{provider}:{id}:{}",&digest[..16]),"label":entry["displayName"].as_str().unwrap_or(label),"provider":provider})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_changes_with_route_without_exposing_secrets() {
        let mut entry = json!({"id":"a","displayName":"代理 A","baseUrl":"https://user:secret@example.com/v1?key=secret","apiKey":"secret"});
        let first = instance("custom_openai", &wrap_custom_openai_creds(&entry));
        entry["enabled"] = json!(true);
        entry["apiKey"] = json!("rotated-key");
        assert_eq!(
            first["id"],
            instance("custom_openai", &wrap_custom_openai_creds(&entry))["id"]
        );
        entry["enabled"] = json!(false);
        entry["apiKey"] = json!("");
        assert_eq!(
            first["id"],
            instance("custom_openai", &wrap_custom_openai_creds(&entry))["id"]
        );
        entry["baseUrl"] = json!("https://another.example.com/v1");
        let second = instance("custom_openai", &wrap_custom_openai_creds(&entry));
        assert_ne!(first["id"], second["id"]);
        assert!(!first.to_string().contains("secret"));
    }
}
