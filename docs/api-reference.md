# API 参考

所有 API 端点均在 `/api/` 路径下。支持 CORS 跨域访问。

## 认证与 API Key

- **Cookie 认证**: 浏览器与 Webview 自动携带，Session 有效期为 31 天。
- **API Key 认证**: 适用于自动化插件与外部调用。在 HTTP 请求头中传入 `x-api-key: <key>` 或 `Authorization: Bearer <key>`。
- **Webview 免密注入**: 软件型插件（如 Tauri / Electron 应用）内部 Webview 可直接通过 URL 携带 `?apiKey=...`、或在页面加载前注入 `window.__UOOC_API_KEY__` 或设置 Cookie `apiKey`，平台自动完成免密登录并持久化。
- **自动匿名注册与下发 API Key**:
  - `POST /api/auth/anonymous-key`：插件调用的专用 Auth API，自动完成基于 Better Auth Anonymous 插件的匿名注册并下发持久 `apiKey`。业务上传接口（如 `/api/upload/batch`）不负责写 Auth 数据库，插件应先通过该 Auth 接口或登录获取凭据。
- **RFC 8628 设备授权流 (无回调地址认证)**:
  - 专门解决油猴脚本、浏览器扩展程序、无 GUI 的 CLI 终端或外部 Agent **无法配置固定重定向回调地址 (Callback URL)** 的痛点。
  - 客户端通过 `POST /api/auth/device/code` 请求设备码 (`device_code`) 与用户码 (`user_code`)，引导用户在浏览器打开 `/device?user_code=...` 页面完成授权，随后轮询 `POST /api/auth/device/token` 获取正式 Session Bearer Token。
- **OAuth 认证与账号绑定/升级**:
  - 用户可在插件或平台设置中通过 OAuth（GitHub 或 bili-sign.rinne.in）进行主账号登录并生成具有完整修改权限的 API Key。
  - 对于初始使用匿名账号的插件/用户，支持在账户面板调用 `linkSocial` 将匿名账户与 OAuth 绑定（作为主账号或合并至已有 OAuth 账号），原匿名用户名下的所有历史提交试题与 API Key 均会自动迁移，永久保留并解锁覆盖更新权限。
- **Agent 临时态认证**:
  - Agent 可通过 `/.well-known/agent-configuration` 发现服务，采用 Agent Auth 协议通过短时 JWT 接入。
  - MCP 端点兼容 OAuth 2.1 与 Agent Auth，自动为 Agent 分配临时匿名用户态。

匿名用户可查询和添加新答案，但不可覆盖已有的正确答案。通过 OAuth 认证的用户可覆盖更新。

---

## 题目查询

### GET /api/questions/:id

获取单个题目及其答案。

**响应:**

```json
{
  "question": {
    "id": 1,
    "tid": "12345",
    "questionId": "q1",
    "type": "single",
    "stem": "题干内容",
    "options": [{ "id": "A", "text": "选项A" }],
    "blanks": 0
  },
  "answers": [
    {
      "id": 1,
      "values": ["A"],
      "isCorrect": true,
      "source": "plugin",
      "confidence": 1.0
    }
  ]
}
```

### GET /api/questions/:id/answers

获取某题目的所有答案记录。

### GET /api/questions/search?q=关键词

搜索题目。支持向量语义搜索（优先使用客户端传入向量，否则服务端调用 embedding API）和 ILIKE 文本匹配回退。

**参数:**

- `q` — 搜索关键词或题干文本
- `exact=1` — 使用 stem_hash 精确匹配（可选）
- `embedding` — 本地计算好的 1536 维向量 JSON 字符串（可选，传入时直接在数据库执行向量相似度计算，跳过服务端向量生成）
- `limit` — 返回数量限制（默认 20）

### POST /api/questions/search

