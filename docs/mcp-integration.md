# MCP 协议接入指南 (Model Context Protocol Integration)

UOOC QA Share 平台内置了基于 Streamable HTTP 协议的高性能 MCP（Model Context Protocol）服务，支持跨域（CORS）访问。用户可以通过各类支持 MCP 的 AI Agent 软件（如 Claude Desktop、Cursor、Cline、Windsurf、自建 Agent 等），直接在本地分析包含答案的试题文件（PDF、截图、试卷文本），自动清洗并一键入库。

---

## 1. 服务端点与协议

- **MCP 访问地址**：`http://localhost:4321/mcp`（生产环境替换为实际部署域名）
- **通信协议**：MCP Streamable HTTP Transport（支持标准 POST JSON-RPC 消息与 GET SSE 事件流）
- **认证机制**：
  - **Agent Auth 协议**：服务发布 Agent 发现配置于 `/.well-known/agent-configuration`，Agent 可通过临时短期签署的 JWT 进行鉴权，平台自动授予临时匿名/自主用户态。
  - **MCP OAuth 2.1 规范**：支持 RFC 9728 `/.well-known/oauth-protected-resource` 元数据发现。
  - **API Key 快捷鉴权**：在请求头附加 `x-api-key: uooc_...`，平台即可挂载对应的用户状态。
- **跨域支持**：默认开启全域 CORS（`Access-Control-Allow-Origin: *`），允许跨域 Web 应用、浏览器扩展及本地桌面客户端直接连接。

---

## 2. 客户端配置指南

### 2.1 Claude Desktop 配置

在 Claude Desktop 的配置文件 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "uooc-qa-share": {
      "url": "http://localhost:4321/mcp"
    }
  }
}
```

### 2.2 Cursor / Windsurf / Cline 配置

在 Agent 工具设置中添加自定义 MCP Server：

- **Name**: `uooc-qa-share`
- **Type**: `sse` / `http`
- **Server URL**: `http://localhost:4321/mcp`

---

## 3. 内置 MCP 工具清单 (Tools)

平台注册了以下 9 个核心工具供 Agent 调度：

### 3.1 `search_questions`

- **描述**：按题干关键词或语义向量搜索题库中的题目及其答案。支持基于 PostgreSQL pgvector 的词向量语义检索与 ILIKE 文本模糊回退。若客户端传入本地计算的 1536 维向量，服务端直接进行相似度检索，不调用服务端 embedding 模型。
- **参数**：
  - `query` (string, optional): 搜索内容或关键词。
  - `embedding` (array of numbers, optional): 本地计算的 1536 维词向量。传入时跳过服务端向量计算，直接进行向量相似度匹配。

### 3.2 `get_task_answers`

- **描述**：获取某个题组（`tid`）下已收录的全部题目及其答案（包含正确答案与已排除的错误答案）。
- **参数**：
  - `tid` (string, required): UOOC 题组 ID。

### 3.3 `get_question_answer`

- **描述**：获取单个题目详情与答案记录。
- **参数**：
  - `question_id` (string, required): 题目内部数字 ID 或 UOOC `question_id` 字符串。

### 3.4 `get_course_tasks`

- **描述**：获取某个课程（`cid`）下所有已收录的题组列表。
- **参数**：
  - `cid` (string, required): UOOC 课程 ID。

### 3.5 `upload_answers`

- **描述**：批量上传清洗后的题目及答案。
- **参数**：
  - `data` (string, required): 符合平台规范的 JSON 格式字符串。
- **输入 JSON 结构**：
  ```json
  {
    "tid": "100234",
    "cid": "2048",
    "task_name": "第3章测验",
    "course_name": "高等数学",
    "questions": [
      {
        "question_id": "1",
        "type": "single",
        "stem": "关于极限...",
        "options": [
          { "id": "A", "text": "选项A" },
          { "id": "B", "text": "选项B" }
        ],
        "correct_answers": ["A"],
        "wrong_answers": null
      }
    ]
  }
  ```

### 3.6 `list_pending_tasks`

