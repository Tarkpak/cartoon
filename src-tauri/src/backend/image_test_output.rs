use super::*;
use std::io::Cursor;

// Keep the requested final dimensions separate from the model's alignment rules.
pub(super) fn image_test_pixel_size_plan(size: &str) -> Result<(String, Option<String>), String> {
    if size == "auto" {
        return Ok((size.to_string(), None));
    }
    let (w, h) = parse_image_dimensions(size).ok_or("请输入有效的像素尺寸，例如 1920x1080")?;
    let pixels = u64::from(w) * u64::from(h);
    if w.max(h) > 3840
        || u64::from(w.max(h)) > u64::from(w.min(h)) * 3
        || !(655_360..=8_294_400).contains(&pixels)
    {
        return Err(
            "尺寸需为正整数，长短边比不超过 3:1，最长边不超过 3840，总像素在 655360–8294400 之间"
                .into(),
        );
    }
    let mut model_w = w.div_ceil(16) * 16;
    let mut model_h = h.div_ceil(16) * 16;
    if u64::from(model_w) * u64::from(model_h) > 8_294_400 {
        model_w = w / 16 * 16;
        model_h = h / 16 * 16;
    }
    let generation = format!("{model_w}x{model_h}");
    validate_image_test_size(&generation, "gpt-image-2")?;
    let output = (model_w != w || model_h != h).then(|| format!("{w}x{h}"));
    Ok((generation, output))
}

pub(super) fn resolve_model_test_image_sizes(
    body: &Value,
    model: &str,
    provider: &str,
) -> Result<(String, Option<String>), String> {
    let size = resolve_model_test_image_size(body, model, provider)?;
    let supports_custom = matches!(provider, "openai" | "custom_openai")
        && normalize_model_id_for_remote(model)
            .to_ascii_lowercase()
            .starts_with("gpt-image-2");
    if !supports_custom {
        if body.get("imageOutputSize").is_some() {
            return Err("当前模型不支持自定义输出尺寸".into());
        }
        return Ok((size, None));
    }
    if let Some(target) = body.get("imageOutputSize") {
        let target = target
            .as_str()
            .ok_or("imageOutputSize 必须是字符串")?
            .replace(['*', '×'], "x")
            .replace(char::is_whitespace, "")
            .to_ascii_lowercase();
        let plan = image_test_pixel_size_plan(&target)?;
        if size != plan.0 {
            return Err("生成尺寸与输出尺寸不匹配，请重新选择尺寸".into());
        }
        return Ok(plan);
    }
    image_test_pixel_size_plan(&size)
}

fn crop_image_test_bytes(
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    format: &str,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let image = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("无法识别生成图片格式: {e}"))?
        .decode()
        .map_err(|e| format!("解码生成图片失败: {e}"))?;
    let output = image.resize_to_fill(width, height, image::imageops::FilterType::Lanczos3);
    let mut encoded = Cursor::new(Vec::new());
    match format {
        "jpeg" => image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, quality.max(1))
            .encode_image(&output.to_rgb8())
            .map_err(|e| format!("保存 JPEG 失败: {e}"))?,
        "webp" => output
            .write_to(&mut encoded, image::ImageFormat::WebP)
            .map_err(|e| format!("保存 WebP 失败: {e}"))?,
        _ => output
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|e| format!("保存 PNG 失败: {e}"))?,
    }
    Ok(encoded.into_inner())
}

pub(super) async fn persist_image_test_exact_output(
    state: &BackendState,
    source: &str,
    mime: Option<&str>,
    target: &str,
    format: &str,
    quality: u8,
) -> Result<String, ApiError> {
    let (width, height) = parse_image_dimensions(target)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "输出尺寸无效"))?;
    let data_url;
    let source =
        if is_http_url(source) || source.starts_with("data:") || source.starts_with("/api/") {
            source
        } else {
            data_url = format!("data:{};base64,{}", mime.unwrap_or("image/png"), source);
            &data_url
        };
    let (bytes, _) = resolve_source_bytes(state, source, 50 * 1024 * 1024).await?;
    let encoding = format.to_string();
    let bytes = tokio::task::spawn_blocking(move || {
        crop_image_test_bytes(bytes, width, height, &encoding, quality)
    })
    .await
    .map_err(|e| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("图片尺寸适配失败: {e}"),
        )
    })?
    .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, e))?;
    persist_image_bytes_async(
        state,
        "model_test_image",
        Some(&format!("image/{format}")),
        format,
        bytes,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn common_sizes_preserve_the_requested_output() {
        for (target, generation) in [
            ("1920x1080", "1920x1088"),
            ("1080x1920", "1088x1920"),
            ("2881x2879", "2880x2864"),
        ] {
            let plan = image_test_pixel_size_plan(target).unwrap();
            assert_eq!(plan, (generation.into(), Some(target.into())));
            assert_eq!(
                resolve_model_test_image_sizes(
                    &json!({"imageSize":target}),
                    "gpt-image-2",
                    "openai"
                )
                .unwrap(),
                plan
            );
            assert_eq!(
                resolve_model_test_image_sizes(
                    &json!({"imageSize":generation,"imageOutputSize":target}),
                    "gpt-image-2",
                    "openai"
                )
                .unwrap(),
                plan
            );
        }
        assert_eq!(
            image_test_pixel_size_plan("2048x1152").unwrap(),
            ("2048x1152".into(), None)
        );
        for bad in ["0x1080", "4096x2160", "2048x512", "16x16"] {
            assert!(image_test_pixel_size_plan(bad).is_err());
        }
        assert!(resolve_model_test_image_sizes(
            &json!({"imageSize":"2048x1152","imageOutputSize":"1920x1080"}),
            "gpt-image-2",
            "openai"
        )
        .is_err());
    }
    #[test]
    fn crops_to_exact_1080p_and_keeps_transparency() {
        let source =
            image::RgbaImage::from_fn(1920, 1088, |_, y| image::Rgba([0, (y % 256) as u8, 0, 80]));
        let mut encoded = Cursor::new(Vec::new());
        source
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let result = crop_image_test_bytes(encoded.into_inner(), 1920, 1080, "png", 100).unwrap();
        let output = image::load_from_memory(&result).unwrap().to_rgba8();
        assert_eq!(output.dimensions(), (1920, 1080));
        assert_eq!(output.get_pixel(0, 0).0, [0, 4, 0, 80]);
    }
    #[test]
    fn preserves_output_format_and_rejects_invalid_images() {
        let source = image::RgbaImage::new(32, 32);
        let mut encoded = Cursor::new(Vec::new());
        source
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        for format in ["jpeg", "webp"] {
            let bytes =
                crop_image_test_bytes(encoded.get_ref().clone(), 31, 29, format, 85).unwrap();
            let output = image::load_from_memory(&bytes).unwrap();
            assert_eq!((output.width(), output.height()), (31, 29));
            assert_eq!(
                image::guess_format(&bytes).unwrap(),
                if format == "jpeg" {
                    image::ImageFormat::Jpeg
                } else {
                    image::ImageFormat::WebP
                }
            );
        }
        assert!(crop_image_test_bytes(vec![1, 2, 3], 32, 32, "png", 100).is_err());
    }
}
