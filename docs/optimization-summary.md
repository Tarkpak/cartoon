# 当前主流程对齐摘要

本项目的工作台主流程已统一为：

`解析 -> 资产 -> 视频 -> 成片`

本次整理的目标是清除历史模板中心及其配置残留，避免继续混用已经下线的旧链路。

## 现行提示词模板

提示词中心只保留以下 6 个模板：

- `script_parsing`
- `character_sheet`
- `character_regeneration`
- `environment_reference_generation`
- `scene_description_refinement`
- `scene_video_generation`

## 现行业务流程模型步骤

工作流模型配置只保留以下步骤：

- `script_parsing`
- `scene_description_refinement`
- `text_translation`
- `character_portrait`
- `frame_generation`
- `video_generation`

## 当前核心接口

- `POST /api/script/parse`
- `POST /api/character/generate`
- `POST /api/asset-workflow/reference/generate`
- `POST /api/asset-workflow/scene/description-refinement`
- `POST /api/asset-workflow/video/generate`
- `POST /api/video/merge`

## 清理原则

- 不保留旧流程 prompt ID 的兼容映射。
- 不保留旧流程 API 文件或旧命名别名。
- 设置页中的提示词分组按 `parse / assets / videos` 展示。
- 工作流模型配置只面向当前主流程，不再出现任何历史流程项。
