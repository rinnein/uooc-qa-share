import { Elysia, t } from "elysia";
import { db } from "@/db";
import { questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashStem } from "@/lib/stem";
import { generateEmbedding } from "@/lib/embedding";

export const questionsRoutes = new Elysia({ prefix: "/questions" })
  // Get single question by internal ID or UOOC question_id
  .get(
    "/:id",
    async ({ params }) => {
      const numericId = Number(params.id);
      let question;

      if (!Number.isNaN(numericId)) {
        question = await db.query.questions.findFirst({
          where: eq(questions.id, numericId),
        });
      }

      // Fallback: match by UOOC questionId string if not found by primary key
      if (!question) {
        question = await db.query.questions.findFirst({
          where: eq(questions.questionId, params.id),
        });
      }

      if (!question) return { error: "Question not found" };

      const questionAnswers = await db.query.answers.findMany({
        where: eq(answers.questionId, question.id),
        orderBy: (a, { desc }) => [desc(a.isCorrect), desc(a.updatedAt)],
      });

      return { question, answers: questionAnswers };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Get question explicitly by UOOC question_id (optionally scoped to tid)
  .get(
    "/by-qid/:qid",
    async ({ params, query }) => {
      const qid = params.qid;
      const tid = query.tid;

      const question = await db.query.questions.findFirst({
        where: tid
          ? and(eq(questions.questionId, qid), eq(questions.tid, tid))
          : eq(questions.questionId, qid),
      });

      if (!question) return { error: "Question not found" };

      const questionAnswers = await db.query.answers.findMany({
        where: eq(answers.questionId, question.id),
        orderBy: (a, { desc }) => [desc(a.isCorrect), desc(a.updatedAt)],
      });

      return { question, answers: questionAnswers };
    },
    {
      params: t.Object({ qid: t.String() }),
      query: t.Object({ tid: t.Optional(t.String()) }),
    },
  )

  // Get answers for a question
  .get(
    "/:id/answers",
    async ({ params }) => {
      const numericId = Number(params.id);
      let targetId = numericId;

      if (Number.isNaN(numericId)) {
        const question = await db.query.questions.findFirst({
          where: eq(questions.questionId, params.id),
        });
        if (!question) return { error: "Question not found" };
        targetId = question.id;
      }

      const questionAnswers = await db.query.answers.findMany({
        where: eq(answers.questionId, targetId),
        orderBy: (a, { desc }) => [desc(a.isCorrect), desc(a.updatedAt)],
      });

      return { answers: questionAnswers };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Search questions by stem text
  .get(
    "/search",
    async ({ query }) => {
      const q = query.q?.trim();
      if (!q) return { results: [] };

      // If exact mode, search by stem_hash
      if (query.exact === "1") {
        const hash = hashStem(q);
        const results = await db.query.questions.findMany({
          where: eq(questions.stemHash, hash),
          limit: 50,
        });
        return { results };
      }

      // Try vector search if embedding is configured
      const embedding = await generateEmbedding(q);
      if (embedding) {
        const vectorStr = `[${embedding.join(",")}]`;
        const results = await db.execute(sql`
          SELECT q.*, 1 - (q.stem_embedding <=> ${vectorStr}::vector) AS similarity
          FROM questions q
          WHERE q.stem_embedding IS NOT NULL
          ORDER BY q.stem_embedding <=> ${vectorStr}::vector
          LIMIT 20
        `);
        return { results };
      }

      // Fallback: ILIKE search on stem text
      const results = await db.query.questions.findMany({
        where: sql`${questions.stem} ILIKE ${"%" + q + "%"}`,
        limit: 50,
      });
      return { results };
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        exact: t.Optional(t.String()),
      }),
    },
  );
