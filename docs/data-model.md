# 数据模型与设计规范 (Data Model & Schema Design)

本文档详细描述 UOOC QA Share 平台的数据结构、实体关系、三级题目匹配策略、答案互斥与覆盖逻辑，以及多层级用户权限模型。

---

## 1. 实体关系图 (ER Diagram)

```
┌────────────────┐           ┌──────────────────┐
│    courses     │ 1       * │   task_groups    │
│  (cid, name)   ├───────────►  (tid, cid, ...) │
└────────────────┘           └─────────┬────────┘
                                       │ 1
                                       │ *
                             ┌─────────▼────────┐
                             │    questions     │
                             │ (id, tid, qid,   │
                             │  stem, options)  │
                             └─────────┬────────┘
                                       │ 1
                                       │ *
┌────────────────┐           ┌─────────▼────────┐
│     users      │ 1       * │     answers      │
│ (id, role, ..) ├───────────► (id, values,     │
└────────────────┘           │  is_correct)     │
                             └──────────────────┘
```

---

## 2. 核心数据表定义 (PostgreSQL + Drizzle)

### 2.1 课程表 (`courses`)

| 字段         | 类型        | 约束        | 说明              |
| ------------ | ----------- | ----------- | ----------------- |
| `cid`        | `text`      | PRIMARY KEY | UOOC 课程唯一标识 |
| `name`       | `text`      | NULLABLE    | 课程名称          |
| `updated_at` | `timestamp` | NOT NULL    | 更新时间戳        |

### 2.2 题组表 (`task_groups`)

| 字段         | 类型        | 约束                          | 说明                                      |
| ------------ | ----------- | ----------------------------- | ----------------------------------------- |
| `tid`        | `text`      | PRIMARY KEY                   | UOOC 题组唯一标识（测验、作业或考试单元） |
| `cid`        | `text`      | NOT NULL, FK → `courses(cid)` | 所属课程编号                              |
| `name`       | `text`      | NULLABLE                      | 题组名称（如“第一章单元测验”）            |
| `updated_at` | `timestamp` | NOT NULL                      | 更新时间戳                                |

### 2.3 题目表 (`questions`)

| 字段             | 类型           | 约束                              | 说明                                                                               |
| ---------------- | -------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `id`             | `serial`       | PRIMARY KEY                       | 内部自增主键                                                                       |
| `tid`            | `text`         | NOT NULL, FK → `task_groups(tid)` | 所属题组编号                                                                       |
| `question_id`    | `text`         | NOT NULL                          | UOOC 题单真实题目 ID（对应 `/exam/getTaskPaper` 接口返回的 `data.questions[].id`） |
| `type`           | `text`         | NOT NULL                          | 题型：`single` / `multiple` / `judge` / `text`                                     |
| `stem`           | `text`         | NULLABLE                          | 题干纯文本内容（严禁包含 HTML 标签；包含 HTML 标签的请求将被拒绝）                 |
| `stem_hash`      | `text`         | NULLABLE, INDEX                   | 规范化题干哈希（去除 HTML、折叠空格、全小写后求 SHA-256）                          |
| `stem_embedding` | `vector(1536)` | NULLABLE                          | 词向量（用于语义相似度搜索与未配对匹配）                                           |
| `options`        | `jsonb`        | NULLABLE                          | 选项列表 `[{"id": "A", "text": "..."}]`（判断题固定为 A. 正确与 B. 错误）          |
| `blanks`         | `integer`      | NOT NULL, DEFAULT 0               | 填空题空数（对应填空题 values 数组长度）                                           |
| `created_at`     | `timestamp`    | NOT NULL                          | 创建时间                                                                           |
| `updated_at`     | `timestamp`    | NOT NULL                          | 更新时间                                                                           |

**重要约束与实现规范**：

- `(tid, question_id)` 建立唯一索引，保证同一题组内真实单题 ID 唯一；同时在 `question_id` 建立独立索引加速单题检索。
- **HTML 标签过滤与强校验**：题干（`stem`）与选项文本（`options[].text`）必须在客户端预先清洗过滤 HTML 标签。服务端会严格检查题干与选项，**对未过滤 HTML 标签（如 `<p>`, `<span>`, `<br>` 等）的请求一律返回 HTTP 400 拒绝**。
- **题型与答案数据合规性校验**：
  - **选择题**（单选/多选）：答案 `values[]` 严禁出现重复项，且每项必须在当前题目的 `options[].id` 范围内（单选题在未确认唯一正确答案前，支持上传包含多个已标记错误项或试错项的数组）；
  - **判断题**：答案 `values[]` 有且只能为 1 个布尔值（或标准布尔表示）；
  - **填空题**：不得携带 `options`；若声明了 `blanks > 0`，`values[]` 长度必须与 `blanks` 一致，且每项不得为空字符串。
    不符合上述格式要求的请求一律返回 HTTP 400 拒绝入库。