**题目向量与文本检索接口（推荐客户端/插件调用）**。支持直接在请求体传递本地计算完成的 1536 维向量，避免在服务端生成向量，大幅降低响应延迟与中心服务器负载。

**请求体:**

```json
{
  "q": "以下关于矩阵初等变换的说法中正确的是？",
  "embedding": [0.0123, 0.0456, "... (共1536维浮点数)"],
  "exact": false,
  "limit": 20
}
```

**字段说明:**

| 字段        | 必填 | 说明                                                                                 |
| ----------- | ---- | ------------------------------------------------------------------------------------ |
| `embedding` | ❌   | 本地计算的 1536 维浮点数向量。**传入时直接执行数据库向量检索，跳过服务端模型生成**   |
| `q`         | ❌   | 题干搜索关键词。若未传 `embedding`，服务端将根据 `q` 生成向量或降级为 ILIKE 模糊检索 |
| `exact`     | ❌   | 是否按规范化 `stem_hash` 精确匹配 (`true` / `false` / `"1"`)                         |
| `limit`     | ❌   | 返回结果数量（默认 20，最大 50）                                                     |

**响应:**

```json
{
  "results": [
    {
      "id": 1,
      "tid": "12345",
      "questionId": "q1",
      "type": "single",
      "stem": "以下关于矩阵初等变换的说法中正确的是？",
      "similarity": 0.942
    }
  ]
}
```

---

## 题组与课程

### GET /api/tasks/:tid

获取题组下所有题目及答案。

**响应:**

```json
{
  "taskGroup": { "tid": "12345", "cid": "678", "name": "第一章测验" },
  "questions": [
    {
      "id": 1,
      "questionId": "q1",
      "type": "single",
      "stem": "...",
      "answers": [{ "values": ["A"], "isCorrect": true }]
    }
  ]
}
```

### GET /api/tasks/:tid/info

获取题组元信息和题目总数。

### GET /api/courses/:cid

获取课程下所有题组。

### GET /api/courses/:cid/tasks/:tid

获取指定课程中指定题组的题目（验证 tid 属于 cid）。

---

## 批量上传

### POST /api/upload/batch

批量上传题目和答案。这是插件集成的核心接口。

**请求体:**

```json
{
  "tid": "12345",
  "cid": "678",
  "task_name": "第一章测验",
  "course_name": "高等数学",
  "questions": [
    {
      "question_id": "q1",
      "type": "single",
      "stem": "以下哪个正确？",
      "options": [
        { "id": "A", "text": "选项A" },
        { "id": "B", "text": "选项B" }
      ],
      "embedding": [0.0123, 0.0456, 0.0789],
      "correct_answers": ["A"],
      "wrong_answers": null
    },
    {
      "question_id": "q2",
      "type": "multiple",
      "correct_answers": null,
      "wrong_answers": ["C", "D"]
    }
  ]
}
```

**字段说明:**

| 字段                          | 必填 | 说明                                     |
| ----------------------------- | ---- | ---------------------------------------- |
| `tid`                         | ✅   | UOOC 题组 ID                             |
| `cid`                         | ❌   | 课程 ID，未提供时使用 tid 作为占位       |
| `questions[].question_id`     | ✅   | UOOC 题目标识符                          |
| `questions[].type`            | ✅   | `single` / `multiple` / `judge` / `text` |
| `questions[].stem`            | ❌   | 题干文本（可含 HTML）                    |
| `questions[].embedding`       | ❌   | 插件生成的 1536 维题干词向量             |
| `questions[].options`         | ❌   | 选项列表 `[{id, text}]`                  |
| `questions[].correct_answers` | ❌   | 正确答案值数组                           |
| `questions[].wrong_answers`   | ❌   | 已排除的错误答案值数组                   |

**处理逻辑:**

1. 自动创建不存在的课程和题组
2. 按 `(tid, question_id)` 匹配题目，回退到 `stem_hash` 匹配
3. 提供 `correct_answers` 时：
   - 创建/更新正确答案
   - 删除该题已有的错误答案排除记录
   - 匿名用户不允许覆盖已有正确答案（返回 `denied_anonymous_overwrite`）
