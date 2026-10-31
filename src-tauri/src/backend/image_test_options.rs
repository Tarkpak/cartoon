use super::*;

pub(super) struct ImageTestOutput {
    pub images: Vec<(String, Option<String>)>,
    pub previews: Vec<(String, Option<String>)>,
}

impl ImageTestOutput {
    pub fn single(image: (String, Option<String>)) -> Self {
        Self {
            images: vec![image],
            previews: vec![],
        }
    }
}

pub(super) fn parse_image_test_output(payload: &Value, format: &str) -> Option<ImageTestOutput> {
    let mime = format!("image/{format}");
    let parse = |item: &Value| {
        parse_openai_compatible_image_result(item)
            .map(|(source, item_mime)| (source, item_mime.map(|_| mime.clone())))
    };
    let mut images = Vec::new();
    let data = payload.get("data");
    let items = data.and_then(Value::as_array).or_else(|| {
        data.and_then(|data| data.get("result"))
            .and_then(|result| result.get("images"))
            .and_then(Value::as_array)
    });
    if let Some(items) = items {
        images.extend(items.iter().filter_map(parse));
    }
    if images.is_empty() {
        images.push(parse(payload)?);
    }
    let previews = payload
        .get("previews")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(parse).collect())
        .unwrap_or_default();
    Some(ImageTestOutput { images, previews })
}

pub(super) fn validate_image_test_options(
    options: &Value,
    model: &str,
    references: usize,
) -> Result<(), String> {
    let map = options.as_object().ok_or("imageOptions 必须是对象")?;
    for (key, value) in map {
        let valid = match key.as_str() {
            "background" => matches!(value.as_str(), Some("auto" | "opaque" | "transparent")),
            "output_format" => matches!(value.as_str(), Some("png" | "jpeg" | "webp")),
            "moderation" => matches!(value.as_str(), Some("auto" | "low")),
            "n" => value.as_u64().is_some_and(|n| (1..=10).contains(&n)),
            "output_compression" => value.as_u64().is_some_and(|n| n <= 100),
            "partial_images" => value.as_u64().is_some_and(|n| n <= 3),
            "stream" => value.is_boolean(),
            "input_fidelity" => {
                references > 0
                    && match value.as_str() {
                        Some("low") => {
                            model.starts_with("gpt-image-1.5")
                                || model.starts_with("gpt-image-1-mini")
                        }
                        Some("high") => model.starts_with("gpt-image-1.5"),
                        _ => false,
                    }
            }
            "mask" | "markup" => {
                references > 0
                    && value.as_str().is_some_and(|s| {
                        s.starts_with("data:image/png;base64,") && s.len() <= 5_600_000
                    })
                    && (key == "mask"
                        || model.starts_with("gpt-image-2.5")
                        || model.starts_with("gpt-image-2.6"))
            }
            _ => false,
        };
        if !valid {
            return Err(format!("图片参数 {key} 无效或当前模型不支持"));
        }
    }
    if options.get("mask").is_some() && options.get("markup").is_some() {
        return Err("蒙版与标注图不能同时使用".into());
    }
    if options["background"] == "transparent" && options["output_format"] == "jpeg" {
        return Err("透明背景不支持 JPEG，请选择 PNG 或 WebP".into());
    }
    if options.get("output_compression").is_some()
        && options
            .get("output_format")
            .and_then(Value::as_str)
            .unwrap_or("png")
            == "png"
    {
        return Err("PNG 不支持 output_compression，请选择 JPEG 或 WebP".into());
    }
    if options.get("partial_images").is_some() && options["stream"] != true {
        return Err("中间预览需要启用流式响应".into());
    }
    Ok(())
}

pub(super) fn validate_image_test_size(size: &str, model: &str) -> Result<(), String> {
    if size == "auto" {
        return Ok(());
    }
    let (w, h) = parse_image_dimensions(size).ok_or("请输入有效的像素尺寸，例如 1536x864")?;
    if !model.starts_with("gpt-image-2") {
        return if matches!((w, h), (1024, 1024) | (1536, 1024) | (1024, 1536)) {
            Ok(())
        } else {
            Err("当前模型仅支持标准尺寸或自动尺寸".into())
        };
    }
    let pixels = u64::from(w) * u64::from(h);
    if w == 0
        || h == 0
        || w % 16 != 0
        || h % 16 != 0
        || w.max(h) > 3840
        || u64::from(w.max(h)) > u64::from(w.min(h)) * 3
        || !(655_360..=8_294_400).contains(&pixels)
    {
        return Err("尺寸需为 16 的倍数，长短边比不超过 3:1，最长边不超过 3840，总像素需在 655360–8294400 之间".into());
    }
    Ok(())
}

