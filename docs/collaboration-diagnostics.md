# 协作传输与诊断

客户端与云端一同升级后，read 响应的 capabilities.fieldPatch 开启字段差量提交。
旧云端未声明此能力时仍提交完整资源。创建、删除和较大的差量仍使用完整对象。
云端声明 capabilities.fieldPatchV2 时，具有唯一 id 且顺序、成员不变的数组使用元素字段路径。
例如修改一个分镜只传 scenes/37/description。数组增加、删除、重排或缺少唯一 id 时仍整体替换。
元素下标由资源基础版本保护，服务端先校验版本再应用修改；版本检查和编辑锁仍以集数、角色、设置为单位。
因此本次优化传输大小，不改变同一集的互斥编辑规则，也不实现字符级多人同时编辑。
本机首次进入仍读取完整协作快照，Rust 后端按云端地址、账号和项目隔离持久化资源缓存。
再次进入先在线校验权限并发送 knownResources 版本清单，云端只返回变化的资源和权威 resourceManifest；
客户端按清单还原本机快照，未变化的资源正文不会跨云端网络重复传输。云端也不会读取、解析未变化的资源正文。
缓存使用校验和检查完整性；缓存缺失、损坏或清单版本无法匹配时回退完整读取，回退失败不提供可编辑的缓存项目。
旧云端忽略 knownResources 时仍能正常读取完整资源。
后续 changes 使用游标；当前尚未实现按集懒加载。本机 Rust 到前端仍返回完整快照，首次打开的大项目仍需要全量加载。
新版客户端使用 fieldPatches=true 获取元素/字段差量，旧客户端继续收到完整资源。
云端自动为 project_collaboration_changes 添加可空 patch_json 列，保留原有完整记录；历史记录无需回填。
创建、删除、无变化、差量较大及旧历史记录仍使用完整资源。
客户端先完整解码分页批次，基础版本或路径不匹配时，使用同一游标和 fieldPatches=false 重取该页。
重取失败不会推进游标或应用半页修改。

云端声明 capabilities.compactReceipt 后，新提交在本机持久化已提交的资源快照，并使用 compactReceipt=true 请求小回执。
云端仅返回对象标识、版本和删除状态；客户端核对版本后使用提交快照还原结果，保存回执不再重复下载整集。
提交快照不包含在 HTTP 请求中。云端仍保留完整的规范回执，同一操作可用任一格式重放；旧待提交操作缺少快照时继续请求完整回执。

云端声明 capabilities.combinedPresence 后，常规空闲轮询将成员状态并入 changes，每 10 秒从两个请求减少为一个。
有未确认提交、保存或合并期间仍单独维护在线状态；开始编辑时也可单独更新状态。
成员状态查询只读取资源标识和删除标记，不读取正文或媒体历史。

Rust 后端在开发和生产环境均将云端协作请求写入现有 app_logs 表，category=collaboration，沿用日志保留上限。
可在应用现有日志查看/导出入口筛选此分类，或只读查询本机数据库：

```sql
SELECT timestamp, request_id, status, duration_ms, metadata_json
FROM app_logs WHERE category = 'collaboration'
ORDER BY timestamp DESC LIMIT 200;
```

metadata 包括 projectId、action、operationId、requestId、elapsedMs、requestBytes、responseBytes、status、mutationCount、patchFieldCount、fieldPatches、deltaChangeCount、afterCursor、nextCursor、knownResourceCount、returnedResourceCount、compactReceipt。
knownResourceCount 表示本机发送的缓存版本数量；returnedResourceCount 表示云端实际返回的资源数量，小回执也计入其中。
缓存无法还原时会额外记录 cacheFallback=true；缓存写入失败也记录警告，不阻断本次在线读取。
patchFieldCount 表示本次上传的差量字段数量；deltaChangeCount 表示下发的差量资源数量。
同项目同游标的 fieldPatches=true 后跟 false 表示客户端进行了基础版本/路径不匹配回退。
字节数是序列化 JSON 的未压缩大小，不含 HTTP 头，不能等同于实际线路流量。
requestBytes 包括后端添加的认证租约字段的大小，但日志不包含其内容。
正文、媒体 URL、token 和错误响应正文均不写入这些诊断日志。
关联 operationId 可判断同一次提交的重试；关联项目和 action 可定位 read/changes/write/lease/migrationPreview/enable 的耗时或错误。
本机 prepare 的整体 HTTP 耗时继续由现有 http_request 日志记录。

排查流量时区分本机前端到 Rust 的请求、Rust 到云端的请求和媒体下载。
本次移除协作快照准备成功后的重复本机完整项目读取。
