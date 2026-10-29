//! Resolve compact model character references before existing scene/episode normalization.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(super) const CHARACTER_REFERENCE_RULES: &str = r#"【人物引用协议（覆盖其他模板中的人物输出格式）】
项目已有角色是唯一身份表。已登记人物只引用 id，不得在 newCharacters 重写其外观。
称呼、昵称、亲属称谓只有在原文明确为同一人时才视为别名，使用其既有 id；不得把“某人的母亲”等称谓另建人物。无法确认身份时不得猜测合并。
已有身份若 description 为空，可在 newCharacters 使用原 id 和规范姓名补齐缺失外观；已有非空外观绝不改写，不得因此新增身份。
本次新增角色的完整档案只在顶层 newCharacters 定义一次：{"id":"new_1","name":"规范姓名","aliases":["原文明示的别名"],"description":"稳定外观","role":"角色定位","gender":"性别"}。临时 id 在本次响应内唯一；没有新增角色返回 []。
只登记实际需要出镜或维持视觉一致性的角色；仅在对白、旁白中被提及的姓名不新增资产。已有形态变体保留各自 id，不得合并回基础角色。
顶层 characterIds 列出本次实际使用的已有或新增角色 id，不再返回顶层 characters 完整档案。
目录中每集的 episodeAssets 使用 characterIds:["角色id"]，不再返回 episodeAssets.characters 完整档案。
分镜 scenes[].characters 仍为数组，每项只写 {"characterId":"角色id","appearance":"本镜外观变化，无变化为空","emotion":"表演情绪"}；稳定外观由身份表提供，不重复输出。
输出前核对所有 characterIds 和 characterId：每个引用必须在项目已有身份表或本次顶层 newCharacters 中定义，禁止引用未定义的临时 id。
其他分集、镜头、环境、道具字段继续遵守原协议。只输出 JSON。"#;

/// Retry only dangling references, once. Never invent identities locally or drop references.
pub(super) async fn expand_with_repair<F, Fut>(
    output: Value,
    body: &Value,
    repair: F,
) -> Result<Value, String>
where
    F: FnOnce(Value, String) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    match expand(output.clone(), body) {
        Ok(value) => Ok(value),
        Err(error) if error.starts_with("模型引用了未登记的人物 ID：") => {
            eprintln!("[ScriptPlan][character-repair] {error}; attempting one repair");
            let repaired = repair(output, error.clone())
                .await
                .map_err(|cause| format!("{error}；自动修复调用失败：{cause}"))?;
            expand(repaired, body)
                .map_err(|cause| format!("人物引用自动修复后校验仍失败：{cause}"))
        }
        Err(error) => Err(error),
    }
}

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

struct Registry {
    records: Vec<Value>,
    ids: HashMap<String, usize>,
    names: HashMap<String, Option<usize>>,
}

