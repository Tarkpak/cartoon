# 协作传输与诊断

客户端与云端一同升级后，read 响应的 capabilities.fieldPatch 开启字段差量提交。
旧云端未声明此能力时仍提交完整资源。创建、删除和较大的差量仍使用完整对象。
云端声明 capabilities.fieldPatchV2 时，具有唯一 id 且顺序、成员不变的数组使用元素字段路径。
例如修改一个分镜只传 scenes/37/description。数组增加、删除、重排或缺少唯一 id 时仍整体替换。
元素下标由资源基础版本保护，服务端先校验版本再应用修改；版本检查和编辑锁仍以集数、角色、设置为单位。
因此本次优化传输大小，不改变同一集的互斥编辑规则，也不实现字符级多人同时编辑。
首次进入仍读取完整协作快照，后续 changes 使用游标；当前尚未实现按集懒加载。
新版客户端使用 fieldPatches=true 获取元素/字段差量，旧客户端继续收到完整资源。
云端自动为 project_collaboration_changes 添加可空 patch_json 列，保留原有完整记录；历史记录无需回填。
创建、删除、无变化、差量较大及旧历史记录仍使用完整资源。
客户端先完整解码分页批次，基础版本或路径不匹配时，使用同一游标和 fieldPatches=false 重取该页。
重取失败不会推进游标或应用半页修改。写入回执仍返回完整的已修改资源，以支持回执确认和草稿恢复。

Rust 后端在开发和生产环境均将云端协作请求写入现有 app_logs 表，category=collaboration，沿用日志保留上限。
可在应用现有日志查看/导出入口筛选此分类，或只读查询本机数据库：

```sql
SELECT timestamp, request_id, status, duration_ms, metadata_json
FROM app_logs WHERE category = 'collaboration'
ORDER BY timestamp DESC LIMIT 200;
```

metadata 包括 projectId、action、operationId、requestId、elapsedMs、requestBytes、responseBytes、status、mutationCount、patchFieldCount、fieldPatches、deltaChangeCount、afterCursor、nextCursor。
patchFieldCount 表示本次上传的差量字段数量；deltaChangeCount 表示下发的差量资源数量。
同项目同游标的 fieldPatches=true 后跟 false 表示客户端进行了基础版本/路径不匹配回退。
字节数是序列化 JSON 的未压缩大小，不含 HTTP 头，不能等同于实际线路流量。
requestBytes 包括后端添加的认证租约字段的大小，但日志不包含其内容。
正文、媒体 URL、token 和错误响应正文均不写入这些诊断日志。
关联 operationId 可判断同一次提交的重试；关联项目和 action 可定位 read/changes/write/lease/migrationPreview/enable 的耗时或错误。
本机 prepare 的整体 HTTP 耗时继续由现有 http_request 日志记录。

排查流量时区分本机前端到 Rust 的请求、Rust 到云端的请求和媒体下载。
本次移除协作快照准备成功后的重复本机完整项目读取。
