# 阿里云百炼模型适配

核对日期：2026-10-29。阿里云模型使用现有 `qwen` 供应商配置。

| 类型 | 新增模型 | 支持范围 |
| --- | --- | --- |
| 文本 | `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` | 沿用 OpenAI 兼容文本接口与流式响应 |
| 图像 | `qwen-image-3.0-pro`、`qwen-image-3.0` | 文生图、图像编辑，最多 3 张参考图 |
| 图像 | `qwen-image-2.1-pro`、`qwen-image-2.1-turbo` | 文生图、图像编辑，最多 10 张参考图 |
| 视频 | `wan3.0-video`、`wan3.0-video-prime` | 文生视频、首帧、首尾帧、全能参考；2–30 秒 |
| 视频 | `happyhorse-1.1-t2v` | 文生视频；3–15 秒 |
| 视频 | `happyhorse-1.1-i2v` | 单张首帧生视频；3–15 秒 |
| 视频 | `happyhorse-1.1-r2v` | 1–9 张参考图生视频；3–15 秒 |

新增视频模型支持 480p、720p、1080p。Wan 3.0 全能参考最多支持 10 张图片、5 段视频和 5 段音频；首帧/首尾帧不能与参考素材混用。上游还要求参考视频总时长、参考音频总时长各不超过 15 秒，输入视频总时长与输出时长之和不超过 30 秒，这些媒体时长限制由上游校验。HappyHorse 1.1 不接受尾帧、参考视频或参考音频。

设置中的 Base URL 可填写 OpenAI 兼容地址、原生 `/api/v1` 地址或地域域名。文本与模型同步使用 `/compatible-mode/v1`，图像、视频及异步任务查询使用同域名的 `/api/v1`。例如：

- 北京：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 新加坡：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- 业务空间：`https://实际业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

模型、API Key 和地址必须属于同一地域，并且账号需要具有对应模型的调用权限。没有配置新的环境变量或数据库迁移。

本地目录会补齐原生图像、视频模型，避免兼容 `/models` 返回的文本模型列表覆盖它们。原有启用模型与工作流选择保持不变，升级后在模型设置中启用所需新模型即可。本次未扩展视频编辑、文件/网页参考、智能时长与自适应比例等产品输入项。

验证使用本地单元测试和编译检查，未调用计费生成接口。

官方参考：

- [模型目录](https://help.aliyun.com/zh/model-studio/models)
- [千问图像生成与编辑](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [Wan 3.0 视频 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)
- [HappyHorse 文生视频](https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference)
- [HappyHorse 图生视频](https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference)
- [HappyHorse 参考生视频](https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference)
