# Manju 项目优化总结

基于飞书文档《AIGC-动态漫短剧制作方案》进行的优化。

## 新增功能模块

### 1. 分镜脚本系统 (基于文档 2.3)

- **类型定义**: `shared/types/storyboard.ts`
  - 景别类型 (ShotType): 大远景、全景、中景、近景、特写等
  - 运镜方式 (CameraMovement): 定镜、推镜、拉镜、摇镜、跟镜等
  - 分镜结构: 镜号、景别、画面内容、台词、时长、运镜方式

- **API**: `POST /api/storyboard/generate`
  - 将场景描述转换为专业分镜脚本
  - 包含完整的分镜设计原则

### 2. 场景画面提取 (基于文档 2.5)

- **类型定义**: `shared/types/scene-visual.ts`
  - 场景视觉元素结构
  - 文生图提示词生成

- **API**: `POST /api/scene/visual`
  - 从场景描述中提取视觉元素
  - 生成场景画面的文生图提示词
  - 包含时间、地点、视觉元素、氛围、感官细节

### 3. 角色形象提取 (基于文档 2.4.1)

- **API**: `POST /api/character/extract`
  - 从剧本或人物小传中提取角色
  - 生成角色形象的文生图提示词
  - 包含风格、年龄、发型、脸型、服装等细节

### 4. 角色库系统 (基于文档 2.7.2)

- **类型扩展**: `shared/types/character.ts`
  - 新增角色视角类型 (CharacterView)
  - 新增服装变体类型 (CharacterOutfit)
  - 扩展角色资产结构

- **API**: `POST /api/character/views`
  - 生成角色的多视角变体
  - 支持正面、侧面、背面、俯视、仰视等

### 5. 首帧融合优化 (基于文档 2.6.1.1)

- **API 优化**: `POST /api/frame/generate`
  - 新增融合模式 (fusionMode)
    - `character_scene`: 角色+场景融合
    - `reference`: 参考图模式
    - `text_only`: 纯文本生成
  - 支持场景背景图输入
  - 优化一致性保持策略

### 6. 完整生产流水线 (基于文档 2.1)

- **API**: `POST /api/pipeline/full`
  - 整合完整的 11 步制作流程:
    1. 解析剧本
    2. 生成分镜脚本
    3. 提取角色形象
    4. 生成角色库
    5. 提取场景画面
    6. 生成场景背景
    7. 生成首帧 (角色+场景融合)
    8. 生成场景视频
    9. 生成转场视频
    10. 生成音频
    11. 合成输出

## 优化的提示词

### 剧本解析提示词优化

基于文档 2.2.1 的剧本创作要求:
- 内容逻辑: 绝境 + 强钩子 → 爽点闭环
- 角色设计: 反差感 + 真实感
- 视觉风格: 写实细节 + 科幻反差

### 分镜脚本提示词

基于文档 2.3.1:
- 景别和运镜方式选择指南
- 画面表现力和节奏感要求
- 台词和时长安排原则

### 角色形象提示词

基于文档 2.4.1:
- 完整的角色形象描述结构
- 风格、年龄、发型、脸型、服装等细节
- 禁止敏感词汇的限制

### 场景画面提示词

基于文档 2.5.1:
- 核心场景 + 视觉元素 + 氛围情绪 + 技术风格
- 感官细节增强代入感
- 不包含人物角色描述

## 一致性保持策略 (基于文档 2.7)

1. **角色库**: 预先生成角色的多视角、多表情、多服装变体
2. **图生图**: 使用参考图保持角色外观一致
3. **尾帧连接**: 使用上一场景尾帧作为下一场景首帧参考
4. **场景融合**: 将角色立绘融合到场景背景中

## API 列表

| API | 方法 | 描述 |
|-----|------|------|
| `/api/script/parse` | POST | 剧本解析 |
| `/api/storyboard/generate` | POST | 分镜脚本生成 |
| `/api/character/extract` | POST | 角色形象提取 |
| `/api/character/generate` | POST | 角色立绘生成 |
| `/api/character/views` | POST | 角色视角变体生成 |
| `/api/character/expression` | POST | 角色表情变体生成 |
| `/api/scene/visual` | POST | 场景画面提取 |
| `/api/frame/generate` | POST | 首尾帧生成 |
| `/api/video/generate` | POST | 视频生成 |
| `/api/scene/chain` | POST | 场景串联 |
| `/api/pipeline/produce` | POST | 基础生产流水线 |
| `/api/pipeline/full` | POST | 完整生产流水线 |
