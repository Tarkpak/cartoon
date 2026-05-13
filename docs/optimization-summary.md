# 当前主流程对齐摘要

本项目的工作台主流程已统一为：

`解析 -> 资产 -> 视频 -> 成片`

本次整理的目标是清除历史模板中心及其配置残留，避免继续混用已经下线的旧链路。

## 现行提示词模板

提示词中心当前保留以下 15 个模板（按阶段）：

- 解析：`script_episode_plan`、`script_parsing`、`script_parsing_short_drama`、`script_parsing_segment_context`、`script_parsing_episode_drama_context`、`prompt_translation_system`、`prompt_translation_user`
- 资产：`character_sheet`、`character_regeneration`、`environment_reference_generation`、`environment_reference_negative_prompt`、`prop_asset_generation`、`prop_asset_negative_prompt`、`scene_description_refinement`
- 视频：`scene_video_generation`

## 现行业务模型步骤

业务模型配置只保留以下步骤：

- `script_parsing`
- `scene_description_refinement`
- `text_translation`
- `character_portrait`
- `frame_generation`
- `video_generation`

## 当前核心接口

- `POST /api/script/episode-plan`
- `POST /api/script/parse`
- `POST /api/character/generate`
- `POST /api/asset-workflow/reference/generate`
- `POST /api/asset-workflow/prop/generate`
- `POST /api/asset-workflow/scene/description-refinement`
- `POST /api/asset-workflow/video/generate`
- `POST /api/video/merge`

## 清理原则

- 不保留旧流程 prompt ID 的兼容映射。
- 不保留旧流程 API 文件或旧命名别名。
- 设置页中的提示词分组按 `parse / assets / videos` 展示。
- 业务模型配置只面向当前主流程，不再出现任何历史流程项。
