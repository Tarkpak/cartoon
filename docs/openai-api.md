# OpenAI 官方 API

在「设置 → 模型供应商 → OpenAI」中填写官方 API Key 并保存。Base URL 留空时使用 `https://api.openai.com/v1`。密钥由 Rust 后端保存，配置查询只返回是否已配置。

点击同步模型，从账号的 `/models` 列表中启用需要的文本和图片模型，再在模型测试或工作流设置中选择对应模型。

- 文本调用使用 `/chat/completions`，支持该接口的 GPT 与推理模型。
- 图片生成使用 `/images/generations`；GPT Image 参考图编辑使用 multipart `/images/edits`，支持多个参考图。
- 图片尺寸、质量及参考图数量受本地模型能力表与官方模型限制约束。
- 相同模型 ID 同时出现在已启用的自定义供应商中时，工作流保留自定义供应商优先规则；若需使用官方接口，请先取消自定义供应商中该模型的启用。

无需新增环境变量或数据库迁移。云端供应商管理也提供独立 OpenAI 条目，可通过现有凭证同步流程下发。

官方文档：[文本生成](https://developers.openai.com/api/docs/guides/text)、[图片生成与编辑](https://developers.openai.com/api/docs/guides/image-generation)。OpenAI 推荐新应用使用 Responses API；本次沿用项目的 Chat Completions 调用与流式解析。
