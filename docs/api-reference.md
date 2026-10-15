# API 参考

所有 API 端点均在 `/api/` 路径下。支持 CORS 跨域访问。

## 认证与 API Key

- **Cookie 认证**: 浏览器与 Webview 自动携带，Session 有效期为 31 天。
- **API Key 认证**: 适用于自动化插件与外部调用。在 HTTP 请求头中传入 `x-api-key: <key>` 或 `Authorization: Bearer <key>`。
- **Webview 免密注入**: 软件型插件（如 Tauri / Electron 应用）内部 Webview 可直接通过 URL 携带 `?apiKey=...`、或在页面加载前注入 `window.__UOOC_API_KEY__` 或设置 Cookie `apiKey`，平台自动完成免密登录并持久化。
- **自动匿名注册与下发 API Key**:
  - `POST /api/auth/anonymous-key`：插件调用的专用 Auth API，自动完成基于 Better Auth Anonymous 插件的匿名注册并下发持久 `apiKey`。业务上传接口（如 `/api/upload/batch`）不负责写 Auth 数据库，插件应先通过该 Auth 接口或登录获取凭据。
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

搜索题目。支持向量语义搜索（需配置 embedding API）和 ILIKE 文本匹配回退。

**参数:**

- `q` — 搜索关键词
- `exact=1` — 使用 stem_hash 精确匹配（可选）

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

## 健康检查

### GET /api/health

```json
{ "ok": true, "time": "2024-01-01T00:00:00.000Z" }
```

---

## 认证端点

### ALL /api/auth/*

由 better-auth 处理，包括：

- `GET /api/auth/session` — 获取当前会话
- `POST /api/auth/sign-in/social` — OAuth 登录
- `POST /api/auth/sign-in/anonymous` — 匿名登录
- `POST /api/auth/sign-out` — 退出

---

## MCP 端点

### POST /mcp

MCP Streamable HTTP 传输端点。详见 [MCP 接入指南](./mcp-integration.md)。