impl Registry {
    fn new(body: &Value) -> Self {
        let mut registry = Self {
            records: Vec::new(),
            ids: HashMap::new(),
            names: HashMap::new(),
        };
        for (index, item) in body
            .get("characterBaselines")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            if field(item, "name").is_none() {
                continue;
            }
            let mut item = item.clone();
            if field(&item, "id").is_none() {
                item["id"] = json!(format!("existing_{}", index + 1));
            }
            registry.insert(item);
        }
        registry
    }

    fn insert(&mut self, item: Value) -> usize {
        let index = self.records.len();
        if let Some(id) = field(&item, "id") {
            self.ids.insert(id.to_string(), index);
        }
        for name in field(&item, "name").into_iter().chain(
            item.get("aliases")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        ) {
            let key = name_key(name);
            if key.is_empty() {
                continue;
            }
            self.names
                .entry(key)
                .and_modify(|previous| {
                    if *previous != Some(index) {
                        *previous = None;
                    }
                })
                .or_insert(Some(index));
        }
        self.records.push(item);
        index
    }

    fn named(&self, name: &str) -> Option<usize> {
        self.names.get(&name_key(name)).copied().flatten()
    }

    fn supplement(&mut self, index: usize, item: &Value) {
        for key in ["description", "gender", "role"] {
            if field(&self.records[index], key).is_none() {
                if let Some(value) = field(item, key) {
                    self.records[index][key] = json!(value);
                }
            }
        }
        let canonical_name = field(&self.records[index], "name")
            .unwrap_or("")
            .to_string();
        let mut aliases = self.records[index]
            .get("aliases")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for alias in field(item, "name").into_iter().chain(
            item.get("aliases")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        ) {
            let key = name_key(alias);
            if key.is_empty() || key == name_key(&canonical_name) {
                continue;
            }
            if !aliases
                .iter()
                .filter_map(Value::as_str)
                .any(|existing| name_key(existing) == key)
            {
                aliases.push(json!(alias));
            }
            self.names
                .entry(key)
                .and_modify(|previous| {
                    if *previous != Some(index) {
                        *previous = None;
                    }
                })
                .or_insert(Some(index));
        }
        if !aliases.is_empty() {
            self.records[index]["aliases"] = json!(aliases);
        }
    }

    fn register(&mut self, item: &Value) -> Result<usize, String> {
        let name = field(item, "name").ok_or("新增角色缺少规范姓名")?;
        let mut matches = HashSet::new();
        if let Some(index) = self.named(name) {
            matches.insert(index);
        }
        for alias in item
            .get("aliases")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if let Some(index) = self.named(alias) {
                matches.insert(index);
            }
        }
        if matches.len() > 1 {
            return Err(format!("人物别名对应多个已有角色：{name}"));
        }
        let existing = matches.into_iter().next();
        if let Some(index) = field(item, "id").and_then(|id| self.ids.get(id)).copied() {
            if existing != Some(index) && field(&self.records[index], "name") != Some(name) {
                return Err(format!("人物 ID 被重复使用或与姓名冲突：{name}"));
            }
            self.supplement(index, item);
            return Ok(index);
        }
        let index = if let Some(index) = existing {
            // Existing visual settings win; only empty placeholder fields may be filled.
            self.supplement(index, item);
            index
        } else {
            let mut item = item.clone();
            item["id"] = json!(format!("char_parse_{}", uuid::Uuid::new_v4()));
            self.insert(item)
        };
        if let Some(id) = field(item, "id") {
            self.ids.insert(id.to_string(), index);
        }
        Ok(index)
    }

    fn register_legacy(&mut self, item: &Value) -> Result<usize, String> {
        let mut item = if let Some(name) = item.as_str() {
            json!({"name": name})
        } else {
            item.clone()
        };
        // Older models invent sequential IDs. They must not overwrite a different saved identity.
        if let Some(index) = field(&item, "id").and_then(|id| self.ids.get(id)).copied() {
            if field(&item, "name").and_then(|name| self.named(name)) != Some(index)
                && field(&item, "name") != field(&self.records[index], "name")
            {
                item.as_object_mut().unwrap().remove("id");
            }
        }
        self.register(&item)
    }

    fn resolve(&self, id: &str) -> Result<Value, String> {
        self.ids
            .get(id)
            .map(|index| self.records[*index].clone())
            .ok_or_else(|| format!("模型引用了未登记的人物 ID：{id}"))
    }
}

pub(super) fn prompt(body: &Value) -> String {
    let registry = Registry::new(body);
    format!(
        "{}\n【人物身份表】\n{}",
        CHARACTER_REFERENCE_RULES,
        json!(registry.records)
    )
}

/// Keep every identity searchable, but include visual settings only for people
/// explicitly mentioned in this source. Validation still uses the full registry.
pub(super) fn source_prompt(body: &Value, source: &str) -> String {
    let registry = Registry::new(body);
    let records = registry.records.iter().map(|record| {
        let relevant = field(record, "name").into_iter().chain(
            record.get("aliases").and_then(Value::as_array).into_iter().flatten()
                .filter_map(Value::as_str),
        ).any(|name| !name.trim().is_empty() && source.contains(name.trim()));
        if relevant {
            record.clone()
        } else {
            let mut identity = json!({"id": record["id"], "name": record["name"]});
            if let Some(aliases) = record.get("aliases") {
                identity["aliases"] = aliases.clone();
            }
            identity
        }
    }).collect::<Vec<_>>();
    format!("{}\n【人物身份表】\n{}\n未提供外观的已有身份仍已登记，不得重建身份或改写外观。", CHARACTER_REFERENCE_RULES, json!(records))
}

