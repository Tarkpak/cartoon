# 快速测试指南

## 启动后台管理系统

```bash
cd backend
bun install  # 安装依赖（包括新增的 bcrypt）
bun run dev  # 启动开发服务器
```

访问：http://127.0.0.1:43200

## 测试步骤

### 1. 测试用户基本信息显示

1. 登录后台管理系统（管理员账号）
2. 进入"用户管理"页面
3. 点击任意用户进入详情页
4. **检查点**：
   - ✅ 页面顶部显示用户信息卡片
   - ✅ 头像显示用户名首字母
   - ✅ 显示角色标签（管理员/普通用户）
   - ✅ 显示状态标签（活跃/禁用）
   - ✅ 显示账号、邮箱、手机号
   - ✅ 显示注册时间、最后登录时间

### 2. 测试禁用/启用用户

1. 点击右上角"禁用用户"按钮
2. **检查点**：
   - ✅ 弹出确认对话框
   - ✅ 确认后状态变为"禁用"
   - ✅ 按钮文字变为"启用用户"
3. 再次点击"启用用户"
4. **检查点**：
   - ✅ 状态恢复为"活跃"

**后端验证**：
```bash
# 查看审计日志
sqlite3 backend/data/playlet-admin.db "SELECT * FROM audit_logs WHERE action='admin.users.status' ORDER BY created_at DESC LIMIT 2;"
```

### 3. 测试编辑用户信息

1. 点击"编辑信息"按钮
2. 修改显示名称、邮箱、手机号
3. 点击"保存"
4. **检查点**：
   - ✅ 显示成功提示
   - ✅ 用户信息卡片自动刷新
   - ✅ 新信息已保存

**后端验证**：
```bash
sqlite3 backend/data/playlet-admin.db "SELECT display_name, email, phone FROM users WHERE id='<用户ID>';"
```

### 4. 测试重置密码

1. 点击"重置密码"按钮
2. 输入新密码（测试输入少于6位的密码）
3. **检查点**：
   - ✅ 少于6位时显示警告
4. 输入有效密码（如：`test123456`）
5. 点击"确认重置"
6. **检查点**：
   - ✅ 显示成功提示
   - ✅ 对话框自动关闭

**验证密码**（用该用户登录客户端测试）

### 5. 测试设备管理

1. 切换到"设备"标签页
2. **检查点**：
   - ✅ 显示设备列表
   - ✅ 每行有三个按钮：启用/禁用、删除
3. 点击"删除"按钮
4. **检查点**：
   - ✅ 设备被删除
   - ✅ 列表自动刷新

**后端验证**：
```bash
# 查看审计日志
sqlite3 backend/data/playlet-admin.db "SELECT * FROM audit_logs WHERE action='admin.devices.delete' ORDER BY created_at DESC LIMIT 1;"

# 确认设备已删除
sqlite3 backend/data/playlet-admin.db "SELECT COUNT(*) FROM user_devices WHERE user_id='<用户ID>';"
```

### 6. 测试调用日志

1. 切换到"调用日志"标签页
2. **检查点**：
   - ✅ 显示日志列表（如果该用户有调用记录）
   - ✅ 显示请求ID、供应商、模型、状态、耗时、成本
3. 测试搜索过滤：
   - 选择供应商：Gemini
   - 选择状态：成功
   - 点击"搜索"
4. **检查点**：
   - ✅ 列表只显示匹配的记录
5. 测试分页
6. **检查点**：
   - ✅ 可以切换页面
   - ✅ 显示总记录数

**后端验证**：
```bash
sqlite3 backend/data/playlet-admin.db "SELECT COUNT(*) FROM model_call_logs WHERE user_id='<用户ID>';"
```

### 7. 测试操作审计

1. 切换到"操作审计"标签页
2. **检查点**：
   - ✅ 显示审计日志列表
   - ✅ 显示操作者、操作类型、目标、IP、时间
3. 在搜索框输入"admin.users"
4. **检查点**：
   - ✅ 只显示用户相关的操作
5. 检查之前的操作是否都有记录：
   - ✅ admin.users.status（禁用/启用）
   - ✅ admin.users.update（编辑信息）
   - ✅ admin.users.reset_password（重置密码）
   - ✅ admin.devices.delete（删除设备）