4. 仅提供 `wrong_answers` 时：添加错误答案排除标记
5. 如果提供了 `stem`/`options` 且题目之前未存储，自动更新

向量处理规则：上传请求带有 `embedding` 时直接使用客户端向量；未带向量时，仅在服务端配置 `EMBEDDING_API_URL` 和 `EMBEDDING_API_KEY` 时调用 embedding 模型。向量必须为 1536 维数字数组。

上面的 JSON 仅展示数组前几项，实际请求必须提供完整的 1536 个数字。

**响应:**

```json
{
  "ok": true,
  "results": [
    { "question_id": "q1", "action": "added_correct", "internal_id": 1 },
    { "question_id": "q2", "action": "added_wrong", "internal_id": 2 }
  ]
}
```

`action` 可能的值：

- `added_correct` — 新增正确答案
- `updated_correct` — 更新已有正确答案
- `added_wrong` — 新增错误答案排除
- `denied_anonymous_overwrite` — 匿名用户尝试覆盖被拒绝
- `no_change` — 无变更

---

## 自动任务列表 (Automation Tasks)

根据当前数据库中缺失的可选数据（如缺失题干、缺失向量、缺失选项、缺失答案等）动态计算任务，并根据请求凭证拥有的写权限级别过滤出其能够更新的任务。

### 权限与任务类型映射

| 任务类型 (`task_type`) | 触发条件                                      | 目标                                                  | 允许执行的写权限级别                            |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `stem_request`         | `stem IS NULL OR stem = ''`                   | 补充题目完整题干文本，自动重算 `stem_hash` 并生成向量 | **匿名 API Key / 认证用户 / 管理员**            |
| `embedding_request`    | `stem IS NOT NULL AND stem_embedding IS NULL` | 为已有题干题目计算并补充 1536 维词向量                | **匿名 API Key / 认证用户 / 管理员**            |
| `options_request`      | 选择题/判断题且 `options IS NULL`             | 补充题目选项列表                                      | **匿名 API Key / 认证用户 / 管理员**            |
| `answer_request`       | 尚无关联 `isCorrect = true` 的答案            | 补充确定的正确答案                                    | **认证用户 / 管理员**（匿名用户被拒绝以防污染） |

### GET /api/automation/tasks

根据当前认证身份的写权限级别获取待补全的任务列表。未登录用户不会返回可执行任务。

**请求头 (可选):**

- `x-api-key: <apiKey>` 或 `Authorization: Bearer <apiKey>`

**查询参数:**

- `type` (可选): 任务类型过滤 (`stem_request` / `embedding_request` / `options_request` / `answer_request` / `all`)
- `cid` (可选): 按课程 ID 过滤（优先推荐，大幅减少不必要的任务范围）
- `tid` (可选): 按题组 ID 过滤
- `limit` (可选): 返回条数限制（默认 50，最大 100）

**响应示例:**

```json
{
  "ok": true,
  "account": {
    "userId": "user_xyz",
    "permissionLevel": "anonymous",
    "isAnonymous": true
  },
  "allowedTaskTypes": ["stem_request", "embedding_request", "options_request"],
  "count": 2,
  "tasks": [
    {
      "taskId": "stem_1024",
      "taskType": "stem_request",
      "questionId": 1024,
      "uoocQuestionId": "q_abc123",
      "type": "single",
      "tid": "task_456",
      "taskName": "第一章测验",
      "cid": "course_789",
      "courseName": "高等数学",
      "description": "题目缺失题干文本内容，需补充题干"
    },
    {
      "taskId": "emb_1025",
      "taskType": "embedding_request",
      "questionId": 1025,
      "uoocQuestionId": "q_abc124",
      "type": "single",
      "tid": "task_456",
      "taskName": "第一章测验",
      "cid": "course_789",
      "courseName": "高等数学",
      "stemPreview": "设函数 f(x) 在区间 [a, b] 上连续...",
      "description": "题目已有题干但未计算向量嵌入，需计算并写入向量"
    }
  ]
}
```