/// Merge additive identity definitions only; model repairs cannot edit episode data.
pub(super) fn apply_definition_patch(mut output: Value, patch: Value) -> Result<Value, String> {
    let data = if output.get("data").is_some() { &mut output["data"] } else { &mut output };
    let patch = patch.get("data").unwrap_or(&patch);
    let additions = patch.get("newCharacters").and_then(Value::as_array)
        .ok_or("人物修复必须返回 newCharacters 数组")?;
    if data.get("newCharacters").is_none() {
        data["newCharacters"] = json!([]);
    }
    let definitions = data["newCharacters"].as_array_mut().ok_or("newCharacters 必须是数组")?;
    for item in additions {
        let id = field(item, "id").ok_or("人物修复缺少 ID")?;
        if definitions.iter().any(|existing| field(existing, "id") == Some(id)) {
            return Err(format!("人物修复不得覆盖已定义 ID：{id}"));
        }
        definitions.push(item.clone());
    }
    Ok(output)
}

/// Episode context contains usage only for registered people; their full settings live in one table.
pub(super) fn compact_episode_context(episodes: &Value, body: &Value) -> Value {
    let registry = Registry::new(body);
    let mut episodes = episodes.clone();
    for episode in episodes.as_array_mut().into_iter().flatten() {
        for item in episode
            .pointer_mut("/episodeAssets/characters")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            if let Some(index) = field(item, "name").and_then(|name| registry.named(name)) {
                *item = json!({"name": registry.records[index]["name"]});
            }
        }
    }
    episodes
}

/// Carry newly confirmed records into the next directory segment, including their stable IDs.
pub(super) fn carry_forward(body: &mut Value, episodes: &[Value]) {
    let mut registry = Registry::new(body);
    for item in episodes
        .iter()
        .filter_map(|episode| {
            episode
                .pointer("/episodeAssets/characters")
                .and_then(Value::as_array)
        })
        .flatten()
    {
        if field(item, "name").is_some() {
            // Output has already been validated; legacy name-only references remain supported.
            if let Some(index) = field(item, "name").and_then(|name| registry.named(name)) {
                registry.supplement(index, item);
                if let Some(id) = field(item, "id") {
                    registry.ids.insert(id.to_string(), index);
                }
            } else {
                registry.insert(item.clone());
            }
        }
    }
    body["characterBaselines"] = json!(registry.records);
}

