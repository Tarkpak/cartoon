# 字节 / 火山引擎模型适配

核对日期：2026-10-29。使用现有 `volcengine` 供应商，Base URL 默认 `https://ark.cn-beijing.volces.com/api/v3`。

| 类型 | 模型 ID | 项目支持 |
| --- | --- | --- |
| 文本 | `doubao-seed-evolving` | 官方推荐的快速迭代模型，支持文本生成、流式响应与深度思考 |
| 文本 | `doubao-seed-2-1-pro-260915` | Chat API 文本生成、流式响应，标记深度思考能力 |
| 文本 | `doubao-seed-2-1-lite-260915` | 同上 |
| 文本 | `doubao-seed-2-1-turbo-260628` | 同上 |
| 图像 | `doubao-seedream-5-0-pro-260628` | 文生图、单图编辑、多图参考，最多 10 张参考图 |
| 图像 | `doubao-seedream-5-0-flash-260915` | 同上 |
| 视频 | `doubao-seedance-2-5-260628` | 已有文生视频、首尾帧、多模态参考；4–30 秒，480p / 720p / 1080p |

原有 Seed 2.0、Seedream 5.0 / Lite、Seedance 2.0 / Fast / Mini 继续可用。升级会补充本地可选模型目录，不会自动启用新模型或更改工作流选择。兼容 `/models` 同步结果会合并本地目录，避免原生图片、视频模型被遗漏；实际调用仍需账号开通相应模型权限。

## 图像协议

使用 Ark 原生 `/images/generations` 接口。单张参考图传 `image` 字符串，多张传字符串数组，所有参考图均会发送。尺寸会从项目内部的 `宽*高` 转成 API 使用的 `宽x高`。请求显式设置 `response_format=url`、`watermark=false`。

Seedream 5.0 Pro / Flash 支持 `1K`、`1.5K`、`2K` 和自定义像素尺寸。自定义尺寸总像素范围为 921600–4624220，长短边比例不超过 16:1。模型测试目录同时提供常用比例的像素尺寸。超出尺寸或参考图数量限制会在发送请求前报错。

这两款新模型不支持组图参数 `sequential_image_generation`，也不使用 OpenAI 的 `n` 参数。本次接入单张结果的生成与编辑；官方的图层拆分和坐标交互编辑尚未扩展为独立产品操作。

## 视频核对

官方最新视频模型仍是 Seedance 2.5。保留其 30 张参考图片、10 段参考视频、10 段参考音频能力。参考视频总时长和参考音频总时长各不超过 30 秒等媒体限制由上游校验。

视频请求现在优先读取共享配置 `withAudio` 控制 `generate_audio`，兼容旧的 `audio` 字段，避免用户关闭声音后仍生成有声视频。本次未新增视频编辑、视频延长、样片模式或 MOV 输出入口。

## 验证与配置

不需要新增环境变量或数据库迁移。验证使用本地单元测试、类型与编译检查，没有调用计费生成接口；账号权限及真实产物需使用对应 API Key 验证。

官方文档：

- [模型列表](https://www.volcengine.com/docs/82379/1330310?lang=zh)
- [深度思考与 Seed 2.1](https://www.volcengine.com/docs/ark/deep-thinking)
- [Chat API](https://www.volcengine.com/docs/ark/chat-api)
- [Seedream 5.0 Pro / Flash 教程](https://www.volcengine.com/docs/ark/seedream-5-0-pro)
- [图片生成 API](https://www.volcengine.com/docs/ark/image-generation-api)
- [Seedance 2.5 教程](https://www.volcengine.com/docs/ark/seedance-2-5)
