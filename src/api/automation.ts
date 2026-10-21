import { Elysia, t } from "elysia";
import { db } from "@/db";
import { questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashStem, hasHtmlTags } from "@/lib/stem";
import { EMBEDDING_DIMENSIONS, resolveEmbedding } from "@/lib/embedding";
import { questionCacheManager } from "@/lib/cache";
import { normalizeJudgeValue, normalizeChoiceAnswers, areAnswerValuesEqual } from "./upload";
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
            "Failed to resolve embedding: either supply a 512-dim vector or configure server embedding model",
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
  )

  // 4. Fulfill missing options request
  .post(
    "/tasks/options",
    async ({ body, request, set }) => {
      const authContext = await resolveUserAuth(request);
      if (authContext.permissionLevel === "none") {
        set.status = 401;
        return {
          ok: false,
          error: "Unauthorized: write permission required to fulfill options tasks",
        };
      }

      const { question_id, options } = body;
      const qNum = Number(question_id);

      const targetQuestion = !Number.isNaN(qNum)
        ? await db.query.questions.findFirst({ where: eq(questions.id, qNum) })
        : await db.query.questions.findFirst({ where: eq(questions.questionId, question_id) });

      if (!targetQuestion) {
        set.status = 404;
        return { ok: false, error: "Question not found" };
      }

      // If options already present and user is anonymous, disallow overwriting with different options
      if (targetQuestion.options && authContext.isAnonymous) {
        set.status = 403;
        return {
          ok: false,
          error: "Permission denied: anonymous accounts cannot overwrite existing options",
        };
      }

      // Recompute embedding if stem is present and embedding is missing or based on stem+options
      let stemEmbedding = targetQuestion.stemEmbedding;
      if (targetQuestion.stem) {
        const recomputed = await resolveEmbedding(targetQuestion.stem, options);
        if (recomputed) stemEmbedding = recomputed;
      }

      await db
        .update(questions)
        .set({
          options,
          ...(stemEmbedding ? { stemEmbedding } : {}),
          updatedAt: new Date(),
        })
        .where(eq(questions.id, targetQuestion.id));

      questionCacheManager.clear();

      return {
        ok: true,
        questionId: targetQuestion.id,
        uoocQuestionId: targetQuestion.questionId,
        optionsUpdated: true,
      };
    },
    {
      body: t.Object({
        question_id: t.String(),
        options: t.Array(
          t.Object({
            id: t.String(),
            text: t.String(),
          }),
        ),
      }),
    },
  )

  // 5. Fulfill missing answer request (supports fine-grained correct & wrong answers)
  .post(
    "/tasks/answer",
    async ({ body, request, set }) => {
      const authContext = await resolveUserAuth(request);
      if (authContext.permissionLevel === "none") {
        set.status = 401;
        return {
          ok: false,
          error: "Unauthorized: write permission required to fulfill answer tasks",
        };
      }

      const { question_id, correct_answers, wrong_answers, values } = body;
      const qNum = Number(question_id);

      const targetQuestion = !Number.isNaN(qNum)
        ? await db.query.questions.findFirst({ where: eq(questions.id, qNum) })
        : await db.query.questions.findFirst({ where: eq(questions.questionId, question_id) });

      if (!targetQuestion) {
        set.status = 404;
        return { ok: false, error: "Question not found" };
      }

      const existingCorrect = await db.query.answers.findFirst({
        where: and(eq(answers.questionId, targetQuestion.id), eq(answers.isCorrect, true)),
      });

      const effectiveOptions =
        (targetQuestion.options as { id: string; text: string }[] | null) ?? null;
      const rawCorrect = values ?? correct_answers;

      let toSaveCorrect: unknown[] | null = null;
      let toSaveWrongs: unknown[] = [];

      if (targetQuestion.type === "judge") {
        if (rawCorrect && rawCorrect.length > 0) {
          for (const item of rawCorrect) {
            const b = normalizeJudgeValue(item);
            if (b !== null) {
              toSaveCorrect = [b];
              break;
            }
          }
        }
        if (wrong_answers && wrong_answers.length > 0) {
          for (const item of wrong_answers) {
            const b = normalizeJudgeValue(item);
            if (b !== null && !toSaveWrongs.includes(b)) {
              toSaveWrongs.push(b);
            }
          }
        }
      } else if (targetQuestion.type === "single" || targetQuestion.type === "multiple") {
        if (rawCorrect) {
          const chosen = normalizeChoiceAnswers(rawCorrect, effectiveOptions);
          toSaveCorrect = chosen.length > 0 ? chosen : null;
        }
        if (wrong_answers) {
          toSaveWrongs = normalizeChoiceAnswers(wrong_answers, effectiveOptions);
        }
      } else {
        if (rawCorrect && rawCorrect.length > 0) {
          toSaveCorrect = rawCorrect.map((v) => String(v));
        }
        if (wrong_answers && wrong_answers.length > 0) {
          toSaveWrongs = wrong_answers.map((v) => String(v));
        }
      }

      let action = "no_change";

      if (toSaveCorrect && toSaveCorrect.length > 0) {
        if (existingCorrect) {
          const isSame = areAnswerValuesEqual(existingCorrect.values as unknown[], toSaveCorrect);
          if (isSame) {
            action = "verified_correct";
          } else if (authContext.isAnonymous) {
            set.status = 403;
            return {
              ok: false,
              error:
                "Permission denied: anonymous accounts cannot overwrite existing correct answer",
            };
          } else {
            await db
              .update(answers)
              .set({
                values: toSaveCorrect,
                source: "automation",
                submittedBy: authContext.userId,
                confidence: 1.0,
                updatedAt: new Date(),
              })
              .where(eq(answers.id, existingCorrect.id));
            action = "updated_correct";
            await db
              .delete(answers)
              .where(and(eq(answers.questionId, targetQuestion.id), eq(answers.isCorrect, false)));
          }
        } else {
          // No correct answer existed (e.g. question 317, or only wrong answer exclusions):
          // This is a NEW write (象限变化: 无答案->有答案 或 排除项->确定正确选项)!
          await db.insert(answers).values({
            questionId: targetQuestion.id,
            values: toSaveCorrect,
            source: "automation",
            submittedBy: authContext.userId,
            isCorrect: true,
            confidence: 1.0,
          });
          action = "added_correct";
          await db
            .delete(answers)
            .where(and(eq(answers.questionId, targetQuestion.id), eq(answers.isCorrect, false)));
        }
      }

      if (toSaveWrongs.length > 0) {
        const hasCorrectNow =
          action === "added_correct" ||
          action === "updated_correct" ||
          action === "verified_correct" ||
          existingCorrect != null;
        if (!hasCorrectNow) {
          for (const wrongVal of toSaveWrongs) {
            const existingWrong = await db.query.answers.findFirst({
              where: and(
                eq(answers.questionId, targetQuestion.id),
                eq(answers.isCorrect, false),
                sql`${answers.values} @> ${JSON.stringify([wrongVal])}::jsonb`,
              ),
            });
            if (!existingWrong) {
              await db.insert(answers).values({
                questionId: targetQuestion.id,
                values: [wrongVal],
                source: "automation",
                submittedBy: authContext.userId,
                isCorrect: false,
                confidence: 0.5,
              });
              action = action === "no_change" ? "added_wrong" : action;
            }
          }
        }
      }

      questionCacheManager.clear();

      return {
        ok: true,
        questionId: targetQuestion.id,
        uoocQuestionId: targetQuestion.questionId,
        action,
      };
    },
    {
      body: t.Object({
        question_id: t.String(),
        correct_answers: t.Optional(t.Array(t.Any())),
        values: t.Optional(t.Array(t.Any())),
        wrong_answers: t.Optional(t.Array(t.Any())),
      }),
    },
  );
