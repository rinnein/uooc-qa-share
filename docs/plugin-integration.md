# 插件接入指南 (Plugin Integration Guide)

本指南针对想要接入 UOOC 题库共享平台的各类自动化答题、辅助答题插件与客户端应用（如 `fuckuooc`、`your-szu-life` 等），详细说明完整的交互协议、工作流程以及代码示例。

---

## 目录

1. [核心交互设计与生命周期](#1-核心交互设计与生命周期)
2. [环境准备与配置](#2-环境准备与配置)
3. [答题前检索与答案决断流程](#3-答题前检索与答案决断流程)
   - 3.1 命中正确答案：直接作答
   - 3.2 命中错误答案：概率剪枝与排除
   - 3.3 未命中任何答案：fallback 机制
4. [答题后数据回传流程](#4-答题后数据回传流程)
   - 4.1 正确答案与错误答案的数据格式
   - 4.2 从 UOOC 官方接口获取提交后标准答案
5. [空闲时题库巡检与同步机制 (Idle Sync)](#5-空闲时题库巡检与同步机制-idle-sync)
6. [项目集成实战：fuckuooc (Node.js)](#6-项目集成实战-fuckuooc-nodejs)
7. [项目集成实战：your-szu-life (TypeScript / Rust)](#7-项目集成实战-your-szu-life-typescript--rust)

---

## 1. 核心交互设计与生命周期

题库共享平台为客户端插件提供双向赋能：

1. **题库消费**：在做题前查询题库，优先使用经过验证的标准答案；若暂无正确答案，则排除已知的错误选项，大幅收窄候选空间（对于单选题排除 1~2 个选项，对于多选题可剪枝大部分无效排列）。
2. **题库回流**：无论是通过 AI 识别、人工录入、暴力尝试还是交卷后在 UOOC 查看到的标准答案，均以规范格式批量回传平台。
3. **众包同步**：插件在空闲等待时，主动比对本地已知已学课程与服务端题库，将已完成但服务端缺失答案的题组数据自动补齐。

```
                    ┌─────────────────────────┐
                    │      UOOC 官方平台       │
                    └───────────┬─────────────┘
                                │ 抓取题目/交卷后查分
                                ▼
                     ┌───────────────────────┐
                     │   插件客户端 (Plugin)  │
                     └───────▲───────┬───────┘
            1. 查题/剪枝      │       │ 2. 回传正确/错误答案
       (GET /api/tasks/:tid) │       │ (POST /api/upload/batch)
                             │       ▼
                    ┌─────────────────────────┐
                    │  UOOC QA Share 共享平台 │
                    └─────────────────────────┘
```

---

## 2. 环境准备与鉴权凭据配置

客户端插件需在配置项中增加题库服务器地址与鉴权凭证：

| 配置项       | 环境变量/配置文件字段 | 示例值                          | 说明                                      |
| ------------ | --------------------- | ------------------------------- | ----------------------------------------- |
| 服务端基地址 | `QA_SERVER_URL`       | `http://localhost:4321`         | 平台 API 根路径                           |
| API Key 凭证 | `QA_SERVER_API_KEY`   | `uooc_...` (自动申请或登录生成) | 插件的持久凭据；可直接鉴权，有效期 365 天 |

---

### 2.1 认证模式与权限对比

平台对不同身份提供差异化的答案管控策略：

| 身份类型           | 凭证来源                                             | 读权限 (查题/剪枝) | 新题写入 | 历史答案覆盖/修改                                          |
| ------------------ | ---------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------------- |
| **OAuth 认证用户** | 用户在插件内点击登录完成 OAuth（GitHub / bili-sign） | ✅ 允许            | ✅ 允许  | ✅ **允许**（发现错误时可直接纠正旧答案）                  |
| **匿名账号用户**   | 插件未配置时自动通过 Auth API 申请的专属账号         | ✅ 允许            | ✅ 允许  | ❌ **拒绝**（防刷机制，返回 `denied_anonymous_overwrite`） |

---

### 2.2 方案一：在设置中通过 OAuth 预先登录（推荐正式用户）

若插件支持用户交互界面（如桌面客户端 `your-szu-life` 或命令行引导）：

1. **提供登录入口**：在插件“设置”或“题库同步”面板中放置 **“登录题库共享平台”** 按钮。
2. **拉起 OAuth 流程**：点击后通过系统默认浏览器或内嵌 Webview 打开：
   - GitHub 登录：`http://your-qa-server.com/api/auth/sign-in/social?provider=github&callbackURL=...`
   - bili-sign 登录：`http://your-qa-server.com/api/auth/sign-in/social?provider=bili-sign&callbackURL=...`
3. **获取与存储 API Key**：登录成功后，前端或插件通过调用 `POST /api/auth/api-key/create` 为该插件签发一把专属 `API Key`，并持久化保存于本地配置中。
4. **享受全权限**：后续插件在请求头带上 `x-api-key: <key>` 时，所有上传操作均直接继承 OAuth 用户的正式更新权限。

---

### 2.3 方案二：未提前登录时的优雅降级（自动申请匿名账号）

如果用户在使用相关功能前**未**在设置内配置或登录，插件切勿弹窗阻断答题流程，而应自动静默降级为匿名账户：

1. **自动注册获取 Key**：插件检测到本地尚未保存 `QA_SERVER_API_KEY` 时，主动向 Auth 端点发送注册请求：
   ```http
   POST /api/auth/anonymous-key
   Host: your-qa-server.com
   ```
   服务端将基于 Better Auth Anonymous 插件自动生成匿名用户，并通过 API Key 插件签发专属 `apiKey`，返回：
   ```json
   {
     "ok": true,
     "apiKey": "uooc_8a9f...",
     "user": { "id": "user_xyz", "name": "Anonymous", "isAnonymous": true },
     "token": "..."
   }
   ```
2. **本地持久化存储**：插件收到后将 `apiKey` 回写到本地配置文件（如 `config.txt` 或 SQLite），后续每次重启均复用此 Key。
3. **正常发起业务请求**：在随后的所有业务 API（如上传试题 `POST /api/upload/batch`、查询试卷）中，只需在 HTTP 请求头附带：
   ```http
   x-api-key: uooc_8a9f...
   ```
   服务端即可识别该插件身份，Session 默认长达 31 天有效。上传接口保持纯粹，不混入 Auth 注册写库行为。

---

### 2.4 账号绑定、合并与升级机制（在账户面板操作）

即使用户初始使用了自动下发的匿名账号，未来也可以在 UOOC 账户面板或题库平台的个人中心随时完成绑定与升级，历史数据绝不丢失：

#### 场景 A：将当前匿名账号作为主账号直接绑定 OAuth

用户此前从未注册过题库账号。此时在账户中心点击 **“绑定 GitHub”** 或 **“绑定 bili-sign”**：

- 前端调用 `authClient.linkSocial({ provider: "github", callbackURL: "/login" })`；
- 原匿名用户账号在底层直接平滑升级为认证用户（`isAnonymous: false`）；
- 插件此前使用的 `API Key`、历史上传的全部试题记录与贡献数据**完整保留**，并立即可用覆盖更新权限。

#### 场景 B：将当前匿名账号合并到已有 OAuth 账户

若用户此前已经在其他设备上通过 OAuth 注册过正式题库账号：

- 用户在账户中心将当前匿名账号关联至已有账户时，Better Auth 触发 `onLinkAccount({ anonymousUser, newUser })` 钩子；
- **自动数据迁移**：服务端会在事务中自动将原匿名用户名下的全部答案提交记录（`answers` 表的 `submitted_by`）以及已签发的 API Key（`apikey` 表的 `reference_id`）所有权完整过户给已有正式账户；
- 插件无需重新配置或修改本地的 `API Key`，继续使用原有 Key 请求即可自动识别为正式认证用户！

---

### 2.5 客户端软件内部 Webview 免密集成

对于如 `your-szu-life` 等拥有独立桌面/手机客户端的插件，若希望在客户端内部以 Webview 展示题库前端界面：

- **方案 A（URL 传参自动登录）**：Webview 打开 `http://your-qa-server.com/?apiKey=uooc_8a9f...`，前端与服务端中间件会自动完成登录、写入长效 Cookie 并自动擦除 URL 中的敏感参数。
- **方案 B（窗口对象注入）**：在 Webview 初始化脚本中注入 `window.__UOOC_API_KEY__ = "uooc_8a9f...";`，前端启动时自动挂载登录态。

---

## 3. 答题前检索与答案决断流程

### 3.1 查询接口

进入某个测验节点（已知 `tid`）后，先向服务端请求该题组数据：

```http
GET /api/tasks/{tid}
Host: your-qa-server.com
```

如果同时已知课程号 `cid`，推荐使用带课程校验的接口：

```http
GET /api/courses/{cid}/tasks/{tid}
```

响应示例：

```json
{
  "taskGroup": { "tid": "100234", "cid": "2048", "name": "第3章单元测验" },
  "questions": [
    {
      "id": 12,
      "tid": "100234",
      "questionId": "q_100234_1",
      "type": "single",
      "stem": "关于微积分基本定理，下列说法正确的是？",
      "options": [
        { "id": "A", "text": "连续函数一定可积" },
        { "id": "B", "text": "可积函数一定连续" }
      ],
      "answers": [{ "id": 101, "values": ["A"], "isCorrect": true, "confidence": 1.0 }]
    },
    {
      "id": 13,
      "tid": "100234",
      "questionId": "q_100234_2",
      "type": "single",
      "answers": [
        { "id": 102, "values": ["C"], "isCorrect": false, "confidence": 0.5 },
        { "id": 103, "values": ["D"], "isCorrect": false, "confidence": 0.5 }
      ]
    }
  ]
}
```

### 3.2 客户端决断逻辑矩阵

对于当前正在作答的题目 `currentQuestion`：

1. **匹配题目**：
   - 首先依据 `questionId` 匹配服务端的题目；
   - 若本地与服务端未生成相同 `questionId`，使用题干文本进行比对，或调用 `GET /api/questions/search?q={stem}`。

2. **分析答案记录**：
   - 提取 `answers.filter(a => a.isCorrect)` 得到 **正确答案集合**；
   - 提取 `answers.filter(a => !a.isCorrect).flatMap(a => a.values)` 得到 **已排除错误项集合**。

3. **执行作答动作**：
   - **Case A (存在已确认正确答案)**：
     直接选用正确答案 `correctAnswer`，无需调用大模型，也不需要随机猜测。
   - **Case B (暂无正确答案，但存在已排除错误答案)**：
     将这道题的所有可用选项过滤：`candidateOptions = allOptions.filter(opt => !wrongAnswers.includes(opt.id))`。
     - 若调用 AI 模型作答：在 Prompt 中明确告知 `“已确认错误选项：B、D，请勿选择”`；
     - 若进入暴力试错/穷举：只在 `candidateOptions` 中生成组合，避免重复试错。
   - **Case C (完全无数据)**：
     按原插件逻辑执行（AI 识图答题或人工填写）。

### 3.4 单题语义检索与本地向量加速

当题组内按 `question_id` 未直接命中时，插件可通过全局题库语义搜索接口 `/api/questions/search` 查找跨题组或往年同源题。

若插件本地运行小模型或具备向量计算能力，**强烈建议直接在 `POST /api/questions/search` 请求体中附带 1536 维向量**：

```http
POST /api/questions/search
Content-Type: application/json

{
  "q": "题干文本内容...",
  "embedding": [0.0123, 0.0456, "... (共1536维浮点数)"],
  "limit": 5
}
```

- **零服务端模型开销**：服务端检测到已提供符合要求的 1536 维向量后，直接调用 pgvector 执行余弦相似度计算，**完全跳过服务端 embedding 模型生成**，响应通常在 10ms~30ms 内完成。
- **自动降级支持**：若未附带 `embedding`，服务端在配置有 Embedding API 时会自动生成向量，未配置时自动降级为 ILIKE 模糊文本检索。

---

## 4. 答题后数据回传流程

### 4.1 上传接口格式规范

通过 `POST /api/upload/batch` 上传。支持批量打包一个题组内的所有题目：

```http
POST /api/upload/batch
Content-Type: application/json
Authorization: Bearer <token> (可选)

{
  "tid": "100234",
  "cid": "2048",
  "task_name": "第3章单元测验",
  "course_name": "高等数学",
  "questions": [
    {
      "question_id": "q_100234_1",
      "type": "single",
      "stem": "关于微积分基本定理，下列说法正确的是？",
      "options": [
        { "id": "A", "text": "连续函数一定可积" },
        { "id": "B", "text": "可积函数一定连续" }
      ],
      "embedding": [0.0123, 0.0456, 0.0789],
      "correct_answers": ["A"],
      "wrong_answers": null
    },
    {
      "question_id": "q_100234_2",
      "type": "single",
      "stem": "若 f(x) 在区间 [a, b] 上连续...",
      "options": [
        { "id": "A", "text": "选项A" },
        { "id": "B", "text": "选项B" },
        { "id": "C", "text": "选项C" },
        { "id": "D", "text": "选项D" }
      ],
      "correct_answers": null,
      "wrong_answers": ["C", "D"]
    }
  ]
}
```

> **注意**：
>
> - 题干 `stem` 与 `options` 为可选字段。如果交卷时未解析完整题干，仅提供 `question_id`、`type` 与 `correct_answers` / `wrong_answers` 同样有效。
> - `embedding` 为可选字段，必须是与服务端 `vector(1536)` 兼容的 1536 维数字数组。插件已生成词向量时，建议随题目一并上传；服务端优先使用该向量。
> - 未提供 `embedding` 时，服务端仅在配置 `EMBEDDING_API_URL` 与 `EMBEDDING_API_KEY` 后才调用模型生成；未配置时不会发起模型请求，继续使用文本匹配回退。
> - 一旦某题目成功录入 `correct_answers`，服务端会自动清理该题目之前存储的全部错误答案排除记录。
> - 如果同一道题目已有正确答案，匿名用户上传会被忽略（`denied_anonymous_overwrite`），通过 OAuth 登录的用户则可直接更新覆盖。

### 4.2 从 UOOC 官方接口获取提交后标准答案

UOOC 测验交卷后，访问以下 URL 可直接获取标准答案与解析：

```
GET https://www.uooc.net.cn/exam/view?cid={cid}&tid={tid}
```

该页面或接口返回的数据中包含了官方的标准答案。插件在交卷成功后请求此接口，即可一次性获得该测验全部题目的 100% 正确答案，直接调用 `/api/upload/batch` 上传题库。

---

## 5. 空闲时题库巡检与同步机制 (Idle Sync)

为了建立完整的全校/全联盟题库生态，建议接入的插件在后台闲置、等待验证码或任务间隙时执行自动巡检：

### 巡检逻辑

1. **获取用户课程列表**：调用 UOOC 接口获取当前登录账号已参加的所有课程列表（`cid` 列表）。
2. **拉取服务端题组索引**：
   调用 `GET /api/courses/{cid}` 获取题库中该课程已收录的 `tid` 列表。
3. **比对本地完成状态**：
   检查用户在 UOOC 平台已完成但服务端**缺失完整正确答案**的测验：
   - 若某 `tid` 在服务端不存在，或题目的正确答案覆盖率 < 100%：
   - 客户端携带用户的 UOOC Cookie，后台请求 `https://www.uooc.net.cn/exam/view?cid={cid}&tid={tid}`；
   - 解析出已交卷试卷中的题目与标准答案；
   - 打包调用 `POST /api/upload/batch` 同步至题库平台。

### 5.3 空闲时自动任务认领与富化 (Automation Tasks)

除了题组级同步外，插件或挂载的 Background Worker 还可以在空闲阶段拉取服务端针对题目的细粒度缺失数据补全任务：

```http
GET /api/automation/tasks?limit=20
x-api-key: uooc_...
```

- 服务端会根据当前 API Key 权限级别，仅返回该账号能执行的任务（例如匿名 Key 会返回 `stem_request` 与 `embedding_request`）。
- **题干缺失任务 (`stem_request`)**：当插件发现本地缓存或当前页面有题干文本时，直接调用 `POST /api/automation/tasks/stem` 提交回填。
- **向量计算任务 (`embedding_request`)**：对于有本地 embedding 运行能力的客户端，直接计算 1536 维向量并通过 `POST /api/automation/tasks/embedding` 回传，降低中心服务器计算负载。

### 5.4 本地题库 ID 表匹配与缺失确认 (Bank Matching)

当插件本地维护了一张已抓取的题目 ID 清单时，可在做题或空闲时调用匹配接口，**优先通过 `cid` 划分作用域**，将比对限制在指定课程内，极大减少每次发送的 body 体积：

```http
POST /api/automation/match
Content-Type: application/json
x-api-key: uooc_...

{
  "cid": "678",
  "local_question_ids": ["q101", "q102", "q103"]
}
```

**响应价值**：

1. **确认服务端是否缺失题目**：返回的 `missingOnServer` 明确列出本地存在但服务端尚未收录的题目，插件可立即调用 `/api/upload/batch` 上传补充，实现全网题库生态众包补全。
2. **过滤匹配的任务列表**：返回的 `matchedTasks` 仅包含本地题库中确实存在、但在服务端缺失题干/向量/选项/答案的任务，避免全量遍历整个题库。

---

## 6. 项目集成实战：fuckuooc (Node.js)

针对 `/home/rinne/project-contribute/fuckuooc` 项目，建议新增 `utils/qa-client.js` 并接入 `utils/quiz.js`。

### 6.1 实现 Client 模块 (`utils/qa-client.js`)

```javascript
// utils/qa-client.js
const fs = require("fs");
const path = require("path");

const QA_SERVER = process.env.UOOC_QA_SERVER || "http://localhost:4321";
let QA_API_KEY = process.env.UOOC_QA_API_KEY || "";

/**
 * 获取或自动申请 API Key：
 * 1. 若配置中已有（OAuth 登录生成或此前已下发），直接使用；
 * 2. 若未配置，自动调用 /api/auth/anonymous-key 注册匿名账号并回写保存。
 */
async function ensureApiKey() {
  if (QA_API_KEY) return QA_API_KEY;

  try {
    const res = await fetch(`${QA_SERVER}/api/auth/anonymous-key`, {
      method: "POST",
    });
    const data = await res.json();
    if (data?.ok && data?.apiKey) {
      QA_API_KEY = data.apiKey;
      console.log(`[QA-Share] 已自动申请匿名账户凭证: ${QA_API_KEY.slice(0, 15)}...`);

      // 回写到本地 config.txt 以便持久复用
      const cfgPath = path.join(__dirname, "..", "config.txt");
      if (fs.existsSync(cfgPath)) {
        fs.appendFileSync(cfgPath, `\nQA_SERVER_API_KEY=${QA_API_KEY}\n`);
      }
      return QA_API_KEY;
    }
  } catch (e) {
    console.warn(`[QA-Share] 自动申请 API Key 失败: ${e.message}`);
  }
  return "";
}

async function fetchTaskAnswers(tid, cid) {
  try {
    const apiKey = await ensureApiKey();
    const url = cid
      ? `${QA_SERVER}/api/courses/${cid}/tasks/${tid}`
      : `${QA_SERVER}/api/tasks/${tid}`;

    const headers = {};
    if (apiKey) headers["x-api-key"] = apiKey;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data.questions || [];
  } catch (err) {
    console.warn(`[QA-Share] 获取题库失败: ${err.message}`);
    return null;
  }
}

async function uploadTaskResults(payload) {
  try {
    const apiKey = await ensureApiKey();
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const res = await fetch(`${QA_SERVER}/api/upload/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    console.log(`[QA-Share] 上传题目结果: ${JSON.stringify(result.results?.map((r) => r.action))}`);
    return result;
  } catch (err) {
    console.warn(`[QA-Share] 上传题库失败: ${err.message}`);
    return null;
  }
}

// generateEmbedding 由插件使用自己的词向量模型实现；返回值必须是 1536 维数组。
async function addEmbeddings(questions, generateEmbedding) {
  return Promise.all(
    questions.map(async (question) => ({
      ...question,
      embedding: question.stem ? await generateEmbedding(question.stem) : undefined,
    })),
  );
}

module.exports = { fetchTaskAnswers, uploadTaskResults, ensureApiKey, addEmbeddings };
```

### 6.2 在 `utils/quiz.js` 中接入

在 `processQuizQuestions` 执行前查询题库：

```javascript
const { fetchTaskAnswers, uploadTaskResults, addEmbeddings } = require("./qa-client");

// 1. 做题前查询已知答案
const knownQuestions = await fetchTaskAnswers(tid, courseId);
const knownMap = new Map();
if (knownQuestions) {
  for (const kq of knownQuestions) {
    const correct = kq.answers?.find((a) => a.isCorrect);
    const wrongs = kq.answers?.filter((a) => !a.isCorrect).flatMap((a) => a.values) || [];
    knownMap.set(kq.questionId || kq.stem, { correct: correct?.values, wrongs });
  }
}

// 2. 遍历页面题目时决断
for (const q of questions) {
  const qName = await q.evaluate((el) => el.querySelector("input")?.name || "");
  const qInfo = knownMap.get(qName);

  if (qInfo?.correct && qInfo.correct.length > 0) {
    log(`🎯 [题库命中] 题目 ${qName} 直接使用题库答案: ${qInfo.correct.join(", ")}`);
    await clickAnswers(q, qInfo.correct, log);
    continue;
  }

  if (qInfo?.wrongs && qInfo.wrongs.length > 0) {
    log(`✂️ [题库剪枝] 题目 ${qName} 排除已知错误选项: ${qInfo.wrongs.join(", ")}`);
    // 在暴力遍历或大模型识别时排除这些选项
  }

  // 走原有大模型截图作答流程...
}

// 3. 提交通过后上报答案
if (quizPassed) {
  await uploadTaskResults({
    tid,
    cid: courseId,
    // pluginEmbedding 是插件选择的词向量生成器；每个返回值必须是 1536 维数组。
    questions: await addEmbeddings(recordedAnswersList, pluginEmbedding),
  });
}
```

`recordedAnswersList` 中的每道题也可以附带插件生成的 `embedding` 字段。上例中的 JSON 仅展示数组前几项，实际字段必须是 1536 维数字数组；服务端会优先保存并用于语义匹配。

---

## 7. 项目集成实战：your-szu-life (TypeScript / Rust)

针对 `/home/rinne/project/your-szu-life` 项目，可在 Tauri 后端 `src-tauri/src/uooc/quiz/` 中引入 HTTP 客户端调用，或在前端 `src/uooc/QuizPanel.tsx` 中增加自动载入与上报能力。

### 7.1 设置面板 OAuth 登录与匿名自动降级逻辑

针对 `your-szu-life` 等拥有图形界面的客户端：

1. **设置中心提供 OAuth 登录**：
   在应用设置或 UOOC 配置选项卡中提供「连接题库平台」按钮。用户点击后，调用系统浏览器或打开 OAuth 认证窗口（GitHub 或 bili-sign.rinne.in）。完成后通过 deep link 或本地回调拿到 API Key 存入应用状态。
2. **未登录时静默申请匿名账号**：
   若用户未登录，在初始化或首次查询/上报测验时，自动调用 `POST /api/auth/anonymous-key` 生成匿名账号与持久 `apiKey`，保存在本地数据库或安全存储中。
3. **账户绑定与升级入口**：
   在应用内的 UOOC 账户详情面板中，如果当前处于匿名状态，提示用户：“绑定 OAuth 账号可解锁题目修改与覆盖权限”。用户点击后调用 `authClient.linkSocial({ provider })`，即可将当前匿名账户及其所有的历史提交合并至 OAuth 账号。

### 7.2 Rust 后端接入 (示例)

在 `src-tauri/src/uooc/quiz/` 中实现自动获取凭据与请求：

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct AnonymousKeyResponse {
    ok: bool,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
}

pub async fn get_or_create_api_key(server: &str, stored_key: Option<&str>) -> Option<String> {
    if let Some(key) = stored_key {
        if !key.trim().is_empty() {
            return Some(key.to_string());
        }
    }

    // 未配置时自动调用 Auth 端点静默注册匿名账号
    let url = format!("{}/api/auth/anonymous-key", server.trim_end_matches('/'));
    let resp = reqwest::Client::new().post(&url).send().await.ok()?;
    let data = resp.json::<AnonymousKeyResponse>().await.ok()?;
    data.api_key
}

pub async fn query_qa_platform(
    server: &str,
    api_key: Option<&str>,
    tid: &str,
) -> Option<Vec<QuestionRecord>> {
    let url = format!("{}/api/tasks/{}", server.trim_end_matches('/'), tid);
    let mut req = reqwest::Client::new().get(&url);
    if let Some(k) = api_key {
        req = req.header("x-api-key", k);
    }
    let resp = req.send().await.ok()?.json::<TaskResponse>().await.ok()?;
    Some(resp.questions)
}

pub async fn report_qa_results(
    server: &str,
    api_key: Option<&str>,
    payload: &BatchUploadPayload,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{}/api/upload/batch", server.trim_end_matches('/')))
        .json(payload);
    if let Some(k) = api_key {
        req = req.header("x-api-key", k);
    }
    req.send().await?;
    Ok(())
}
```

### 7.3 前端集成 (`src/uooc/QuizPanel.tsx`)

在测验加载完成后自动拉取题库：

```typescript
useEffect(() => {
  if (!quiz.taskId) return;
  fetch(`http://localhost:4321/api/tasks/${quiz.taskId}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.questions) return;
      const autoAnswers: Record<string, string[]> = {};
      for (const q of data.questions) {
        const correct = q.answers?.find((a: any) => a.isCorrect);
        if (correct && correct.values?.length) {
          autoAnswers[q.questionId || q.id] = correct.values;
        }
      }
      if (Object.keys(autoAnswers).length > 0) {
        // 自动填入已确认的标准答案，减轻用户手动审批或 AI 计算负担
        setAnswers((prev) => ({ ...prev, ...autoAnswers }));
      }
    })
    .catch(() => {});
}, [quiz.taskId]);
```

---

## 8. 总结

通过接入 UOOC QA Share 平台：

1. **降低 Token 成本**：高频公共课试题一次解答、永久共享，避免每个人重复调用大模型截图识别。
2. **极速提升通过率**：错误答案自动排除与淘汰机制，使暴力试错次数从指数级下降为常数级。
3. **形成数据闭环**：多端插件共同消费与贡献题库，保障试题库的持续更新与准确率。