- **描述**：列出数据库中缺失可选数据（题干、向量、选项、答案等）的待补全自动任务列表，Agent 可根据返回的任务列表自主执行数据清洗与补全。
- **参数**：
  - `type` (string, optional): 任务类型过滤 (`all` / `stem_request` / `embedding_request` / `options_request` / `answer_request`)。
  - `tid` (string, optional): 过滤特定题组 ID。
  - `limit` (number, optional): 获取数量限制（默认 20，最大 100）。

### 3.7 `fulfill_stem_task`

- **描述**：为缺失题干的题目补全完整题干文本内容，平台将自动计算 `stem_hash` 并生成词向量。
- **参数**：
  - `question_id` (string, required): 内部题目 ID 或 UOOC `question_id`。
  - `stem` (string, required): 完整的题干文本（可包含原始 HTML 标签）。

### 3.8 `fulfill_embedding_task`

- **描述**：为已有题干但缺失向量的题目生成或补充 1536 维词向量。
- **参数**：
  - `question_id` (string, required): 内部题目 ID 或 UOOC `question_id`。
  - `embedding` (array of numbers, optional): 可选的 1536 维浮点数向量；若未提供，服务端将自动调用配置的模型生成。

### 3.9 `match_question_bank`

- **描述**：将本地维护的题库 ID 表与服务端比对：支持优先通过 `cid`（课程 ID）、可选 `tid` 缩小范围减少传输，确认服务端是否缺失题目并过滤出匹配的待补全任务。
- **参数**：
  - `cid` (string, optional): UOOC 课程 ID（推荐提供，优先过滤课程以极大压缩 body 体积）。
  - `tid` (string, optional): UOOC 题组 ID（可选）。
  - `local_question_ids` (array of strings, optional): 本地题目 ID 数组。
  - `items` (array of objects, optional): 包含 `tid` 和 `question_id` 的对象数组。
  - `task_types` (array of strings, optional): 可选任务类型过滤数组。
  - `limit` (number, optional): 返回条数限制（默认 50）。

---

## 4. 内置 Prompt 模板 (Prompts)

平台注册了系统提示词模板 `analyze_and_upload_qa`，供支持 Prompt 的 MCP 客户端直接唤起。

### 唤起方式

Agent 可直接调用 Prompt: `analyze_and_upload_qa`，传入参数：

- `tid`: 题组 ID（必填）
- `cid`: 课程 ID（可选）
- `course_name`: 课程名称（可选）
- `task_name`: 题组名称（可选）

### Prompt 核心内容

```text
你是一个专业的 UOOC（优课联盟）题目数据清洗与录入专家。
请分析用户提供的文件（PDF文档、截图标注、网页抓取文本等），提取该题组的所有题目，并通过工具 "upload_answers" 上传到题库平台。

【提取与清洗要求】
1. 题目识别：
   - 提取每道题的 question_id（若无显式 ID，使用序号如 "1", "2"）。
   - 判断题型 type: single (单选) / multiple (多选) / judge (判断) / text (填空)。
   - 题干 stem: 尽可能提取完整题干，若包含 HTML 标签请保留。
   - 选项 options: 对单选题/多选题/判断题，提取选项列表 [{ id: "A", text: "..." }, ...]。
2. 答案识别：
   - 若题目已确认正确答案，提取为 correct_answers（单选/判断如 ["A"]，多选如 ["A","C"]，填空如 ["第1空","第2空"]）。
   - 若题目无正确答案但已知某些选项错误，提取为 wrong_answers（如 ["B","D"]）。
3. 清洗完成后，直接调用 upload_answers 工具提交入库。
```

---

## 5. 典型 Agent 交互场景

用户可以在 Agent 软件中说：

> "帮我分析这份刚导出的高数第三章测验解析 PDF，里面的题目对应的 UOOC 题组 tid 是 10452。请清洗成规范题目并通过 MCP 上传到我的题库中。"

Agent 会自动：

1. 本地阅读 PDF 文本与图片；
2. 识别题目类型、题干 HTML 标签、选项列表与标准答案；
3. 调用 `upload_answers` 工具执行入库；
4. 反馈入库结果（新增正确答案数、排除错误选项数）。
