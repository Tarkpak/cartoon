# OpenAI 官方 API

在「设置 → 模型供应商 → OpenAI」中填写官方 API Key 并保存。Base URL 留空时使用 `https://api.openai.com/v1`。密钥由 Rust 后端保存，配置查询只返回是否已配置。

点击同步模型，从账号的 `/models` 列表中启用需要的文本和图片模型，再在模型测试或工作流设置中选择对应模型。

- 文本调用使用 `/chat/completions`，支持该接口的 GPT 与推理模型。
- 图片生成使用 `/images/generations`；GPT Image 参考图编辑使用 multipart `/images/edits`，支持多个参考图。
- 图片尺寸、质量及参考图数量受本地模型能力表与官方模型限制约束。
- 相同模型 ID 同时出现在已启用的自定义供应商中时，工作流保留自定义供应商优先规则；若需使用官方接口，请先取消自定义供应商中该模型的启用。

无需新增环境变量或数据库迁移。云端供应商管理也提供独立 OpenAI 条目，可通过现有凭证同步流程下发。

官方文档：[文本生成](https://developers.openai.com/api/docs/guides/text)、[图片生成与编辑](https://developers.openai.com/api/docs/guides/image-generation)。OpenAI 推荐新应用使用 Responses API；本次沿用项目的 Chat Completions 调用与流式解析。

## 服务器内置模型目录

服务端内置列表来自开发环境于 2026-11-05 成功获取的官方 `/v1/models` 快照，共 96 个模型，包含当时账号返回的模型别名和日期版本。目录保存在 `backend/server/assets/openai-model-catalog.json`，不包含 API Key。

更新服务端后，新安装和未成功同步的旧安装均可使用完整内置目录，不必联网同步。已有启用模型不会被自动更改；同步失败时保留错误信息，并以内置目录补全已有缓存；在线同步成功后优先使用账号返回的实际列表。其他供应商不受影响。

这是该次账号同步结果的快照，不保证覆盖此后新增模型或其他账号独享模型。目录完整性不代表项目已支持每个模型的调用协议；当前官方接入仍以文本和图片能力为主。