- **单题真实 ID 规范**：`question_id` 必须存储 UOOC 题单在服务端维度的真实单题 ID（即 `data.questions[].id`），严禁使用临时 DOM 序列号或带有随机偏移的前端编号。
- **临时保存获取无混淆题单**：UOOC 页面在直接渲染时可能存在题序或选项顺序混淆。集成端应先执行一次任意试卷答案的临时保存（提交草稿），再调用 `GET https://www.uooc.net.cn/exam/getTaskPaper?tid={tid}` 获取服务端下发的无混淆标准题单（含 `data.questions[].id` 与当前已选项）。
- **文本比对机制**：选项的字母标签（A/B/C/D）可能在不同作答批次或不同账号间随机打乱。集成端必须结合题干与选项实际文本内容（`options` 的 `text` 或 `options_app` 的 `value`）进行精确比对，通过答案内容反查当前页面的实际选项字母，严禁仅凭字母下标硬编码勾选。

### 2.4 答案记录表 (`answers`)

| 字段           | 类型        | 约束                           | 说明                                                                                                                                                                                                                                                                                                   |
| -------------- | ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`           | `serial`    | PRIMARY KEY                    | 答案记录主键                                                                                                                                                                                                                                                                                           |
| `question_id`  | `integer`   | NOT NULL, FK → `questions(id)` | 关联题目内部主键                                                                                                                                                                                                                                                                                       |
| `values`       | `jsonb`     | NOT NULL                       | 答案内容约定：<br>1. **单选/多选题**：仅保存对应的 `options[].id` 数组（如 `["A"]` 或 `["A", "C"]`），不重复存储选项文本内容；<br>2. **判断题**：以唯一的 boolean 项存储（如 `[true]` 或 `[false]`）；<br>3. **填空题**：支持 `values[]` 数组，其标号对应填空的空数（如 `["第1空答案", "第2空答案"]`） |
| `source`       | `text`      | NOT NULL, DEFAULT 'user'       | 来源标识 (`user` / `plugin` / `mcp`)                                                                                                                                                                                                                                                                   |
| `submitted_by` | `text`      | NULLABLE, FK → `users(id)`     | 提交用户 ID (匿名用户为 null)                                                                                                                                                                                                                                                                          |
| `confidence`   | `real`      | NOT NULL, DEFAULT 0.5          | 置信度 (0.0 ~ 1.0)                                                                                                                                                                                                                                                                                     |
| `is_correct`   | `boolean`   | NOT NULL                       | `true`: 已确认的正确答案；`false`: 已排除的错误答案                                                                                                                                                                                                                                                    |
| `created_at`   | `timestamp` | NOT NULL                       | 创建时间                                                                                                                                                                                                                                                                                               |
| `updated_at`   | `timestamp` | NOT NULL                       | 更新时间                                                                                                                                                                                                                                                                                               |

### 2.5 设备授权码表 (`device_code`)

用于支持 RFC 8628 设备授权流，供无回调地址的浏览器扩展、插件或外部 Agent 换取 Session Bearer Token：

| 字段               | 类型        | 约束                      | 说明                                    |
| ------------------ | ----------- | ------------------------- | --------------------------------------- |
| `id`               | `text`      | PRIMARY KEY               | 设备授权记录 ID                         |
| `device_code`      | `text`      | NOT NULL, UNIQUE, INDEX   | 客户端保密的设备码                      |
| `user_code`        | `text`      | NOT NULL, UNIQUE, INDEX   | 供用户在 `/device` 页面填写的简短用户码 |
| `user_id`          | `text`      | NULLABLE, FK → `user(id)` | 授权用户的 ID（核验/认领后绑定）        |
| `status`           | `text`      | NOT NULL                  | 状态：`pending` / `approved` / `denied` |
| `expires_at`       | `timestamp` | NOT NULL                  | 设备码过期时间（默认 30 分钟）          |
| `last_polled_at`   | `timestamp` | NULLABLE                  | 客户端上次轮询时间（用于频率控制限速）  |
| `polling_interval` | `integer`   | NULLABLE                  | 客户端轮询间隔（毫秒）                  |
| `client_id`        | `text`      | NULLABLE                  | 申请授权的客户端标识符                  |
| `scope`            | `text`      | NULLABLE                  | 申请的权限范围                          |

---

## 3. 题目匹配与去重三级策略 (Matching Hierarchy)

当插件批量上传或前端提交题目数据时，系统按以下三级策略逐层匹配，解决 DOM 标识变动、题目乱序及重新生成的匹配问题：

```
                    ┌────────────────────────────┐
                    │      新题目数据传入        │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                   【第 1 级】：Direct ID Match
               (tid + question_id 是否完全匹配？)
                                  ├─ 是 ──► 命中已有题目！
                                  │
                                  ▼ 否
                   【第 2 级】：Stem Hash Match
           (stem 去除 HTML 规范化后的 SHA-256 哈希是否一致？)
                                  ├─ 是 ──► 命中已有题目！
                                  │
                                  ▼ 否
                   【第 3 级】：Vector Semantic Match
        (在同题组内计算 stem_embedding 余弦相似度是否 ≥ 0.85？)
                                  ├─ 是 ──► 命中已有题目！
                                  │
                                  ▼ 否
                     判定为新题目，插入数据库