### 8. 测试项目详情（原有功能）

1. 切换到"项目"标签页
2. 点击任意项目
3. **检查点**：
   - ✅ 打开项目详情抽屉
   - ✅ 显示完整的工作台（解析、资产、视频、成片）
   - ✅ 所有原有功能正常工作

## 测试数据准备

### 创建测试用户

```bash
# 进入后台管理
# 点击"用户管理" -> "新建用户"
# 填写：
账号：testuser001
显示名称：测试用户
密码：test123456
角色：普通用户
```

### 模拟用户登录设备

使用客户端以 testuser001 登录，会自动创建设备记录。

## API 测试（使用 curl）

### 1. 更新用户信息
```bash
curl -X PATCH http://127.0.0.1:43200/api/admin/users/<USER_ID> \
  -H "Content-Type: application/json" \
  -H "Cookie: <YOUR_SESSION_COOKIE>" \
  -d '{
    "displayName": "新名称",
    "email": "new@example.com"
  }'
```

### 2. 重置密码
```bash
curl -X POST http://127.0.0.1:43200/api/admin/users/<USER_ID>/reset-password \
  -H "Content-Type: application/json" \
  -H "Cookie: <YOUR_SESSION_COOKIE>" \
  -d '{
    "password": "newpassword123"
  }'
```

### 3. 删除设备
```bash
curl -X DELETE http://127.0.0.1:43200/api/admin/devices/<DEVICE_ID> \
  -H "Cookie: <YOUR_SESSION_COOKIE>"
```

### 4. 查询调用日志
```bash
curl "http://127.0.0.1:43200/api/admin/users/<USER_ID>/logs?page=1&pageSize=20" \
  -H "Cookie: <YOUR_SESSION_COOKIE>"
```

### 5. 查询审计日志
```bash
curl "http://127.0.0.1:43200/api/admin/users/<USER_ID>/audit-logs?page=1&pageSize=20" \
  -H "Cookie: <YOUR_SESSION_COOKIE>"
```

## 常见问题排查

### 1. bcrypt 未安装
**症状**：启动时报错 `Cannot find module 'bcrypt'`
**解决**：
```bash
cd backend
bun add bcrypt
bun add -D @types/bcrypt
```

### 2. TypeScript 类型错误
**症状**：运行 `bun run typecheck` 报错
**解决**：已在代码中修复，如果仍有错误，可以忽略非关键的类型警告

### 3. 页面不显示新功能
**症状**：打开用户详情页看不到新增的卡片和按钮
**解决**：
- 清除浏览器缓存
- 重启开发服务器：`Ctrl+C` 然后 `bun run dev`

### 4. API 返回 401/403
**症状**：操作时提示权限错误
**解决**：
- 确认已使用管理员账号登录
- 检查 session cookie 是否有效

## 验收清单

- [ ] 用户信息卡片显示正常
- [ ] 禁用/启用用户功能正常
- [ ] 编辑用户信息功能正常
- [ ] 重置密码功能正常（密码验证、加密存储）
- [ ] 设备列表显示正常
- [ ] 删除设备功能正常
- [ ] 调用日志标签页显示正常
- [ ] 调用日志搜索过滤正常
- [ ] 调用日志分页正常
- [ ] 操作审计标签页显示正常
- [ ] 审计日志搜索正常
- [ ] 所有操作都记录了审计日志
- [ ] 原有的项目/提示词/模型标签页功能正常

## 性能测试

### 大数据量测试

1. 创建大量调用日志（模拟）：
```bash
# 插入 1000 条测试日志
sqlite3 backend/data/playlet-admin.db << 'EOF'
BEGIN;
-- 生成测试日志的 SQL（需要根据实际表结构调整）
COMMIT;
EOF
```

2. 测试分页性能
3. 测试搜索过滤性能

**预期**：
- 列表加载时间 < 1 秒
- 搜索响应时间 < 500ms
- 分页切换流畅

## 完成！

所有功能已实现并可以测试。如有问题，请查看：
- 后端日志
- 浏览器开发者工具（Network、Console）
- SQLite 数据库内容