pub(super) fn expand(mut output: Value, body: &Value) -> Result<Value, String> {
    let data = if output.get("data").is_some() {
        &mut output["data"]
    } else {
        &mut output
    };
    if !data.is_object() {
        return Err("模型人物协议必须是 JSON 对象".into());
    }
    let mut registry = Registry::new(body);
    if data
        .get("newCharacters")
        .is_some_and(|value| !value.is_array())
    {
        return Err("newCharacters 必须是数组".into());
    }
    for item in data
        .get("newCharacters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if field(item, "id").is_none()
            || field(item, "name").is_none()
            || field(item, "description").is_none()
        {
            return Err("新增角色必须包含 id、规范姓名和稳定外观".into());
        }
    }
    // Read new protocol first; old/custom templates returning characters still work.
    for item in data
        .get("newCharacters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        registry.register(item)?;
    }
    for item in data
        .get("characters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        registry.register_legacy(item)?;
    }
    // Legacy directory responses define characters within each episode.
    if let Some(episodes) = data.get("episodes").and_then(Value::as_array) {
        for episode in episodes {
            for item in episode
                .pointer("/episodeAssets/characters")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if item.is_object() && field(item, "name").is_some() {
                    registry.register_legacy(item)?;
                }
            }
        }
    }
    if let Some(episodes) = data.get_mut("episodes").and_then(Value::as_array_mut) {
        for episode in episodes {
            if let Some(assets) = episode
                .get_mut("episodeAssets")
                .filter(|assets| assets.is_object())
            {
                let characters = resolve_list(
                    assets.get("characterIds"),
                    assets.get("characters"),
                    &registry,
                )?;
                assets["characters"] = json!(characters);
                assets.as_object_mut().unwrap().remove("characterIds");
            }
        }
    }
    let mut characters = resolve_list(data.get("characterIds"), data.get("characters"), &registry)?;
    // New records must also reach the frontend when a model omits the optional top-level usage list.
    for item in data
        .get("newCharacters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let index = field(item, "id")
            .and_then(|id| registry.ids.get(id))
            .copied()
            .or_else(|| field(item, "name").and_then(|name| registry.named(name)))
            .ok_or("新增人物无法关联身份表")?;
        characters.push(registry.records[index].clone());
    }
    if let Some(scenes) = data.get_mut("scenes").and_then(Value::as_array_mut) {
        for scene in scenes {
            for item in scene
                .get_mut("characters")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                let resolved = if let Some(id) = field(item, "characterId") {
                    Some(registry.resolve(id)?)
                } else {
                    field(item, "name")
                        .and_then(|name| registry.named(name))
                        .map(|index| registry.records[index].clone())
                };
                if let Some(record) = resolved {
                    item["name"] = record["name"].clone();
                    item["assetId"] = json!(format!("char:{}", field(&record, "id").unwrap()));
                    item.as_object_mut().unwrap().remove("characterId");
                    characters.push(record);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    characters.retain(|item| seen.insert(identity_key(item)));
    if data.get("episodes").is_none() {
        data["characters"] = json!(characters);
    }
    if let Some(object) = data.as_object_mut() {
        object.remove("characterIds");
        object.remove("newCharacters");
    }
    Ok(output)
}

fn identity_key(item: &Value) -> String {
    field(item, "id")
        .map(|id| format!("id:{id}"))
        .unwrap_or_else(|| {
            format!(
                "name:{}",
                name_key(field(item, "name").or_else(|| item.as_str()).unwrap_or(""))
            )
        })
}

/// Parallel batches may discover the same new person independently. Remap every scene to the retained identity.
pub(super) fn merge_batch_characters(
    plan: &Value,
    batches: &mut [(usize, Value)],
    body: &Value,
) -> Result<Vec<Value>, String> {
    let mut registry = Registry::new(body);
    let mut used = Vec::new();
    let mut seen = HashSet::new();
    for item in plan
        .get("characters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(batches.iter().flat_map(|(_, batch)| {
            batch
                .get("characters")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        }))
    {
        let index = registry.register_legacy(item)?;
        if seen.insert(index) {
            used.push(index);
        }
    }
    for (_, batch) in batches {
        for scene in batch
            .get_mut("scenes")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            for character in scene
                .get_mut("characters")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                if let Some(asset_id) = field(character, "assetId") {
                    let record =
                        registry.resolve(asset_id.strip_prefix("char:").unwrap_or(asset_id))?;
                    character["assetId"] = json!(format!("char:{}", field(&record, "id").unwrap()));
                    character["name"] = record["name"].clone();
                }
            }
        }
    }
    Ok(used
        .into_iter()
        .map(|index| registry.records[index].clone())
        .collect())
}

