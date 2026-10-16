import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { taskGroups, questions, answers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateEmbedding } from "@/lib/embedding";
import { env } from "@/lib/env";

export function createMcpServer() {
  const server = new McpServer({
    name: "uooc-qa-share",
    version: "1.0.0",
  });

  // Prompt for agents to analyze and clean exam PDFs/images and upload
  server.prompt(
    "analyze_and_upload_qa",
    "用于引导 Agent 软件分析包含答案的 UOOC 题目数据（PDF/图片等），清洗并自动上传到题库平台的系统提示词",
    {
      tid: z.string().describe("UOOC 题组 ID (tid)"),
      cid: z.string().optional().describe("UOOC 课程 ID (cid，可选)"),
      course_name: z.string().optional().describe("课程名称 (可选)"),
      task_name: z.string().optional().describe("题组名称 (可选)"),
    },
    ({ tid, cid, course_name, task_name }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `你是一个专业的 UOOC（优课联盟）题目数据清洗与录入专家。
请分析用户提供的文件（PDF文档、截图标注、网页抓取文本等），提取该题组的所有题目，并通过工具 "upload_answers" 上传到题库平台。

【目标题组信息】
- tid (题组编号): ${tid}
${cid ? `- cid (课程编号): ${cid}` : ""}
${course_name ? `- course_name (课程名): ${course_name}` : ""}
${task_name ? `- task_name (题组名): ${task_name}` : ""}

【提取与清洗要求】
1. 题目识别：
   - 提取每道题的 question_id（若无显式 ID，使用序号如 "1", "2"）。
   - 判断题型 type:
     * single: 单选题
     * multiple: 多选题
     * judge: 判断题（是/否，正确/错误）
     * text: 填空题
   - 题干 stem: 尽可能提取完整题干，若包含 HTML 标签请保留。
   - 选项 options: 对单选题/多选题/判断题，提取选项列表 [{ id: "A", text: "..." }, ...]。
2. 答案识别：
   - 若题目已确认正确答案，提取为 correct_answers:
     * 单选/判断: ["A"] 或 ["正确"]
     * 多选: ["A", "C"]
     * 填空: ["第一空答案", "第二空答案"]
   - 若题目无已确认正确答案，但通过试错已知某些答案是错误的，提取为 wrong_answers:
     * 例如 ["B", "D"]
   - 若两者均未知，可均设为 null。
3. 清洗完成后，调用 upload_answers 工具，传入 JSON 字符串。
JSON 格式规范：
{
  "tid": "${tid}",
  ${cid ? `"cid": "${cid}",` : ""}
  ${course_name ? `"course_name": "${course_name}",` : ""}
  ${task_name ? `"task_name": "${task_name}",` : ""}
  "questions": [
    {
      "question_id": "1",
      "type": "single",
      "stem": "题干内容",
      "options": [
        { "id": "A", "text": "选项A" },
        { "id": "B", "text": "选项B" }
      ],
      "correct_answers": ["A"],
      "wrong_answers": null
    }
  ]
}`,
          },
        },
      ],
    }),
  );

  // Search questions by stem text
  server.tool(
    "search_questions",
    "按题干内容搜索题目。返回匹配的题目及其答案。",
    { query: z.string().describe("搜索关键词") },
    async ({ query }) => {
      const embedding = await generateEmbedding(query);
      let results;
      if (embedding) {
        const vectorStr = `[${embedding.join(",")}]`;
        const rows = await db.execute(sql`
          SELECT q.*, 1 - (q.stem_embedding <=> ${vectorStr}::vector) AS similarity
          FROM questions q WHERE q.stem_embedding IS NOT NULL
          ORDER BY q.stem_embedding <=> ${vectorStr}::vector LIMIT 10
        `);
        results = rows;
      } else {
        results = await db.query.questions.findMany({
          where: sql`${questions.stem} ILIKE ${"%" + query + "%"}`,
          limit: 10,
        });
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // Get all Q&A for a task group
  server.tool(
    "get_task_answers",
    "获取某个题组(tid)下所有题目及其答案",
    { tid: z.string().describe("UOOC 题组 ID") },
    async ({ tid }) => {
      const qs = await db.query.questions.findMany({
        where: eq(questions.tid, tid),
      });
      const qIds = qs.map((q) => q.id);
      const allAnswers =
        qIds.length > 0
          ? await db.query.answers.findMany({
              where: sql`${answers.questionId} IN (${sql.join(
                qIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            })
          : [];
      const byQ = new Map<number, typeof allAnswers>();
      for (const a of allAnswers) {
        const list = byQ.get(a.questionId) ?? [];
        list.push(a);
        byQ.set(a.questionId, list);
      }
      const result = qs.map((q) => ({ ...q, answers: byQ.get(q.id) ?? [] }));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Get single Q&A
  server.tool(
    "get_question_answer",
    "获取单个题目及其答案 (支持内部 ID 或 UOOC question_id)",
    { question_id: z.string().describe("题目 ID 或 UOOC question_id") },
    async ({ question_id }) => {
      const numId = Number(question_id);
      let q = !Number.isNaN(numId)
        ? await db.query.questions.findFirst({ where: eq(questions.id, numId) })
        : null;

      if (!q) {
        q = await db.query.questions.findFirst({ where: eq(questions.questionId, question_id) });
      }

      if (!q) return { content: [{ type: "text" as const, text: "题目不存在" }] };
      const ans = await db.query.answers.findMany({ where: eq(answers.questionId, q.id) });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...q, answers: ans }, null, 2) }],
      };
    },
  );

  // List task groups for a course
  server.tool(
    "get_course_tasks",
    "获取某课程(cid)下所有题组",
    { cid: z.string().describe("UOOC 课程 ID") },
    async ({ cid }) => {
      const groups = await db.query.taskGroups.findMany({ where: eq(taskGroups.cid, cid) });
      return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }] };
    },
  );

  // Batch upload answers
  server.tool(
    "upload_answers",
    `批量上传题目和答案。输入 JSON 字符串，格式包含 tid, cid(可选), questions 数组。
每个题目包含 question_id, type, stem(可选), options(可选), correct_answers(可选), wrong_answers(可选)。`,
    { data: z.string().describe("批量上传的 JSON 字符串") },
    async ({ data }) => {
      try {
        const body = JSON.parse(data);
        const baseUrl = env.BETTER_AUTH_URL;
        const res = await fetch(`${baseUrl}/api/upload/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );

  // List pending automation tasks based on missing data (stem, embedding, options, answers)
  server.tool(
    "list_pending_tasks",
    "列出数据库中缺失可选数据（题干、向量、选项、答案等）的待补全自动任务列表",
    {
      type: z
        .enum(["all", "stem_request", "embedding_request", "options_request", "answer_request"])
        .optional()
        .describe(
          "任务类型过滤 (stem_request: 缺失题干, embedding_request: 缺失向量, options_request: 缺失选项, answer_request: 缺失答案)",
        ),
      tid: z.string().optional().describe("按题组 ID (tid) 过滤"),
      limit: z.number().optional().describe("获取数量限制 (默认 20，最大 100)"),
    },
    async ({ type, tid, limit }) => {
      try {
        const baseUrl = env.BETTER_AUTH_URL;
        const queryParams = new URLSearchParams();
        if (type && type !== "all") queryParams.set("type", type);
        if (tid) queryParams.set("tid", tid);
        if (limit) queryParams.set("limit", String(limit));

        const res = await fetch(`${baseUrl}/api/automation/tasks?${queryParams.toString()}`);
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );

  // Fulfill missing stem request
  server.tool(
    "fulfill_stem_task",
    "补全题目的缺失题干文本",
    {
      question_id: z.string().describe("内部题目 ID 或 UOOC 题号"),
      stem: z.string().describe("完整的题干文本内容"),
    },
    async ({ question_id, stem }) => {
      try {
        const baseUrl = env.BETTER_AUTH_URL;
        const res = await fetch(`${baseUrl}/api/automation/tasks/stem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question_id, stem }),
        });
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );

  // Fulfill missing embedding calculation request
  server.tool(
    "fulfill_embedding_task",
    "为题目生成或写入 1536 维向量嵌入",
    {
      question_id: z.string().describe("内部题目 ID 或 UOOC 题号"),
      embedding: z
        .array(z.number())
        .length(1536)
        .optional()
        .describe("可选的 1536 维向量数组（若未提供，服务端将尝试调用配置的模型计算）"),
    },
    async ({ question_id, embedding }) => {
      try {
        const baseUrl = env.BETTER_AUTH_URL;
        const res = await fetch(`${baseUrl}/api/automation/tasks/embedding`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question_id, embedding }),
        });
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );

  // Match local question bank with server questions
  server.tool(
    "match_question_bank",
    "将本地维护的题库 ID 表与服务端比对：支持优先通过 cid、可选 tid 缩小范围减少传输，确认服务端缺失题目并过滤出匹配的待补全任务",
    {
      cid: z.string().optional().describe("UOOC 课程 ID（推荐指定以大幅缩小匹配范围）"),
      tid: z.string().optional().describe("UOOC 题组 ID（可选）"),
      local_question_ids: z.array(z.string()).optional().describe("本地题库中的题目 ID 列表"),
      items: z
        .array(
          z.object({
            tid: z.string().optional().describe("题组 ID"),
            question_id: z.string().describe("题目 ID"),
          }),
        )
        .optional()
        .describe("包含 tid 的本地题目项列表"),
      task_types: z
        .array(z.string())
        .optional()
        .describe(
          "可选的任务类型过滤 (stem_request / embedding_request / options_request / answer_request)",
        ),
      limit: z.number().optional().describe("返回任务条数限制 (默认 50)"),
    },
    async ({ cid, tid, local_question_ids, items, task_types, limit }) => {
      try {
        const baseUrl = env.BETTER_AUTH_URL;
        const res = await fetch(`${baseUrl}/api/automation/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cid,
            tid,
            local_question_ids,
            items,
            task_types,
            limit,
          }),
        });
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `错误: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );

  return server;
}
