# API 参考

所有 API 端点均在 `/api/` 路径下。支持 CORS 跨域访问。

## 认证

- **Cookie 认证**: 浏览器自动携带
- **Bearer Token**: 在 `Authorization: Bearer <token>` 头中携带会话令牌（适用于 API 调用）

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