pub(super) fn image_test_output_aspect_ratio(size: &str, fallback: &str) -> String {
    if size == "auto" {
        return "auto".into();
    }
    if let Some((w, h)) = parse_image_dimensions(size) {
        let divisor = gcd_u32(w, h);
        return format!("{}:{}", w / divisor, h / divisor);
    }
    fallback.to_string()
}

pub(super) fn build_gemini_image_request(
    imagen: bool,
    prompt: &str,
    parts: Vec<Value>,
    image_size: Option<&str>,
    aspect_ratio: Option<&str>,
) -> Value {
    let ratio = aspect_ratio.filter(|ratio| !ratio.is_empty() && *ratio != "auto");
    if imagen {
        let mut body = json!({"instances": [{"prompt": prompt}], "parameters": {"sampleCount": 1}});
        if let Some(ratio) = ratio {
            body["parameters"]["aspectRatio"] = json!(ratio);
        }
        if let Some(size) = image_size {
            body["parameters"]["sampleImageSize"] = json!(size);
        }
        return body;
    }
    let mut body = json!({"contents": [{"role":"user", "parts":parts}], "generationConfig":{"responseModalities":["TEXT", "IMAGE"]}});
    if let Some(ratio) = ratio {
        body["generationConfig"]["imageConfig"]["aspectRatio"] = json!(ratio);
    }
    if let Some(size) = image_size {
        body["generationConfig"]["imageConfig"]["imageSize"] = json!(size);
    }
    body
}

