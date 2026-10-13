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

## 2. 环境准备与配置

客户端插件需在配置项中增加题库服务器地址与鉴权信息：

| 配置项       | 环境变量/配置文件字段 | 示例值                  | 说明                                            |
| ------------ | --------------------- | ----------------------- | ----------------------------------------------- |
| 服务端基地址 | `QA_SERVER_URL`       | `http://localhost:4321` | 平台 API 根路径                                 |
| 认证 Token   | `QA_SERVER_TOKEN`     | `Bearer ...` (可选)     | 匿名用户留空；登录用户传入 Token 可覆盖历史答案 |

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

---

## 6. 项目集成实战：fuckuooc (Node.js)

针对 `/home/rinne/project-contribute/fuckuooc` 项目，建议新增 `utils/qa-client.js` 并接入 `utils/quiz.js`。

### 6.1 实现 Client 模块 (`utils/qa-client.js`)

```javascript
// utils/qa-client.js
const QA_SERVER = process.env.UOOC_QA_SERVER || "http://localhost:4321";
const QA_TOKEN = process.env.UOOC_QA_TOKEN || "";

async function fetchTaskAnswers(tid, cid) {
  try {
    const url = cid
      ? `${QA_SERVER}/api/courses/${cid}/tasks/${tid}`
      : `${QA_SERVER}/api/tasks/${tid}`;
    const res = await fetch(url);
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
    const headers = { "Content-Type": "application/json" };
    if (QA_TOKEN) headers["Authorization"] = `Bearer ${QA_TOKEN}`;

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

module.exports = { fetchTaskAnswers, uploadTaskResults };
```

### 6.2 在 `utils/quiz.js` 中接入

在 `processQuizQuestions` 执行前查询题库：

```javascript
const { fetchTaskAnswers, uploadTaskResults } = require("./qa-client");

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
    questions: recordedAnswersList, // 包含通过的组合或从 exam/view 解析的标准答案
  });
}
```

---

## 7. 项目集成实战：your-szu-life (TypeScript / Rust)

针对 `/home/rinne/project/your-szu-life` 项目，可在 Tauri 后端 `src-tauri/src/uooc/quiz/` 中引入 HTTP 客户端调用，或在前端 `src/uooc/QuizPanel.tsx` 中增加自动载入与上报能力。

### 7.1 Rust 后端接入 (示例)

在 `src-tauri/src/uooc/quiz/` 中：

```rust
pub async fn query_qa_platform(server: &str, tid: &str) -> Option<Vec<QuestionRecord>> {
    let url = format!("{}/api/tasks/{}", server.trim_end_matches('/'), tid);
    let resp = reqwest::get(&url).await.ok()?.json::<TaskResponse>().await.ok()?;
    Some(resp.questions)
}

pub async fn report_qa_results(
    server: &str,
    token: Option<&str>,
    payload: &BatchUploadPayload,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{}/api/upload/batch", server.trim_end_matches('/')))
        .json(payload);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    req.send().await?;
    Ok(())
}
```

### 7.2 前端集成 (`src/uooc/QuizPanel.tsx`)

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
