import { Elysia, t } from "elysia";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashStem, hasHtmlTags } from "@/lib/stem";
import { EMBEDDING_DIMENSIONS, resolveEmbedding } from "@/lib/embedding";
import { questionCacheManager } from "@/lib/cache";
import {
  resolveUserAuth,
  getAllowedTaskTypesForLevel,
  getMissingDataTasks,
  matchQuestionBank,
  type TaskType,
} from "@/lib/auto-tasks";

export const automationRoutes = new Elysia({ prefix: "/automation" })
  // 1. List pending automatic tasks based on missing data and user's write permission level
  .get(
    "/tasks",
    async ({ query, request }) => {
      const authContext = await resolveUserAuth(request);
      const allowedTypes = getAllowedTaskTypesForLevel(authContext.permissionLevel);

      const requestedLimit = query.limit ? Number.parseInt(query.limit, 10) : 50;
      const limit =
        Number.isNaN(requestedLimit) || requestedLimit <= 0 ? 50 : Math.min(requestedLimit, 100);

      const tasks = await getMissingDataTasks({
        allowedTypes,
        typeFilter: query.type,
        cid: query.cid,
        tid: query.tid,
        limit,
      });

      return {
        ok: true,
        account: {
          userId: authContext.userId,
          permissionLevel: authContext.permissionLevel,
          isAnonymous: authContext.isAnonymous,
        },
        allowedTaskTypes: allowedTypes,
        count: tasks.length,
        tasks,
      };
    },
    {
      query: t.Object({
        type: t.Optional(t.String()),
        cid: t.Optional(t.String()),
        tid: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // 2. Match local question bank table with server questions
  .post(
    "/match",
    async ({ body, request }) => {
      const authContext = await resolveUserAuth(request);
      const allowedTypes = getAllowedTaskTypesForLevel(authContext.permissionLevel);

      const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 100) : 50;
      const taskTypes = body.task_types ? (body.task_types as TaskType[]) : undefined;

      const result = await matchQuestionBank({
        cid: body.cid,
        tid: body.tid,
        localQuestionIds: body.local_question_ids,
        items: body.items,
        taskTypes,
        limit,
        allowedTypes,
      });

      return {
        ok: true,
        account: {
          userId: authContext.userId,
          permissionLevel: authContext.permissionLevel,
          isAnonymous: authContext.isAnonymous,
        },
        ...result,
      };
    },
    {
      body: t.Object({
        cid: t.Optional(t.String()),
        tid: t.Optional(t.String()),
        local_question_ids: t.Optional(t.Array(t.String())),
        items: t.Optional(
          t.Array(
            t.Object({
              tid: t.Optional(t.String()),
              question_id: t.String(),
            }),
          ),
        ),
        task_types: t.Optional(t.Array(t.String())),
        limit: t.Optional(t.Number()),
      }),
    },
  )

  // 2. Fulfill missing stem request
  .post(
    "/tasks/stem",
    async ({ body, request, set }) => {
      const authContext = await resolveUserAuth(request);
      if (authContext.permissionLevel === "none") {
        set.status = 401;
        return {
          ok: false,
          error: "Unauthorized: write permission required to fulfill stem tasks",
        };
      }

      const { question_id, stem } = body;

      if (hasHtmlTags(stem)) {
        set.status = 400;
        return {
          ok: false,
          error: "题干包含未过滤的 HTML 标签，请先过滤后再上传",
        };
      }

      const qNum = Number(question_id);

      const targetQuestion = !Number.isNaN(qNum)
        ? await db.query.questions.findFirst({ where: eq(questions.id, qNum) })
        : await db.query.questions.findFirst({ where: eq(questions.questionId, question_id) });

      if (!targetQuestion) {
        set.status = 404;
        return { ok: false, error: "Question not found" };
      }

      // If stem is already present and user is anonymous, disallow overwriting
      if (targetQuestion.stem && authContext.isAnonymous) {
        set.status = 403;
        return {
          ok: false,
          error: "Permission denied: anonymous accounts cannot overwrite existing stem",
        };
      }

      const stemHash = hashStem(stem);
      // Attempt to resolve embedding if not already set (including question options to boost search accuracy)
      let stemEmbedding = targetQuestion.stemEmbedding;
      if (!stemEmbedding) {
        const opts = (targetQuestion.options as { id: string; text: string }[] | null) ?? null;
        stemEmbedding = await resolveEmbedding(stem, opts);
      }

      await db
        .update(questions)
        .set({
          stem,
          stemHash,
          ...(stemEmbedding ? { stemEmbedding } : {}),
          updatedAt: new Date(),
        })
        .where(eq(questions.id, targetQuestion.id));

      questionCacheManager.clear();

      return {
        ok: true,
        questionId: targetQuestion.id,
        uoocQuestionId: targetQuestion.questionId,
        stemUpdated: true,
        embeddingCalculated: Boolean(stemEmbedding),
      };
    },
    {
      body: t.Object({
        question_id: t.String(),
        stem: t.String({ minLength: 1 }),
      }),
    },
  )

  // 3. Fulfill missing embedding calculation request
  .post(
    "/tasks/embedding",
    async ({ body, request, set }) => {
      const authContext = await resolveUserAuth(request);
      if (authContext.permissionLevel === "none") {
        set.status = 401;
        return {
          ok: false,
          error: "Unauthorized: write permission required to fulfill embedding tasks",
        };
      }

      const { question_id, embedding } = body;
      const qNum = Number(question_id);

      const targetQuestion = !Number.isNaN(qNum)
        ? await db.query.questions.findFirst({ where: eq(questions.id, qNum) })
        : await db.query.questions.findFirst({ where: eq(questions.questionId, question_id) });

      if (!targetQuestion) {
        set.status = 404;
        return { ok: false, error: "Question not found" };
      }

      let finalEmbedding: number[] | null = null;
      if (embedding && embedding.length === EMBEDDING_DIMENSIONS) {
        finalEmbedding = embedding;
      } else if (targetQuestion.stem) {
        // Compute using server model if client didn't supply direct vector (combine stem and options)
        const opts = (targetQuestion.options as { id: string; text: string }[] | null) ?? null;
        finalEmbedding = await resolveEmbedding(targetQuestion.stem, opts);
      }

      if (!finalEmbedding) {
        set.status = 400;
        return {
          ok: false,
          error:
            "Failed to resolve embedding: either supply a 1536-dim vector or configure server embedding model",
        };
      }

      await db
        .update(questions)
        .set({
          stemEmbedding: finalEmbedding,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, targetQuestion.id));

      questionCacheManager.clear();

      return {
        ok: true,
        questionId: targetQuestion.id,
        uoocQuestionId: targetQuestion.questionId,
        embeddingUpdated: true,
      };
    },
    {
      body: t.Object({
        question_id: t.String(),
        embedding: t.Optional(
          t.Array(t.Number(), {
            minItems: EMBEDDING_DIMENSIONS,
            maxItems: EMBEDDING_DIMENSIONS,
          }),
        ),
      }),
    },
  );