### POST /api/automation/match

**题库匹配与服务端缺失确认接口**。允许将客户端本地维护的题库 ID 表与服务端比对：

1. **确认服务端是否缺失题目**：比对找出本地 ID 表中存在但服务端数据库尚未收录的题目列表（`missingOnServer`），以便客户端触发批量上传。
2. **过滤任务列表**：优先通过 `cid`（课程 ID）或 `tid`（题组 ID）缩小作用域，同时可传入本地题目 ID 表，仅返回该范围与本地存在关联的待更新任务（`matchedTasks`），极大减少请求与响应 body 体积。

**请求体:**

```json
{
  "cid": "course_789",
  "tid": "task_456",
  "local_question_ids": ["q_abc123", "q_abc124", "q_local_only"],
  "task_types": ["stem_request", "embedding_request"],
  "limit": 50
}
```

也可以通过 `items` 提交带有专属 `tid` 的题目对象数组：

```json
{
  "cid": "course_789",
  "items": [
    { "tid": "task_456", "question_id": "q_abc123" },
    { "tid": "task_456", "question_id": "q_local_only" }
  ]
}
```

**响应示例:**

```json
{
  "ok": true,
  "scope": {
    "cid": "course_789",
    "tid": "task_456"
  },
  "stats": {
    "localCount": 3,
    "serverMatchedCount": 2,
    "missingOnServerCount": 1,
    "tasksCount": 2
  },
  "missingOnServer": [
    {
      "cid": "course_789",
      "tid": "task_456",
      "questionId": "q_local_only",
      "description": "本地题库中存在但服务端尚未收录此题目，建议调用 /api/upload/batch 上传录入"
    }
  ],
  "matchedTasks": [
    {
      "taskId": "stem_1024",
      "taskType": "stem_request",
      "questionId": 1024,
      "uoocQuestionId": "q_abc123",
      "type": "single",
      "tid": "task_456",
      "taskName": "第一章测验",
      "cid": "course_789",
      "courseName": "高等数学",
      "description": "题目缺失题干文本内容，需补充题干"
    }
  ],
  "allowedTaskTypes": ["stem_request", "embedding_request", "options_request"]
}
```

### POST /api/automation/tasks/stem

回填题目的缺失题干文本。需要写权限（匿名 API Key 允许填补空题干；若题目已有题干则匿名用户不可覆盖）。更新后系统自动重算 `stemHash` 并尝试生成 `stemEmbedding`。

**请求体:**

```json
{
  "question_id": "1024",
  "stem": "以下关于矩阵初等变换的说法中正确的是？"
}
```

**响应:**

```json
{
  "ok": true,
  "questionId": 1024,
  "uoocQuestionId": "q_abc123",
  "stemUpdated": true,
  "embeddingCalculated": true
}
```

### POST /api/automation/tasks/embedding

为已有题干的题目写入或计算 1536 维向量。需要写权限。客户端可直接传入计算好的向量数组；若未传，服务端将调用配置的 Embedding API 进行计算。

**请求体:**

```json
{
  "question_id": "1025",
  "embedding": [0.0123, 0.0456, "... (共1536维浮点数)"]
}
```

**响应:**

```json
{
  "ok": true,
  "questionId": 1025,
  "uoocQuestionId": "q_abc124",
  "embeddingUpdated": true
}
```

---

## 健康检查

### GET /api/health

```json
{ "ok": true, "time": "2024-01-01T00:00:00.000Z" }
```

---

## 设备授权流端点 (RFC 8628 Device Authorization)