```

---

## 4. 答案更新、互斥与清洗逻辑

1. **错误项自动淘汰**：
   当某题目录入 `correct_answers`（确认正确答案）时，服务端会自动执行：

   ```sql
   DELETE FROM answers WHERE question_id = ? AND is_correct = false;
   ```

   旧的错误答案排除标记已失去价值，立即被清理，减小存储负担。

2. **错误选项聚合**：
   在尚未获得正确答案的前提下，客户端多次试错提交的 `wrong_answers` 会被去重合并记录。

3. **权限控制**：
   - **匿名访问 (Anonymous)**：
     - 允许提交新题目的答案（若此前无答案）；
     - 允许追加未确认题目的错误项；
     - **禁止**覆盖已有的正确答案（返回 `denied_anonymous_overwrite`）。
   - **OAuth 认证用户 (GitHub / bili-sign)**：
     - 拥有完整权限；
     - 当发现题库中历史答案有误或题目更新时，新提交的标准答案会直接覆盖旧答案。

---

## 5. 题型与答案表现映射规范

| 题型 (`type`)       | 前端渲染            | `options` 结构                                        | `values` 格式示例与约定                                                                                     |
| ------------------- | ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `single` (单选题)   | 单选框组 (Radio)    | `[{"id":"A","text":"..."},{"id":"B","text":"..."}]`   | `["A"]`（仅保存选项 ID，不保存实际选项文本）                                                                |
| `multiple` (多选题) | 复选框组 (Checkbox) | `[{"id":"A","text":"..."},{"id":"B","text":"..."}]`   | `["A", "C"]`（仅保存选项 ID 数组，不保存实际选项文本）                                                      |
| `judge` (判断题)    | 二元单选题 (是/否)  | `[{"id":"A","text":"正确"},{"id":"B","text":"错误"}]` | `[true]` 或 `[false]`（永远只有 A. 正确、B. 错误两个选项，以唯一的 boolean 项存储）                         |
| `text` (填空题)     | 多文本框 (Textarea) | `null`                                                | `["第一空答案", "第二空答案"]`（支持 values[] 数组，其标号对应该题目提供的填空空数，blanks 对应填空总空数） |

---

## 6. 自动任务列表与缺失数据补全机制

平台数据库中题目的部分字段属于**可选富化字段**（如 `stem`、`stem_embedding`、`options`），交卷或者爬取初期可能仅能获得部分数据。系统提供基于数据库缺失数据动态计算的**自动任务模型**：

```
                    ┌────────────────────────────┐
                    │      数据库题目现状检测      │
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
    stem IS NULL            stem IS NOT NULL          options IS NULL
         │                 stem_embedding IS NULL          │
         ▼                        ▼                        ▼
【stem_request】           【embedding_request】       【options_request】
  (缺失题干请求)              (缺失向量计算请求)           (缺失选项补充请求)
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
                    ┌────────────────────────────┐
                    │   按调用方写权限级别过滤   │
                    │ (Anonymous / Authenticated)│
                    └────────────────────────────┘
```

### 6.1 任务分类与触发规则

1. **题干补充请求 (`stem_request`)**：
   - 条件：`stem IS NULL OR stem = ''`
   - 目标：从试卷页面补全完整题干原文。
   - 权限要求：基础写权限（匿名 API Key 即可补全；但若已有题干则匿名无法覆盖）。
2. **向量计算请求 (`embedding_request`)**：
   - 条件：`stem IS NOT NULL AND stem != '' AND stem_embedding IS NULL`
   - 目标：为题干计算 1536 维词向量。客户端可直接上传本地向量，或触发服务端模型异步生成。
   - 权限要求：基础写权限（匿名 API Key / 认证用户）。
3. **选项补充请求 (`options_request`)**：
   - 条件：`type IN ('single', 'multiple', 'judge') AND options IS NULL`
   - 目标：补全选择题或判断题的选项列表。
   - 权限要求：基础写权限。
4. **答案征集请求 (`answer_request`)**：
   - 条件：不存在 `isCorrect = true` 的关联答案记录。
   - 目标：征集并通过官方评测回传正确的标准答案。
   - 权限要求：高级认证权限（需登录认证用户，避免低信誉覆盖污染）。
