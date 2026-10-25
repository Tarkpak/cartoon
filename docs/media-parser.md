# 内置媒体解析

项目内置 [ucmao/media-parser](https://github.com/ucmao/media-parser)（上游版本 `36e57ff489d23e1037050c9de7f0a39598f8caee`）解析核心的 **Rust 移植版**，直接运行在桌面端内嵌的 Rust 后端进程中：**不依赖 Python、不启动子进程或 HTTP 服务、不占用额外端口，也不需要配置解析服务地址或 API Key**。视频号也统一使用这套引擎。

## 使用范围

统一的“视频图文下载”入口将所有分享链接交给引擎自动识别平台，包括视频号、抖音、小红书、快手、哔哩哔哩、微博等，共 50 个平台（与上游注册表一致）。实际结果取决于链接可访问性、平台风控和凭据。

- 小红书支持视频及图文，不再限制为图片。
- 主视频、整套图集 ZIP、单张原图可直接下载。
- “更多素材”按解析结果显示多个视频、附带图集、实况图视频、音频和 SRT 字幕下载。
- 纯音频结果使用音频播放器；平台仅提供试听片段时页面会标注。
- 完整的资源列表保存在本地历史中；旧抖音、小红书、视频号历史会自动迁入统一表，保留下载路径和时间，可继续查看和删除。

页面展示“支持 N 个平台”分组列表（可展开、按分类筛选与搜索），粘贴链接或分享文案时实时提示识别到的平台；需要登录凭据的平台带钥匙标记，并提示对应的 `.env` 变量及是否已配置。列表与识别结果来自后端 `GET /api/tools/short-video/platforms` 与 `GET /api/tools/short-video/detect?text=`，与解析引擎使用同一份平台表。

解析、预览和下载均经 Rust 后端。每次解析在独立的阻塞线程中执行，总预算 90 秒（外层 100 秒超时），同时最多执行两次解析；请求取消后引擎在下一次网络请求前停止。视频预览支持 Range，下载按块写入磁盘。预览代理仅接受统一解析历史中的媒体地址。

## 平台凭据

如平台要求登录，可在本项目 `.env` 设置 `XHS_COOKIE`、`DOUYIN_COOKIE`、`KUAISHOU_COOKIE`、`WEIBO_COOKIE`、`PINDUODUO_COOKIE`、`DOUBAO_COOKIE`、`JIMENG_COOKIE`、视频号/腾讯元宝的 `YUANBAO_COOKIE` 等变量（别名与上游一致，如 `XIAOHONGSHU_COOKIE`、`DY_COOKIE`、`KS_COOKIE`、`PDD_COOKIE`、`WECHAT_CHANNELS_COOKIE`），再重启后端。抖音还支持 `DOUYIN_UIFID`，以及 `DOUYIN_API_MAX_ATTEMPTS`、`DOUYIN_RETRY_BASE_DELAY`、`DOUYIN_RETRY_MAX_DELAY`、`DOUYIN_ENABLE_MOBILE_FEED` 调优项。凭据不写入前端或源码。

## 开发与发行

无需额外准备步骤：

```sh
bun run dev
# 或
bun run desktop:dev
bun run desktop:build
```

签名脚本（抖音 a_bogus、拼多多 anti-content、腾讯频道 EdgeOne 挑战）通过内嵌 QuickJS（`rquickjs`）执行，脚本与平台域名配置在编译时打包进二进制，安装包不再附带任何解析引擎资源。

## 代码结构

位于 `src-tauri/src/backend/media_parser/`：

- `mod.rs`：`parse()` 入口与 v1 结果映射（`ParsedMedia`）。
- `catalog.rs`：页面使用的平台分组、凭据状态与链接识别。
- `engine.rs`：对应上游 `src/api/parse.py` 的解析流程、错误码与结果组装。
- `urls.rs`：对应上游 `UrlParser` / `WebFetcher`（链接提取、平台识别、参数保留、短链重定向，仅允许访问已支持平台域名）。
- `core.rs`：HTTP 会话（Cookie、超时、取消、登录页检测）、Python 语义的 JSON/URL 辅助函数、HTML 解析、加解密。
- `signer.rs`：QuickJS 签名执行。
- `platforms/`：各平台解析器，`platforms/mod.rs` 维护平台注册表。
- `assets/`：上游 `business_config.json`、签名 JS 与 MIT `LICENSE.media-parser`。

上游的 Flask Web/后台、API Key、积分和代理池功能不属于桌面端，未移植。

## 验证

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib backend::media_
cargo check --manifest-path src-tauri/Cargo.toml
bun run test
bun run lint
bun run typecheck
```

Rust 测试覆盖：平台注册表（50 个平台均可构建，且无网络请求）、全部正则可编译、链接提取与平台识别、v1 结果组装与错误码、签名脚本（a_bogus、anti-content、QuickJS 表达式）、各平台的签名/解密算法（与上游 Python 输出比对的测试向量）、返回映射、资源索引、字幕导出和历史更新。

联网冒烟测试（默认忽略）：

```sh
MEDIA_PARSER_LIVE_URLS="https://www.bilibili.com/video/BV1GJ411x7h7 https://b23.tv/xxxx" \
  cargo test --manifest-path src-tauri/Cargo.toml --lib live_parse -- --ignored --nocapture
```

页面浏览器回归脚本见 `scripts/check-media-parser-browser.mjs`（需安装 agent-browser，可通过 `AGENT_BROWSER` 指定 CLI 路径）。

## 上游同步

升级上游时，对照新版本 `src/parsers/*.py`、`src/api/parse.py`、`utils/web_fetcher.py` 的变更修改对应 Rust 文件，并替换 `assets/` 中的配置与签名脚本，然后运行上述测试与联网冒烟测试。
