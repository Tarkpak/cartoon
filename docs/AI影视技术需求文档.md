# playlet 当前工作台技术需求文档

> 更新日期：2026-04-18

## 1. 产品目标

playlet 当前版本聚焦资产工作台，主流程固定为：

`解析 -> 资产 -> 视频 -> 成片`

系统目标不是再走旧的“大纲 -> 分镜 -> 配音”链路，而是把原文直接解析为可生产的场景时间轴，再围绕资产一致性完成视频生成与最终合成。

## 2. 当前主流程

### 2.1 解析

输入小说、剧本或故事正文后，系统执行：

- 剧本解析
- 场景拆分
- 角色抽取
- 场景时间轴描述生成

对应接口：

- `POST /api/script/parse`

对应提示词模板：

- `script_parsing`

### 2.2 资产

资产阶段负责生成并维护后续视频生成所需的参考素材：

- 角色资产生成
- 角色资产二次生成
- 环境参考图生成
- 场景描述二次改写

对应接口：

- `POST /api/character/generate`
- `POST /api/asset-workflow/reference/generate`
- `POST /api/asset-workflow/scene/description-refinement`

对应提示词模板：

- `character_sheet`
- `character_regeneration`
- `environment_reference_generation`
- `scene_description_refinement`

### 2.3 视频

视频阶段基于场景描述和资产引用生成单个分镜片段：

- 使用环境参考图、角色参考图和时间轴描述
- 输出分镜片段

对应接口：

- `POST /api/asset-workflow/video/generate`
- `POST /api/video/generate`

对应提示词模板：

- `scene_video_generation`

### 2.4 成片

成片阶段将已生成的分镜视频进行拼接输出：

- 片段合并
- 可选字幕/BGM
- 导出最终成片

对应接口：

- `POST /api/video/merge`

## 3. 提示词中心约束

提示词中心必须只保留当前主流程模板：

- `script_parsing`
- `character_sheet`
- `character_regeneration`
- `environment_reference_generation`
- `scene_description_refinement`
- `scene_video_generation`

设置页中的提示词分组按以下阶段展示：

- `parse`
- `assets`
- `videos`

不再保留任何历史模板、历史路由命名或历史工作流别名。

## 4. 业务模型配置约束

业务模型配置必须只覆盖当前主流程步骤：

- `script_parsing`
- `scene_description_refinement`
- `text_translation`
- `character_portrait`
- `frame_generation`
- `video_generation`

设置页可以按模型类型管理全局默认模型：

- 文本模型
- 图片模型
- 视频模型

但不得再出现任何历史 workflow step。

## 5. 核心模块

### 5.1 前端

- `app/pages/asset-workbench.vue`
- `app/composables/useAssetWorkbench*.ts`
- `app/composables/useSettingsPrompts.ts`
- `app/composables/useSettingsWorkflowModels.ts`

### 5.2 后端

- `server/api/script/parse.post.ts`
- `server/api/character/generate.post.ts`
- `server/api/asset-workflow/reference/generate.post.ts`
- `server/api/asset-workflow/scene/description-refinement.post.ts`
- `server/api/asset-workflow/video/generate.post.ts`
- `server/api/video/merge.post.ts`
- `server/utils/prompt-template.ts`
- `server/utils/prompt-defaults.ts`
- `server/utils/workflow-model.ts`

### 5.3 共享类型

- `shared/types/prompt-template.ts`
- `shared/types/workflow-models.ts`
- `shared/types/project.ts`

## 6. 清理要求

- 不保留旧流程路由兼容文件。
- 不保留旧流程 prompt ID 和 workflow step。
- 不保留旧流程设置分组和旧命名。
- 文档、注释和说明文字都必须以当前主流程为准。
