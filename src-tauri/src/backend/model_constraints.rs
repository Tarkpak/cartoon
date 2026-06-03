use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::OnceLock;

const MODEL_CONSTRAINTS_REGISTRY_JSON: &str =
    include_str!("../../assets/model-constraints.registry.json");

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum AvailableModelKind {
    Text,
    Image,
    ThreeD,
    Video,
    VoiceTts,
    VoiceAsr,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConstraintRegistry {
    defaults: RegistryDefaults,
    rules: Vec<ModelConstraintRule>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryDefaults {
    text: Option<TextConstraint>,
    image: Option<ImageConstraint>,
    video: Option<VideoConstraint>,
    #[serde(rename = "threeD")]
    three_d: Option<ThreeDConstraint>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConstraintRule {
    provider: Option<String>,
    model_kind: String,
    display_name: Option<String>,
    description: Option<String>,
    doc_url: Option<String>,
    #[serde(rename = "match")]
    matcher: ModelMatchRule,
    text: Option<TextConstraint>,
    image: Option<ImageConstraint>,
    video: Option<VideoConstraint>,
    voice: Option<VoiceConstraint>,
    #[serde(rename = "threeD")]
    three_d: Option<ThreeDConstraint>,
    capabilities: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMatchRule {
    #[serde(rename = "type")]
    matcher_type: String,
    value: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextConstraint {
    support_thinking: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageConstraint {
    supported_sizes: Option<Vec<String>>,
    size_selection_mode: Option<String>,
    size_constraints: Option<Value>,
    supported_aspect_ratios: Option<Vec<String>>,
    supported_qualities: Option<Vec<String>>,
    support_text_to_image: Option<bool>,
    support_image_to_image: Option<bool>,
    support_reference_image: Option<bool>,
    support_reference_images: Option<bool>,
    require_reference_image: Option<bool>,
    max_reference_images: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoConstraint {
    support_first_last_frame: Option<bool>,
    support_image_to_video: Option<bool>,
    support_text_to_video: Option<bool>,
    support_reference_images: Option<bool>,
    max_reference_images: Option<u32>,
    support_video_reference: Option<bool>,
    max_reference_videos: Option<u32>,
    support_audio_reference: Option<bool>,
    max_reference_audios: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreeDConstraint {
    support_text_to_3d: Option<bool>,
    support_image_to_3d: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceConstraint {
    #[serde(rename = "type")]
    voice_type: Option<String>,
}

fn model_registry() -> &'static ModelConstraintRegistry {
    static REGISTRY: OnceLock<ModelConstraintRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str::<ModelConstraintRegistry>(MODEL_CONSTRAINTS_REGISTRY_JSON)
            .unwrap_or_else(|error| {
                eprintln!(
                    "[RustBackend] 解析模型约束注册表失败 (model-constraints.registry.json): {}",
                    error
                );
                fallback_registry()
            })
    })
}

fn fallback_registry() -> ModelConstraintRegistry {
    ModelConstraintRegistry {
        defaults: RegistryDefaults {
            text: Some(TextConstraint {
                support_thinking: Some(false),
            }),
            image: Some(ImageConstraint {
                supported_sizes: None,
                size_selection_mode: None,
                size_constraints: None,
                supported_aspect_ratios: Some(vec![
                    "1:1".to_string(),
                    "16:9".to_string(),
                    "9:16".to_string(),
                ]),
                supported_qualities: Some(vec![
                    "auto".to_string(),
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                ]),
                support_text_to_image: Some(true),
                support_image_to_image: Some(false),
                support_reference_image: Some(false),
                support_reference_images: Some(false),
                require_reference_image: Some(false),
                max_reference_images: Some(1),
            }),
            video: Some(VideoConstraint {
                support_first_last_frame: Some(false),
                support_image_to_video: Some(false),
                support_text_to_video: Some(true),
                support_reference_images: Some(false),
                max_reference_images: Some(1),
                support_video_reference: Some(false),
                max_reference_videos: Some(1),
                support_audio_reference: Some(false),
                max_reference_audios: Some(1),
            }),
            three_d: Some(ThreeDConstraint {
                support_text_to_3d: Some(true),
                support_image_to_3d: Some(false),
            }),
        },
        rules: Vec::new(),
    }
}

fn resolve_rule<'a>(
    registry: &'a ModelConstraintRegistry,
    provider: &str,
    normalized_model_id: &str,
) -> Option<&'a ModelConstraintRule> {
    registry
        .rules
        .iter()
        .find(|rule| rule_matches(rule, provider, normalized_model_id))
}

fn rule_matches(rule: &ModelConstraintRule, provider: &str, normalized_model_id: &str) -> bool {
    let provider_match = match rule.provider.as_ref().map(|value| value.trim()) {
        Some("*") | Some("") | None => true,
        Some(rule_provider) => rule_provider.eq_ignore_ascii_case(provider),
    };
    if !provider_match {
        return false;
    }

    let rule_value = rule.matcher.value.trim().to_ascii_lowercase();
    if rule_value.is_empty() {
        return false;
    }

    match rule
        .matcher
        .matcher_type
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "exact" => normalized_model_id == rule_value,
        "prefix" => normalized_model_id.starts_with(&rule_value),
        "suffix" => normalized_model_id.ends_with(&rule_value),
        "contains" => normalized_model_id.contains(&rule_value),
        _ => false,
    }
}

fn parse_model_kind(rule: Option<&ModelConstraintRule>) -> AvailableModelKind {
    let raw_kind = rule
        .map(|item| item.model_kind.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "text".to_string());

    match raw_kind.as_str() {
        "image" => AvailableModelKind::Image,
        "video" => AvailableModelKind::Video,
        "three_d" | "three-d" | "threed" | "3d" => AvailableModelKind::ThreeD,
        "voice_asr" | "asr" => AvailableModelKind::VoiceAsr,
        "voice_tts" | "tts" => AvailableModelKind::VoiceTts,
        "voice" => {
            let voice_type = rule
                .and_then(|item| item.voice.as_ref())
                .and_then(|voice| voice.voice_type.as_deref())
                .map(|value| value.trim().to_ascii_lowercase())
                .unwrap_or_else(|| "tts".to_string());
            if voice_type == "asr" {
                AvailableModelKind::VoiceAsr
            } else {
                AvailableModelKind::VoiceTts
            }
        }
        _ => AvailableModelKind::Text,
    }
}

fn normalize_string_list(list: Option<&Vec<String>>) -> Vec<String> {
    let mut values = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let Some(items) = list else {
        return values;
    };

    for item in items {
        let value = item.trim();
        if value.is_empty() {
            continue;
        }
        let owned = value.to_string();
        if seen.insert(owned.clone()) {
            values.push(owned);
        }
    }

    values
}

fn pick_explicit_string_list(preferred: Option<&Vec<String>>) -> Vec<String> {
    normalize_string_list(preferred)
}

fn pick_bool(primary: Option<bool>, fallback: Option<bool>, default_value: bool) -> bool {
    primary.or(fallback).unwrap_or(default_value)
}

fn pick_positive_u32(primary: Option<u32>, fallback: Option<u32>) -> Option<u32> {
    primary
        .or(fallback)
        .and_then(|value| if value > 0 { Some(value) } else { None })
}

fn default_description(kind: AvailableModelKind) -> &'static str {
    match kind {
        AvailableModelKind::Text => "文本模型",
        AvailableModelKind::Image => "图片模型",
        AvailableModelKind::ThreeD => "3D模型",
        AvailableModelKind::Video => "视频模型",
        AvailableModelKind::VoiceTts => "语音合成模型",
        AvailableModelKind::VoiceAsr => "语音识别模型",
    }
}

fn normalize_capabilities(capabilities: Option<&Vec<String>>) -> Option<Vec<String>> {
    let mut values = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let Some(items) = capabilities else {
        return None;
    };

    for item in items {
        let normalized = item.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            values.push(normalized);
        }
    }

    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn insert_optional_string(
    target: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(text) = value.map(str::trim).filter(|item| !item.is_empty()) {
        target.insert(key.to_string(), json!(text));
    }
}

pub(super) fn build_available_model_entry(
    provider: &str,
    model_id: &str,
) -> (AvailableModelKind, Value) {
    let normalized_model_id = model_id.trim().to_ascii_lowercase();
    let registry = model_registry();
    let matched_rule = resolve_rule(registry, provider, &normalized_model_id);
    let kind = parse_model_kind(matched_rule);

    let display_name = matched_rule
        .and_then(|rule| rule.display_name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(model_id)
        .to_string();
    let description = matched_rule
        .and_then(|rule| rule.description.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_description(kind))
        .to_string();
    let doc_url = matched_rule.and_then(|rule| rule.doc_url.as_deref());

    match kind {
        AvailableModelKind::Text => {
            let default_text = registry.defaults.text.as_ref();
            let rule_text = matched_rule.and_then(|rule| rule.text.as_ref());
            let support_thinking = pick_bool(
                rule_text.and_then(|item| item.support_thinking),
                default_text.and_then(|item| item.support_thinking),
                false,
            );

            let capabilities =
                normalize_capabilities(matched_rule.and_then(|rule| rule.capabilities.as_ref()))
                    .unwrap_or_else(|| {
                        let mut values = vec!["text_generation".to_string()];
                        if support_thinking {
                            values.push("thinking".to_string());
                        }
                        values
                    });

            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            object.insert("supportThinking".to_string(), json!(support_thinking));
            object.insert("capabilities".to_string(), json!(capabilities));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
        AvailableModelKind::Image => {
            let default_image = registry.defaults.image.as_ref();
            let rule_image = matched_rule.and_then(|rule| rule.image.as_ref());

            let supported_aspect_ratios = pick_explicit_string_list(
                rule_image.and_then(|item| item.supported_aspect_ratios.as_ref()),
            );
            let supported_sizes = pick_explicit_string_list(
                rule_image.and_then(|item| item.supported_sizes.as_ref()),
            );
            let supported_qualities = pick_explicit_string_list(
                rule_image.and_then(|item| item.supported_qualities.as_ref()),
            );

            let support_text_to_image = pick_bool(
                rule_image.and_then(|item| item.support_text_to_image),
                default_image.and_then(|item| item.support_text_to_image),
                true,
            );
            let support_image_to_image = pick_bool(
                rule_image.and_then(|item| item.support_image_to_image),
                default_image.and_then(|item| item.support_image_to_image),
                false,
            );

            let support_reference_image = pick_bool(
                rule_image.and_then(|item| item.support_reference_image),
                default_image.and_then(|item| item.support_reference_image),
                false,
            ) || support_image_to_image;

            let support_reference_images = pick_bool(
                rule_image.and_then(|item| item.support_reference_images),
                default_image.and_then(|item| item.support_reference_images),
                support_reference_image,
            ) || support_reference_image;

            let require_reference_image = pick_bool(
                rule_image.and_then(|item| item.require_reference_image),
                default_image.and_then(|item| item.require_reference_image),
                false,
            );

            let max_reference_images = if support_reference_images || support_reference_image {
                let max_value = pick_positive_u32(
                    rule_image.and_then(|item| item.max_reference_images),
                    default_image.and_then(|item| item.max_reference_images),
                )
                .unwrap_or(1)
                .min(12);
                Some(max_value)
            } else {
                None
            };

            let capabilities =
                normalize_capabilities(matched_rule.and_then(|rule| rule.capabilities.as_ref()))
                    .unwrap_or_else(|| {
                        let mut values = Vec::new();
                        if support_text_to_image {
                            values.push("text_to_image".to_string());
                        }
                        if support_image_to_image {
                            values.push("image_to_image".to_string());
                        }
                        if support_reference_image
                            || support_reference_images
                            || require_reference_image
                        {
                            values.push("reference_image".to_string());
                        }
                        values
                    });

            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            if !supported_aspect_ratios.is_empty() {
                object.insert(
                    "supportedAspectRatios".to_string(),
                    json!(supported_aspect_ratios),
                );
            }
            if !supported_sizes.is_empty() {
                object.insert("supportedSizes".to_string(), json!(supported_sizes));
            }
            insert_optional_string(
                &mut object,
                "sizeSelectionMode",
                rule_image.and_then(|item| item.size_selection_mode.as_deref()),
            );
            if let Some(size_constraints) =
                rule_image.and_then(|item| item.size_constraints.as_ref())
            {
                object.insert("sizeConstraints".to_string(), size_constraints.clone());
            }
            if !supported_qualities.is_empty() {
                object.insert("supportedQualities".to_string(), json!(supported_qualities));
            }
            object.insert(
                "supportTextToImage".to_string(),
                json!(support_text_to_image),
            );
            object.insert(
                "supportImageToImage".to_string(),
                json!(support_image_to_image),
            );
            object.insert(
                "supportReferenceImage".to_string(),
                json!(support_reference_image),
            );
            object.insert(
                "supportReferenceImages".to_string(),
                json!(support_reference_images),
            );
            object.insert(
                "requireReferenceImage".to_string(),
                json!(require_reference_image),
            );
            if let Some(max_value) = max_reference_images {
                object.insert("maxReferenceImages".to_string(), json!(max_value));
            }
            object.insert("capabilities".to_string(), json!(capabilities));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
        AvailableModelKind::ThreeD => {
            let default_three_d = registry.defaults.three_d.as_ref();
            let rule_three_d = matched_rule.and_then(|rule| rule.three_d.as_ref());
            let support_text_to_3d = pick_bool(
                rule_three_d.and_then(|item| item.support_text_to_3d),
                default_three_d.and_then(|item| item.support_text_to_3d),
                true,
            );
            let support_image_to_3d = pick_bool(
                rule_three_d.and_then(|item| item.support_image_to_3d),
                default_three_d.and_then(|item| item.support_image_to_3d),
                false,
            );

            let capabilities =
                normalize_capabilities(matched_rule.and_then(|rule| rule.capabilities.as_ref()))
                    .unwrap_or_else(|| {
                        let mut values = Vec::new();
                        if support_text_to_3d {
                            values.push("text_to_3d".to_string());
                        }
                        if support_image_to_3d {
                            values.push("image_to_3d".to_string());
                        }
                        values
                    });

            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            object.insert("supportTextTo3D".to_string(), json!(support_text_to_3d));
            object.insert("supportImageTo3D".to_string(), json!(support_image_to_3d));
            object.insert("capabilities".to_string(), json!(capabilities));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
        AvailableModelKind::Video => {
            let default_video = registry.defaults.video.as_ref();
            let rule_video = matched_rule.and_then(|rule| rule.video.as_ref());

            let support_first_last_frame = pick_bool(
                rule_video.and_then(|item| item.support_first_last_frame),
                default_video.and_then(|item| item.support_first_last_frame),
                false,
            );
            let support_image_to_video = pick_bool(
                rule_video.and_then(|item| item.support_image_to_video),
                default_video.and_then(|item| item.support_image_to_video),
                false,
            );
            let support_text_to_video = pick_bool(
                rule_video.and_then(|item| item.support_text_to_video),
                default_video.and_then(|item| item.support_text_to_video),
                true,
            );
            let support_reference_images = pick_bool(
                rule_video.and_then(|item| item.support_reference_images),
                default_video.and_then(|item| item.support_reference_images),
                support_image_to_video,
            );
            let support_audio_reference = pick_bool(
                rule_video.and_then(|item| item.support_audio_reference),
                default_video.and_then(|item| item.support_audio_reference),
                false,
            );
            let support_video_reference = pick_bool(
                rule_video.and_then(|item| item.support_video_reference),
                default_video.and_then(|item| item.support_video_reference),
                false,
            );
            let max_reference_images = if support_reference_images || support_image_to_video {
                Some(
                    pick_positive_u32(
                        rule_video.and_then(|item| item.max_reference_images),
                        default_video.and_then(|item| item.max_reference_images),
                    )
                    .unwrap_or(1)
                    .min(12),
                )
            } else {
                None
            };
            let max_reference_videos = if support_video_reference {
                Some(
                    pick_positive_u32(
                        rule_video.and_then(|item| item.max_reference_videos),
                        default_video.and_then(|item| item.max_reference_videos),
                    )
                    .unwrap_or(1)
                    .min(4),
                )
            } else {
                None
            };
            let max_reference_audios = if support_audio_reference {
                Some(
                    pick_positive_u32(
                        rule_video.and_then(|item| item.max_reference_audios),
                        default_video.and_then(|item| item.max_reference_audios),
                    )
                    .unwrap_or(1)
                    .min(8),
                )
            } else {
                None
            };

            let capabilities =
                normalize_capabilities(matched_rule.and_then(|rule| rule.capabilities.as_ref()))
                    .unwrap_or_else(|| {
                        let mut values = Vec::new();
                        if support_first_last_frame {
                            values.push("first_last_frame".to_string());
                        }
                        if support_image_to_video {
                            values.push("image_to_video".to_string());
                        }
                        if support_text_to_video {
                            values.push("text_to_video".to_string());
                        }
                        if support_audio_reference {
                            values.push("audio_reference".to_string());
                        }
                        if support_video_reference {
                            values.push("video_reference".to_string());
                        }
                        values
                    });

            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            object.insert(
                "supportFirstLastFrame".to_string(),
                json!(support_first_last_frame),
            );
            object.insert(
                "supportImageToVideo".to_string(),
                json!(support_image_to_video),
            );
            object.insert(
                "supportTextToVideo".to_string(),
                json!(support_text_to_video),
            );
            object.insert(
                "supportReferenceImages".to_string(),
                json!(support_reference_images),
            );
            if let Some(max_value) = max_reference_images {
                object.insert("maxReferenceImages".to_string(), json!(max_value));
            }
            object.insert(
                "supportVideoReference".to_string(),
                json!(support_video_reference),
            );
            if let Some(max_value) = max_reference_videos {
                object.insert("maxReferenceVideos".to_string(), json!(max_value));
            }
            object.insert(
                "supportAudioReference".to_string(),
                json!(support_audio_reference),
            );
            if let Some(max_value) = max_reference_audios {
                object.insert("maxReferenceAudios".to_string(), json!(max_value));
            }
            object.insert("capabilities".to_string(), json!(capabilities));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
        AvailableModelKind::VoiceTts => {
            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            object.insert("type".to_string(), json!("tts"));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
        AvailableModelKind::VoiceAsr => {
            let mut object = serde_json::Map::new();
            object.insert("provider".to_string(), json!(provider));
            object.insert("model".to_string(), json!(model_id));
            object.insert("displayName".to_string(), json!(display_name));
            object.insert("description".to_string(), json!(description));
            object.insert("type".to_string(), json!("asr"));
            insert_optional_string(&mut object, "docUrl", doc_url);
            (kind, Value::Object(object))
        }
    }
}

pub(super) fn image_model_config(provider: &str, model_id: &str) -> Option<Value> {
    let (kind, entry) = build_available_model_entry(provider, model_id);
    if kind == AvailableModelKind::Image {
        Some(entry)
    } else {
        None
    }
}