适用于无固定公网回调地址或本地重定向端口的浏览器扩展、油猴插件、CLI 终端或 Agent 客户端。

### 1. POST /api/auth/device/code

请求设备码与用户码。客户端无需预先注册 OAuth Client 或配置回调 URL。

**请求体:**

```json
{
  "client_id": "uooc-browser-plugin",
  "scope": "read write"
}
```

**响应:**

```json
{
  "device_code": "d_random_device_code_string...",
  "user_code": "ABCD-1234",
  "verification_uri": "http://localhost:4321/device",
  "verification_uri_complete": "http://localhost:4321/device?user_code=ABCD-1234",
  "expires_in": 1800,
  "interval": 5
}
```

- `device_code`: 客户端保密的设备凭证，后续用于轮询换取 Access Token。
- `user_code`: 供用户在 `/device` 页面核验或输入的简短验证码。
- `verification_uri_complete`: 预填了用户码的完整授权 URL，客户端可直接调用浏览器打开。
- `interval`: 客户端建议的轮询时间间隔（秒）。
- `expires_in`: 设备码有效时长（秒，默认 30 分钟）。

### 2. GET /api/auth/device?user_code=ABCD-1234

用户在浏览器打开 `/device` 时调用，用于核实用户码状态并将该设备码与当前登录的账号绑定认领。需携带用户 Session Cookie。

**响应:**

```json
{
  "user_code": "ABCD-1234",
  "status": "pending",
  "client_id": "uooc-browser-plugin",
  "scope": "read write"
}
```

### 3. POST /api/auth/device/approve

登录用户在 `/device` 页面点击“批准授权”时调用。需携带用户 Session Cookie。

**请求体:**

```json
{
  "userCode": "ABCD-1234"
}
```

**响应:**

```json
{
  "success": true
}
```

### 4. POST /api/auth/device/deny

用户在 `/device` 页面拒绝本次授权。

**请求体:**

```json
{
  "userCode": "ABCD-1234"
}
```

**响应:**

```json
{
  "success": true
}
```

### 5. POST /api/auth/device/token

客户端以 `interval` 为周期轮询兑换 Access Token。

**请求体:**

```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "device_code": "d_random_device_code_string...",
  "client_id": "uooc-browser-plugin"
}
```

**未完成授权时的响应 (HTTP 400):**

- 用户尚未批准：`{ "error": "authorization_pending", "error_description": "..." }`
- 轮询过快：`{ "error": "slow_down", "error_description": "..." }`
- 用户拒绝：`{ "error": "access_denied", "error_description": "..." }`
- 凭证过期：`{ "error": "expired_token", "error_description": "..." }`

**授权成功时的响应 (HTTP 200):**

```json
{
  "access_token": "s_session_token_xyz...",
  "token_type": "Bearer",
  "expires_in": 2678400,
  "scope": "read write"
}
```

获取到 `access_token` 后，客户端在随后的所有 API 请求头附带：
`Authorization: Bearer <access_token>`
即可直接继承该认证用户身份发起所有业务调用（包括答案修改与覆盖写入）。

---

## 认证端点

### ALL /api/auth/*

由 better-auth 处理，包括：

- `GET /api/auth/session` — 获取当前会话
- `POST /api/auth/sign-in/social` — OAuth 登录
- `POST /api/auth/sign-in/anonymous` — 匿名登录
- `POST /api/auth/device/code` — 请求设备授权码
- `POST /api/auth/device/token` — 兑换设备授权 Token
- `GET /api/auth/device` — 核验设备码
- `POST /api/auth/device/approve` — 批准设备授权
- `POST /api/auth/device/deny` — 拒绝设备授权
- `POST /api/auth/agent/approve-capability` — Agent Auth 授权
- `POST /api/auth/sign-out` — 退出

---

## MCP 端点

### POST /mcp

MCP Streamable HTTP 传输端点。详见 [MCP 接入指南](./mcp-integration.md)。
