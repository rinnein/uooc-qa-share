import { Elysia, t } from "elysia";
import { db } from "@/db";
import { questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashStem } from "@/lib/stem";
import { buildEmbeddingText, EMBEDDING_DIMENSIONS, generateEmbedding } from "@/lib/embedding";
import { questionCachePlugin } from "@/lib/cache";

export async function searchQuestionsInternal(options: {
  q?: string;
  exact?: string | boolean;
  embedding?: number[];
  options?: { id: string; text: string }[];
  limit?: number;
  page?: number;
}) {
  const q = options.q?.trim();
  const searchOptions = options.options;
  const exact = options.exact === "1" || options.exact === true;
  const page = Math.max(1, options.page ?? 1);
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 50) : 20;
  const offset = (page - 1) * limit;

  // 1. If exact mode and q is provided, search by stem_hash
  if (exact && q) {
    const hash = hashStem(q);
    const results = await db.query.questions.findMany({
      where: eq(questions.stemHash, hash),
      limit,
      offset,
    });
    let total = results.length;
    if (typeof (db as any).select === "function") {
      try {
        const [c] = await db
          .select({ count: sql<number>`count(*)` })
          .from(questions)
          .where(eq(questions.stemHash, hash));
        if (c) total = Number(c.count);
      } catch {}
    }
    return {
      results,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // 2. Vector search: prefer client-provided vector if valid; otherwise generate server-side if q/options is provided
  let embedding: number[] | null = null;
  if (options.embedding && options.embedding.length === EMBEDDING_DIMENSIONS) {
    embedding = options.embedding;
  } else if (q || (searchOptions && searchOptions.length > 0)) {
    const textToEmbed = buildEmbeddingText(q, searchOptions);
    if (textToEmbed) {
      embedding = await generateEmbedding(textToEmbed);
    }
  }

  if (embedding) {
    const vectorStr = `[${embedding.join(",")}]`;
    const rawResults = await db.execute(sql`
      SELECT q.*, 1 - (q.stem_embedding <=> ${vectorStr}::vector) AS similarity,
             count(*) OVER() AS total_count
      FROM questions q
      WHERE q.stem_embedding IS NOT NULL
      ORDER BY q.stem_embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const rows = (rawResults as any[]) ?? [];
    const total =
      rows.length > 0 && rows[0].total_count != null ? Number(rows[0].total_count) : rows.length;
    const results = rows.map(({ total_count: _total_count, ...rest }) => rest);
    return {
      results,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // 3. Fallback: ILIKE search on stem text
  if (q) {
    const results = await db.query.questions.findMany({
      where: sql`${questions.stem} ILIKE ${"%" + q + "%"}`,
      limit,
      offset,
    });
    let total = results.length;
    if (typeof (db as any).select === "function") {
      try {
        const [c] = await db
          .select({ count: sql<number>`count(*)` })
          .from(questions)
          .where(sql`${questions.stem} ILIKE ${"%" + q + "%"}`);
        if (c) total = Number(c.count);
      } catch {}
    }
    return {
      results,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  return { results: [], total: 0, page, pageSize: limit, totalPages: 1 };
}

export const questionsRoutes = new Elysia({ prefix: "/questions" })
  .use(questionCachePlugin)
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

  // Search questions by stem text, options, or precomputed vector (GET)
  .get(
    "/search",
    async ({ query }) => {
      let embedding: number[] | undefined;
      if (query.embedding) {
        try {
          const parsed = JSON.parse(query.embedding);
          if (Array.isArray(parsed) && parsed.length === EMBEDDING_DIMENSIONS) {
            embedding = parsed;
          }
        } catch {}
      }

      let searchOptions: { id: string; text: string }[] | undefined;
      if (query.options) {
        try {
          const parsed = JSON.parse(query.options);
          if (Array.isArray(parsed)) {
            searchOptions = parsed;
          }
        } catch {}
      }

      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = query.page ? Number.parseInt(query.page, 10) : undefined;
      return searchQuestionsInternal({
        q: query.q,
        exact: query.exact,
        embedding,
        options: searchOptions,
        limit: Number.isNaN(limit) ? undefined : limit,
        page: Number.isNaN(page) ? undefined : page,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        exact: t.Optional(t.String()),
        embedding: t.Optional(t.String()),
        options: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        page: t.Optional(t.String()),
      }),
    },
  )

  // Search questions by stem text, options, or precomputed vector (POST)
  .post(
    "/search",
    async ({ body }) => {
      return searchQuestionsInternal({
        q: body.q,
        exact: body.exact,
        embedding: body.embedding,
        options: body.options,
        limit: body.limit,
        page: body.page,
      });
    },
    {
      body: t.Object({
        q: t.Optional(t.String()),
        exact: t.Optional(t.Union([t.String(), t.Boolean()])),
        embedding: t.Optional(
          t.Array(t.Number(), {
            minItems: EMBEDDING_DIMENSIONS,
            maxItems: EMBEDDING_DIMENSIONS,
          }),
        ),
        options: t.Optional(
          t.Array(
            t.Object({
              id: t.String(),
              text: t.String(),
            }),
          ),
        ),
        limit: t.Optional(t.Number()),
        page: t.Optional(t.Number()),
      }),
    },
  );