fn resolve_list(
    ids: Option<&Value>,
    legacy: Option<&Value>,
    registry: &Registry,
) -> Result<Vec<Value>, String> {
    let mut characters = Vec::new();
    let mut seen = HashSet::new();
    if let Some(ids) = ids {
        for id in ids.as_array().ok_or("characterIds 必须是数组")? {
            let id = id.as_str().ok_or("人物 ID 必须是字符串")?;
            let record = registry.resolve(id)?;
            if seen.insert(identity_key(&record)) {
                characters.push(record);
            }
        }
    }
    if let Some(items) = legacy.and_then(Value::as_array) {
        for item in items {
            let name = item.as_str().or_else(|| field(item, "name"));
            if let Some(name) = name {
                let record = field(item, "id")
                    .and_then(|id| registry.ids.get(id))
                    .copied()
                    .filter(|index| {
                        field(&registry.records[*index], "name") == Some(name)
                            || registry.named(name) == Some(*index)
                    })
                    .or_else(|| registry.named(name))
                    .map(|index| registry.records[index].clone())
                    .unwrap_or_else(|| item.clone());
                if seen.insert(identity_key(&record)) {
                    characters.push(record);
                }
            }
        }
    }
    Ok(characters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_context_keeps_all_identities_and_only_relevant_appearance() {
        let body = json!({"characterBaselines":[
            {"id":"a","name":"甲","aliases":["老甲"],"description":"唯一蓝衣外观"},
            {"id":"b","name":"乙","aliases":["老乙"],"description":"无关红衣外观"}
        ]});
        let context = source_prompt(&body, "老甲走进房间");
        assert!(context.contains("唯一蓝衣外观"));
        assert!(!context.contains("无关红衣外观"));
        assert!(context.contains("老乙"));
        assert!(context.contains("\"id\":\"b\""));
        assert_eq!(body["characterBaselines"][1]["description"], "无关红衣外观");
    }

    #[test]
    fn additive_repair_preserves_episode_data_and_saved_definitions() {
        let output = json!({"data":{"newCharacters":[{"id":"new_1","name":"甲","description":"蓝衣"}],
            "episodes":[{"startOffset":0,"endOffset":12,"episodeAssets":{"characterIds":["new_1","new_23"]}}]}});
        let repaired = apply_definition_patch(output.clone(), json!({
            "newCharacters":[{"id":"new_23","name":"乙","description":"灰衣"}],
            "episodes":[]
        })).unwrap();
        assert_eq!(repaired["data"]["episodes"], output["data"]["episodes"]);
        assert!(expand(repaired, &json!({})).is_ok());
        assert!(apply_definition_patch(output.clone(), json!({"newCharacters":[{"id":"new_1","name":"丙"}]})).is_err());
        assert!(apply_definition_patch(output, json!({"episodes":[]})).is_err());
    }

    #[tokio::test]
    async fn repairs_missing_episode_characters_and_revalidates_all_references() {
        let output = json!({"newCharacters":[],"episodes":[{"title":"第7集",
            "episodeAssets":{"characterIds":["new_23","new_24"]}}]});
        let result = expand_with_repair(output.clone(), &json!({}), |mut value, error| async move {
            assert!(error.contains("new_23"));
            value["newCharacters"] = json!([
                {"id":"new_23","name":"甲","description":"蓝衣"},
                {"id":"new_24","name":"乙","description":"灰衣"}
            ]);
            Ok(value)
        }).await.unwrap();
        assert_eq!(result["episodes"][0]["title"], "第7集");
        let characters = result["episodes"][0]["episodeAssets"]["characters"].as_array().unwrap();
        assert_eq!(characters.len(), 2);
        assert_eq!(characters[0]["name"], "甲");
        assert_eq!(characters[1]["name"], "乙");

        let error = expand_with_repair(output, &json!({}), |mut value, _| async move {
            value["newCharacters"] = json!([{"id":"new_23","name":"甲","description":"蓝衣"}]);
            Ok(value)
        }).await.unwrap_err();
        assert!(error.contains("自动修复后校验仍失败"));
        assert!(error.contains("new_24"));
    }

    #[tokio::test]
    async fn skips_repair_for_valid_output_and_other_validation_errors() {
        let valid = expand_with_repair(json!({"episodes":[]}), &json!({}), |_, _| async {
            panic!("valid output must not invoke repair")
        }).await.unwrap();
        assert_eq!(valid["episodes"], json!([]));
        let error = expand_with_repair(json!({"newCharacters":[{"id":"new_1"}]}), &json!({}), |_, _| async {
            panic!("unrelated validation errors must not invoke repair")
        }).await.unwrap_err();
        assert!(error.contains("新增角色必须包含"));
    }

    #[tokio::test]
    async fn preserves_original_error_when_repair_call_fails() {
        let error = expand_with_repair(json!({"characterIds":["new_23"]}), &json!({}), |_, _| async {
            Err("network timeout".into())
        }).await.unwrap_err();
        assert!(error.contains("new_23"));
        assert!(error.contains("自动修复调用失败：network timeout"));
    }

    #[test]
    fn reconciles_parallel_discoveries_and_scene_references() {
        let mut batches = vec![
            (
                0,
                json!({"characters":[{"id":"a","name":"新人","description":"蓝衣"}],"scenes":[{"characters":[{"name":"新人","assetId":"char:a"}]}]}),
            ),
            (
                1,
                json!({"characters":[{"id":"b","name":"新人","description":"红衣"}],"scenes":[{"characters":[{"name":"新人","assetId":"char:b"}]}]}),
            ),
        ];
        let records = merge_batch_characters(&json!({}), &mut batches, &json!({})).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["description"], "蓝衣");
        for (_, batch) in batches {
            assert_eq!(
                batch["scenes"][0]["characters"][0]["assetId"],
                format!("char:{}", records[0]["id"].as_str().unwrap())
            );
        }
    }

    #[test]
    fn retains_distinct_saved_identities_with_the_same_name() {
        let body = json!({"characterBaselines":[{"id":"a","name":"小明","description":"少年"},{"id":"b","name":"小明","description":"老年"}]});
        let result = expand(json!({"characters":[{"id":"a","name":"小明"},{"id":"b","name":"小明"}],"scenes":[{"characters":[{"characterId":"b"}]}]}), &body).unwrap();
        assert_eq!(result["characters"].as_array().unwrap().len(), 2);
        assert_eq!(result["scenes"][0]["characters"][0]["assetId"], "char:b");
        let mut batches = vec![(0, result)];
        let records = merge_batch_characters(&json!({}), &mut batches, &body).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(
            batches[0].1["scenes"][0]["characters"][0]["assetId"],
            "char:b"
        );
    }

    fn baseline() -> Value {
        json!({"characterBaselines":[{"id":"c1","name":"田小花","aliases":["福林母亲"],"description":"蓝色旧布衣","gender":"女"}]})
    }

    #[test]
    fn expands_references_without_recreating_existing_people() {
        let result = expand(json!({"newCharacters":[{"id":"new_1","name":"福林母亲","description":"错误新外观"}],
            "characterIds":["c1","new_1"],"scenes":[{"characters":[{"characterId":"new_1","emotion":"高兴","appearance":""}]}]}), &baseline()).unwrap();
        assert_eq!(result["characters"].as_array().unwrap().len(), 1);
        assert_eq!(result["characters"][0]["description"], "蓝色旧布衣");
        assert_eq!(result["scenes"][0]["characters"][0]["name"], "田小花");
        assert_eq!(result["scenes"][0]["characters"][0]["assetId"], "char:c1");
        assert_eq!(result["scenes"][0]["characters"][0]["emotion"], "高兴");
    }

    #[test]
    fn shares_new_definitions_across_episodes_and_segments() {
        let mut body = baseline();
        let result = expand(json!({"newCharacters":[{"id":"new_1","name":"福林","description":"灰色布衣"}],"episodes":[
            {"episodeAssets":{"characterIds":["c1","new_1","new_1"]}},
            {"episodeAssets":{"characterIds":["new_1"]}}
        ]}), &body).unwrap();
        let episodes = result["episodes"].as_array().unwrap();
        let id = episodes[0]["episodeAssets"]["characters"][1]["id"].clone();
        assert_eq!(
            episodes[0]["episodeAssets"]["characters"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(episodes[1]["episodeAssets"]["characters"][0]["id"], id);
        carry_forward(&mut body, episodes);
        assert_eq!(body["characterBaselines"].as_array().unwrap().len(), 2);
        assert_eq!(body["characterBaselines"][1]["id"], id);
        assert!(prompt(&body).contains("灰色布衣"));
        // Temporary IDs may be reused in a later response for a different new role.
        let next = expand(json!({"newCharacters":[{"id":"new_1","name":"林婉莹","description":"白衣"}],"characterIds":[id,"new_1"]}), &body).unwrap();
        assert_eq!(next["characters"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn removes_duplicate_visual_settings_from_episode_context() {
        let episodes = json!([{"episodeAssets":{"characters":[{"id":"outdated","name":"田小花","description":"过期红衣"},
            {"name":"新角色","description":"仍需提供的外观"}],"props":[{"name":"药箱"}]}}]);
        let compact = compact_episode_context(&episodes, &baseline());
        assert_eq!(
            compact[0]["episodeAssets"]["characters"][0],
            json!({"name":"田小花"})
        );
        assert_eq!(
            compact[0]["episodeAssets"]["characters"][1]["description"],
            "仍需提供的外观"
        );
        assert_eq!(
            compact[0]["episodeAssets"]["props"],
            episodes[0]["episodeAssets"]["props"]
        );
    }

    #[test]
    fn carries_explicit_aliases_into_later_segments() {
        let mut body =
            json!({"characterBaselines":[{"id":"c1","name":"田小花","description":"蓝衣"}]});
        let result = expand(json!({"newCharacters":[{"id":"new_1","name":"福林母亲","aliases":["田小花"],"description":"重设"}],
            "episodes":[{"episodeAssets":{"characterIds":["new_1"]}}]}), &body).unwrap();
        carry_forward(&mut body, result["episodes"].as_array().unwrap());
        assert_eq!(body["characterBaselines"].as_array().unwrap().len(), 1);
        assert!(prompt(&body).contains("福林母亲"));
        let next = expand(
            json!({"characters":[{"name":"福林母亲","description":"再次重设"}]}),
            &body,
        )
        .unwrap();
        assert_eq!(next["characters"][0]["name"], "田小花");
        assert_eq!(next["characters"][0]["description"], "蓝衣");
    }

    #[test]
    fn fills_placeholder_settings_without_allocating_another_identity() {
        let mut body =
            json!({"characterBaselines":[{"id":"placeholder","name":"甲","description":""}]});
        let result = expand(
            json!({"newCharacters":[{"id":"placeholder","name":"甲","description":"短发蓝衣"}],
            "episodes":[{"episodeAssets":{"characterIds":["placeholder"]}}]}),
            &body,
        )
        .unwrap();
        let episodes = result["episodes"].as_array().unwrap();
        assert_eq!(
            episodes[0]["episodeAssets"]["characters"][0]["id"],
            "placeholder"
        );
        assert_eq!(
            episodes[0]["episodeAssets"]["characters"][0]["description"],
            "短发蓝衣"
        );
        carry_forward(&mut body, episodes);
        assert_eq!(body["characterBaselines"].as_array().unwrap().len(), 1);
        assert_eq!(body["characterBaselines"][0]["description"], "短发蓝衣");
    }

    #[test]
    fn rejects_unknown_ids_and_conflicting_aliases() {
        assert!(expand(json!({"characterIds":["missing"]}), &baseline()).is_err());
        let body = json!({"characterBaselines":[{"id":"a","name":"甲"},{"id":"b","name":"乙"}]});
        assert!(expand(
            json!({"newCharacters":[{"name":"甲","aliases":["乙"]}]}),
            &body
        )
        .is_err());
        assert!(expand(json!({"newCharacters":[{"id":"a","name":"丙"}]}), &body).is_err());
    }

    #[test]
    fn ignores_colliding_sequential_ids_from_legacy_templates() {
        let body = json!({"characterBaselines":[{"id":"char_1","name":"甲","description":"蓝衣"}]});
        let result = expand(
            json!({"characters":[{"id":"char_1","name":"乙","description":"灰衣"}]}),
            &body,
        )
        .unwrap();
        assert_eq!(result["characters"][0]["name"], "乙");
        assert_ne!(result["characters"][0]["id"], "char_1");
    }

    #[test]
    fn keeps_legacy_outputs_and_distinct_variants_compatible() {
        let body = json!({"characterBaselines":[{"id":"a","name":"甲","description":"蓝衣"},{"id":"v","name":"甲-老年","description":"白发"}]});
        let result = expand(json!({"characters":[{"name":"甲","description":"重设"},{"name":"乙","description":"新角色"}],
            "scenes":[{"characters":[{"name":"甲-老年"}]}]}), &body).unwrap();
        assert_eq!(result["characters"].as_array().unwrap().len(), 3);
        assert_eq!(result["characters"][0]["description"], "蓝衣");
        let empty = expand(
            json!({"characterIds":[],"newCharacters":[],"scenes":[]}),
            &body,
        )
        .unwrap();
        assert_eq!(empty["characters"], json!([]));
    }
}