// Normalize both JSON and SSE image responses. Keep previews separate from final images.
pub(super) fn parse_image_test_response(body: &str, streaming: bool) -> Result<Value, String> {
    if !streaming {
        return serde_json::from_str(body).map_err(|e| format!("解析图片响应失败: {e}"));
    }
    if body.trim_start().starts_with('{') {
        let payload: Value =
            serde_json::from_str(body).map_err(|e| format!("解析图片响应失败: {e}"))?;
        if let Some(error) = payload.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("图片接口返回错误")
                .into());
        }
        return Ok(payload);
    }
    let mut images = vec![];
    let mut previews = vec![];
    let normalized = body.replace("\r\n", "\n");
    for frame in normalized.split("\n\n") {
        let data = frame
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data.trim() == "[DONE]" {
            continue;
        }
        let event: Value =
            serde_json::from_str(&data).map_err(|e| format!("解析图片流失败: {e}"))?;
        let kind = event["type"].as_str().unwrap_or("");
        if kind == "error" || event.get("error").is_some() {
            return Err(event["error"]["message"]
                .as_str()
                .or(event["message"].as_str())
                .unwrap_or("图片流返回错误")
                .into());
        }
        if kind.ends_with("partial_image") {
            if let Some(b64) = event.get("b64_json").or(event.get("partial_image_b64")) {
                previews.push(json!({"b64_json": b64}));
            }
        } else if kind.ends_with("completed") {
            if let Some(b64) = event.get("b64_json") {
                images.push(json!({"b64_json": b64}));
            }
            if let Some(data) = event["data"].as_array() {
                images.extend(data.iter().cloned());
            }
        }
    }
    if images.is_empty() {
        return Err("图片流未返回完整图片".into());
    }
    Ok(json!({"data": images, "previews": previews}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_native_provider_size_formats() {
        for (provider, model, size) in [
            ("qwen", "qwen-image", "1328*1328"),
            ("qwen", "wan2.7-image", "2K"),
            ("volcengine", "seedream", "2048*2048"),
        ] {
            assert_eq!(
                resolve_model_test_image_size(&json!({"imageSize":size}), model, provider).unwrap(),
                size
            );
        }
    }

    #[test]
    fn gemini_and_imagen_receive_the_selected_ratio() {
        let request = build_gemini_image_request(
            false,
            "prompt",
            vec![json!({"text":"prompt"})],
            Some("2K"),
            Some("16:9"),
        );
        assert_eq!(
            request["generationConfig"]["imageConfig"],
            json!({"aspectRatio":"16:9", "imageSize":"2K"})
        );
        assert!(request["generationConfig"].get("image_size").is_none());
        let automatic = build_gemini_image_request(false, "prompt", vec![], None, Some("auto"));
        assert!(automatic["generationConfig"].get("imageConfig").is_none());
        let imagen = build_gemini_image_request(true, "prompt", vec![], None, Some("9:16"));
        assert_eq!(imagen["instances"][0]["prompt"], "prompt");
        assert_eq!(
            imagen["parameters"],
            json!({"aspectRatio":"9:16", "sampleCount":1})
        );
        assert!(imagen.get("contents").is_none());
        let response =
            json!({"predictions":[{"bytesBase64Encoded":"image", "mimeType":"image/jpeg"}]});
        assert_eq!(
            parse_gemini_image_result(&response),
            Some(("image".into(), Some("image/jpeg".into())))
        );
    }

    #[test]
    fn output_ratio_matches_explicit_dimensions() {
        assert_eq!(image_test_output_aspect_ratio("1536x864", "1:1"), "16:9");
        assert_eq!(image_test_output_aspect_ratio("auto", "1:1"), "auto");
    }

    #[test]
    fn streaming_handles_multiline_events_and_json_compatible_services() {
        let body = "data: {\r\ndata: \"type\":\"image_generation.completed\",\r\ndata: \"b64_json\":\"final\"}\r\n\r\n";
        assert_eq!(
            parse_image_test_response(body, true).unwrap()["data"][0]["b64_json"],
            "final"
        );
        let json_body = "{\"data\":[{\"b64_json\":\"final\"}]}";
        assert_eq!(
            parse_image_test_response(json_body, true).unwrap()["data"][0]["b64_json"],
            "final"
        );
        assert!(
            parse_image_test_response("{\"error\":{\"message\":\"unsupported\"}}", true)
                .unwrap_err()
                .contains("unsupported")
        );
        assert!(
            validate_image_test_options(&json!({"output_compression":100}), "gpt-image-2", 0)
                .is_err()
        );
    }

    #[test]
    fn validates_model_specific_options() {
        assert!(validate_image_test_options(
            &json!({"n": 2, "output_format": "webp", "background": "transparent"}),
            "gpt-image-2",
            0
        )
        .is_ok());
        for options in [
            json!({"n": 0}),
            json!({"n": 1.5}),
            json!({"input_fidelity": "high"}),
            json!({"background":"transparent", "output_format":"jpeg"}),
            json!({"partial_images":1}),
        ] {
            assert!(validate_image_test_options(&options, "gpt-image-2", 0).is_err());
        }
        assert!(
            validate_image_test_options(&json!({"input_fidelity":"high"}), "gpt-image-1.5", 1)
                .is_ok()
        );
        assert!(validate_image_test_options(
            &json!({"input_fidelity":"high"}),
            "gpt-image-1-mini",
            1
        )
        .is_err());
    }
    #[test]
    fn preserves_all_images_and_the_output_mime() {
        let payload = json!({"data": [{"b64_json": "one"}, {"b64_json": "two"}], "previews": [{"b64_json": "preview"}]});
        let result = parse_image_test_output(&payload, "webp").unwrap();
        assert_eq!(result.images.len(), 2);
        assert_eq!(result.images[1].0, "two");
        assert_eq!(result.images[1].1.as_deref(), Some("image/webp"));
        assert_eq!(result.previews.len(), 1);
        let async_payload = json!({"data": {"result": {"images": [{"url": "https://example.com/1"}, {"url": "https://example.com/2"}]}}});
        assert_eq!(
            parse_image_test_output(&async_payload, "png")
                .unwrap()
                .images
                .len(),
            2
        );
    }

    #[test]
    fn auto_and_explicit_sizes_override_resolution() {
        assert_eq!(
            resolve_model_test_image_size(
                &json!({"imageAspectRatio":"auto", "imageResolution":"4K"}),
                "gpt-image-2",
                "openai"
            )
            .unwrap(),
            "auto"
        );
        assert_eq!(
            resolve_model_test_image_size(
                &json!({"imageSize":"1536×864", "imageResolution":"4K"}),
                "gpt-image-2",
                "openai"
            )
            .unwrap(),
            "1536x864"
        );
    }

    #[test]
    fn validates_sizes() {
        assert!(validate_image_test_size("1536x864", "gpt-image-2").is_ok());
        assert!(validate_image_test_size("auto", "gpt-image-1.5").is_ok());
        for size in ["0x1024", "1537x864", "4096x2048", "2048x512", "16x16"] {
            assert!(validate_image_test_size(size, "gpt-image-2").is_err());
        }
        assert!(validate_image_test_size("1536x864", "gpt-image-1.5").is_err());
    }
    #[test]
    fn parses_stream_and_does_not_treat_preview_as_final() {
        let result = parse_image_test_response("data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"preview\"}\n\ndata: {\"type\":\"image_generation.completed\",\"b64_json\":\"final\"}\n", true).unwrap();
        assert_eq!(result["data"][0]["b64_json"], "final");
        assert_eq!(result["previews"][0]["b64_json"], "preview");
        assert!(parse_image_test_response(
            "data: {\"type\":\"error\",\"message\":\"failed\"}\n",
            true
        )
        .is_err());
        assert!(parse_image_test_response("data: [DONE]\n", true).is_err());
    }
}
