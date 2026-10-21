import { Elysia, t } from "elysia";
import { db } from "@/db";
import { courses, taskGroups, questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashStem, hasHtmlTags } from "@/lib/stem";
import { EMBEDDING_DIMENSIONS, resolveEmbedding } from "@/lib/embedding";
import { auth } from "@/lib/auth";
import { questionCacheManager } from "@/lib/cache";

const JUDGE_OPTIONS = [
  { id: "A", text: "正确" },
  { id: "B", text: "错误" },
];

export function normalizeJudgeValue(val: unknown): boolean | null {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (
      s === "true" ||
      s === "1" ||
      s === "a" ||
      s === "正确" ||
      s === "对" ||
      s === "t" ||
      s === "yes" ||
      s === "y" ||
      s.startsWith("a.") ||
      s.startsWith("a、") ||
      s.startsWith("a ")
    ) {
      return true;
    }
    if (
      s === "false" ||
      s === "0" ||
      s === "b" ||
      s === "错误" ||
      s === "错" ||
      s === "f" ||
      s === "no" ||
      s === "n" ||
      s.startsWith("b.") ||
      s.startsWith("b、") ||
      s.startsWith("b ")
    ) {
      return false;
    }
  }
  return null;
}

export function normalizeChoiceAnswers(
  rawValues: unknown[],
  options?: { id: string; text: string }[] | null,
): string[] {
  if (!rawValues || rawValues.length === 0) return [];
  const opts = options ?? [];
  const validIds = new Set(opts.map((o) => o.id));
  const result: string[] = [];

  for (const raw of rawValues) {
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const val = String(raw).trim();
    if (!val) continue;

    // 1. Direct match with opt.id
    if (validIds.has(val)) {
      if (!result.includes(val)) result.push(val);
      continue;
    }

    // 2. Case-insensitive id match (e.g. "a" -> "A")
    const matchedById = opts.find((o) => o.id.toLowerCase() === val.toLowerCase());
    if (matchedById) {
      if (!result.includes(matchedById.id)) result.push(matchedById.id);
      continue;
    }

    // 3. Match by option text
    const matchedByText = opts.find(
      (o) => o.text.trim() === val || o.text.replace(/\s+/g, "") === val.replace(/\s+/g, ""),
    );
    if (matchedByText) {
      if (!result.includes(matchedByText.id)) result.push(matchedByText.id);
      continue;
    }

    // 4. Prefix match like "A. 选项A内容" or "A、选项A内容"
    const prefixMatch = val.match(/^([A-Za-z0-9]+)[.、:：\s]/);
    if (prefixMatch) {
      const candidateId = prefixMatch[1];
      const matched = opts.find((o) => o.id.toLowerCase() === candidateId.toLowerCase());
      if (matched) {
        if (!result.includes(matched.id)) result.push(matched.id);
        continue;
      }
      const upper = candidateId.toUpperCase();
      if (!result.includes(upper)) result.push(upper);
      continue;
    }

    // 5. If it looks like a single letter ID ("A", "B", etc.)
    if (/^[A-Za-z]$/.test(val)) {
      const upper = val.toUpperCase();
      if (!result.includes(upper)) result.push(upper);
    } else {
      // Fallback if no options were provided to map against
      if (!result.includes(val)) result.push(val);
    }
  }

  return result;
}

export function areAnswerValuesEqual(a: unknown[], b: unknown[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].map(String).sort();
  const sortedB = [...b].map(String).sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

export function validateQuestionUpload(
  q: {
    question_id: string;
    type: string;
    stem?: string;
    options?: { id: string; text: string }[];
    blanks?: number;
    correct_answers?: unknown[];
    wrong_answers?: unknown[];
    values?: unknown[];
  },
  existingOptions?: { id: string; text: string }[] | null,
): { valid: true } | { valid: false; error: string } {
  // 1. Validate question type
  const validTypes = ["single", "multiple", "judge", "text"];
  if (!validTypes.includes(q.type)) {
    return {
      valid: false,
      error: `题目 #${q.question_id} 的类型 '${q.type}' 无效，必须为 single、multiple、judge 或 text 之一`,
    };
  }

  // 2. Validate HTML tags
  if (q.stem && hasHtmlTags(q.stem)) {
    return {
      valid: false,
      error: `题目 #${q.question_id} 的题干包含未过滤的 HTML 标签，已拒绝该请求`,
    };
  }
  if (q.options) {
    for (const opt of q.options) {
      if (!opt.id || !opt.id.trim()) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 存在选项缺少 id`,
        };
      }
      if (!opt.text || !opt.text.trim()) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 选项 '${opt.id}' 缺少内容文本`,
        };
      }
      if (hasHtmlTags(opt.text) || hasHtmlTags(opt.id)) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 的选项包含未过滤的 HTML 标签，已拒绝该请求`,
        };
      }
    }
  }

  const rawAnswerValues = q.values ?? q.correct_answers;
  const rawWrongs = q.wrong_answers;

  // 3. Type-specific validation
  if (q.type === "single" || q.type === "multiple") {
    const effectiveOptions = q.options ?? existingOptions;
    if (!effectiveOptions || effectiveOptions.length < 2) {
      // If uploading answers for choice question, options are required (at least 2 options)
      if (rawAnswerValues || rawWrongs) {
        return {
          valid: false,
          error: `题目 #${q.question_id} (${q.type === "single" ? "单选题" : "多选题"}) 必须提供至少 2 个选项`,
        };
      }
    } else {
      // Check for duplicate option IDs
      const optIdSet = new Set<string>();
      for (const opt of effectiveOptions) {
        const idTrimmed = opt.id.trim();
        if (optIdSet.has(idTrimmed)) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 选项列表包含重复的选项 ID '${idTrimmed}'`,
          };
        }
        optIdSet.add(idTrimmed);
      }

      // Validate correct answers
      if (rawAnswerValues) {
        if (!Array.isArray(rawAnswerValues)) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 答案必须为数组`,
          };
        }
        if (rawAnswerValues.length === 0) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 答案数组不能为空，如无答案请传入 null`,
          };
        }

        if (rawAnswerValues.length > effectiveOptions.length) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 答案项数量 (${rawAnswerValues.length}) 超过了可用选项数量 (${effectiveOptions.length})`,
          };
        }

        // Check duplicate items in answer array
        const seenAnswers = new Set<string>();
        for (const item of rawAnswerValues) {
          const s = String(item).trim();
          if (seenAnswers.has(s)) {
            return {
              valid: false,
              error: `题目 #${q.question_id} 答案数组包含重复项 '${s}'`,
            };
          }
          seenAnswers.add(s);
        }

        // Verify each item is in options[].id (or matches option text)
        const validIds = new Set(effectiveOptions.map((o) => o.id));
        const validTexts = new Set(effectiveOptions.map((o) => o.text.trim()));
        for (const item of rawAnswerValues) {
          const s = String(item).trim();
          const inId =
            validIds.has(s) || [...validIds].some((id) => id.toLowerCase() === s.toLowerCase());
          const inText = validTexts.has(s);
          const prefixMatch = s.match(/^([A-Za-z0-9]+)[.、:：\s]/);
          const inPrefix = prefixMatch && validIds.has(prefixMatch[1].toUpperCase());
          if (!inId && !inText && !inPrefix) {
            return {
              valid: false,
              error: `题目 #${q.question_id} 答案项 '${s}' 不在选项 options[].id 列表中 (有效选项: ${[...validIds].join(", ")})`,
            };
          }
        }
      }

      // Validate wrong answers
      if (rawWrongs) {
        if (!Array.isArray(rawWrongs)) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 错误答案必须为数组`,
          };
        }
        const seenWrongs = new Set<string>();
        for (const item of rawWrongs) {
          const s = String(item).trim();
          if (seenWrongs.has(s)) {
            return {
              valid: false,
              error: `题目 #${q.question_id} 错误答案数组包含重复项 '${s}'`,
            };
          }
          seenWrongs.add(s);
        }

        const validIds = new Set(effectiveOptions.map((o) => o.id));
        const validTexts = new Set(effectiveOptions.map((o) => o.text.trim()));
        for (const item of rawWrongs) {
          const s = String(item).trim();
          const inId =
            validIds.has(s) || [...validIds].some((id) => id.toLowerCase() === s.toLowerCase());
          const inText = validTexts.has(s);
          if (!inId && !inText) {
            return {
              valid: false,
              error: `题目 #${q.question_id} 错误答案项 '${s}' 不在选项列表中 (有效选项: ${[...validIds].join(", ")})`,
            };
          }
        }
      }
    }
  } else if (q.type === "judge") {
    // Judge question validation
    if (rawAnswerValues) {
      if (!Array.isArray(rawAnswerValues)) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 判断题答案必须为数组`,
        };
      }
      if (rawAnswerValues.length !== 1) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 为判断题，答案必须有且仅有 1 个值（true/false），实际提供了 ${rawAnswerValues.length} 项`,
        };
      }
      const val = normalizeJudgeValue(rawAnswerValues[0]);
      if (val === null) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 判断题答案值 '${String(rawAnswerValues[0])}' 无效，必须为 true/false、'A'/'B' 或 '正确'/'错误'`,
        };
      }
    }

    if (rawWrongs) {
      if (!Array.isArray(rawWrongs)) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 判断题错误答案必须为数组`,
        };
      }
      const seenJudgeWrongs = new Set<boolean>();
      for (const item of rawWrongs) {
        const val = normalizeJudgeValue(item);
        if (val === null) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 判断题错误答案值 '${String(item)}' 无效，必须为 true/false、'A'/'B' 或 '正确'/'错误'`,
          };
        }
        if (seenJudgeWrongs.has(val)) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 判断题错误答案数组包含重复项`,
          };
        }
        seenJudgeWrongs.add(val);
      }
    }
  } else if (q.type === "text") {
    // Fill-in-the-blank (text) validation
    if (q.options && q.options.length > 0) {
      return {
        valid: false,
        error: `题目 #${q.question_id} 为填空题，不应包含 options 选项列表`,
      };
    }

    if (rawAnswerValues) {
      if (!Array.isArray(rawAnswerValues)) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 填空题答案必须为数组`,
        };
      }
      if (rawAnswerValues.length === 0) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 填空题答案数组不能为空，如无答案请传入 null`,
        };
      }

      // Check each item is non-empty
      for (let i = 0; i < rawAnswerValues.length; i++) {
        const val = String(rawAnswerValues[i]).trim();
        if (!val) {
          return {
            valid: false,
            error: `题目 #${q.question_id} 填空题第 ${i + 1} 空答案不能为空字符串`,
          };
        }
      }

      // If blanks count is explicitly declared and > 0, length must match
      if (q.blanks != null && q.blanks > 0 && rawAnswerValues.length !== q.blanks) {
        return {
          valid: false,
          error: `题目 #${q.question_id} 填空题声明空数 (${q.blanks}) 与提供的答案数组长度 (${rawAnswerValues.length}) 不一致`,
        };
      }
    }
  }

  return { valid: true };
}

const AnswerItemSchema = t.Union([t.String(), t.Boolean(), t.Number()]);

const QuestionSchema = t.Object({
  question_id: t.String(),
  type: t.String(),
  stem: t.Optional(t.String()),
  embedding: t.Optional(
    t.Array(t.Number(), {
      minItems: EMBEDDING_DIMENSIONS,
      maxItems: EMBEDDING_DIMENSIONS,
    }),
  ),
  options: t.Optional(t.Array(t.Object({ id: t.String(), text: t.String() }))),
  blanks: t.Optional(t.Number()),
  correct_answers: t.Optional(t.Array(AnswerItemSchema)),
  wrong_answers: t.Optional(t.Array(AnswerItemSchema)),
  values: t.Optional(t.Array(AnswerItemSchema)),
});

const BatchUploadSchema = t.Object({
  tid: t.String(),
  cid: t.Optional(t.String()),
  task_name: t.Optional(t.String()),
  course_name: t.Optional(t.String()),
  questions: t.Array(QuestionSchema),
});

async function resolveSession(request: Request): Promise<{
  userId: string | null;
  isAnonymous: boolean;
}> {
  // Try standard session / apiKey session via Better Auth (enableSessionForAPIKeys handles both)
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      return {
        userId: session.user.id,
        isAnonymous: Boolean(session.user.isAnonymous),
      };
    }
  } catch {}

  return { userId: null, isAnonymous: true };
}

export const uploadRoutes = new Elysia({ prefix: "/upload" }).post(
  "/batch",
  async ({ body, request, set }) => {
    const { tid, cid, questions: inputQuestions } = body;
    const courseId = cid ?? tid; // fallback: use tid as cid if not provided

    // 0. Comprehensive validation for each question: type, HTML tags, options, and answers
    for (const q of inputQuestions) {
      let existingOptions: { id: string; text: string }[] | null | undefined = undefined;
      if (!q.options && (q.type === "single" || q.type === "multiple")) {
        const existing = await db.query.questions.findFirst({
          where: and(eq(questions.tid, tid), eq(questions.questionId, q.question_id)),
        });
        existingOptions = existing?.options as { id: string; text: string }[] | null;
      }

      const valResult = validateQuestionUpload(q, existingOptions);
      if (!valResult.valid) {
        set.status = 400;
        return {
          ok: false,
          error: valResult.error,
        };
      }
    }

    const sessionInfo = await resolveSession(request);
    const userId = sessionInfo.userId;
    const isAnonymous = sessionInfo.isAnonymous;
    const source = "plugin";

    // Upsert course
    await db
      .insert(courses)
      .values({ cid: courseId, name: body.course_name ?? null })
      .onConflictDoUpdate({
        target: courses.cid,
        set: {
          name: sql`COALESCE(EXCLUDED.name, ${courses.name})`,
          updatedAt: new Date(),
        },
      });

    // Upsert task group
    await db
      .insert(taskGroups)
      .values({ tid, cid: courseId, name: body.task_name ?? null })
      .onConflictDoUpdate({
        target: taskGroups.tid,
        set: {
          name: sql`COALESCE(EXCLUDED.name, ${taskGroups.name})`,
          updatedAt: new Date(),
        },
      });

    const results: {
      question_id: string;
      action: string;
      internal_id?: number;
    }[] = [];

    for (const q of inputQuestions) {
      // Determine standardized options and blanks
      let questionOptions = q.options ?? null;
      if (q.type === "judge") {
        // 判断题永远固定只有 A. 正确 和 B. 错误 两个选项
        questionOptions = JUDGE_OPTIONS;
      }

      const rawAnswerValues = q.values ?? q.correct_answers;
      let questionBlanks = q.blanks ?? 0;
      if (
        q.type === "text" &&
        (!questionBlanks || questionBlanks === 0) &&
        rawAnswerValues &&
        rawAnswerValues.length > 0
      ) {
        questionBlanks = rawAnswerValues.length;
      }

      // Prefer a plugin-provided vector. Only ask the server-side model when
      // the plugin omitted one and embedding generation is configured.
      // Include question options along with stem to significantly improve search hit rate.
      const embedding = await resolveEmbedding(q.stem, questionOptions, q.embedding);

      // ── Step 1: Find or create question ──
      // 1. Direct ID match
      let existing = await db.query.questions.findFirst({
        where: and(eq(questions.tid, tid), eq(questions.questionId, q.question_id)),
      });

      // 2. Fallback: match by stem hash if stem is provided
      if (!existing && q.stem) {
        const hash = hashStem(q.stem);
        existing =
          (await db.query.questions.findFirst({
            where: and(eq(questions.tid, tid), eq(questions.stemHash, hash)),
          })) ?? undefined;
      }

      // 3. Fallback: match by vector similarity if a vector is available
      if (!existing && embedding) {
        const vectorStr = `[${embedding.join(",")}]`;
        const similar = await db.execute(sql`
          SELECT q.*, 1 - (q.stem_embedding <=> ${vectorStr}::vector) AS similarity
          FROM questions q
          WHERE q.tid = ${tid} AND q.stem_embedding IS NOT NULL
          ORDER BY q.stem_embedding <=> ${vectorStr}::vector
          LIMIT 1
        `);
        if (
          similar.length > 0 &&
          Number((similar[0] as Record<string, unknown>).similarity) >= 0.85
        ) {
          existing = similar[0] as unknown as typeof questions.$inferSelect;
        }
      }

      let questionInternalId: number;
      let enrichedMetadata = false;

      if (existing) {
        questionInternalId = existing.id;

        // Enrich with stem/options/blanks if newly provided
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (q.stem && !existing.stem) {
          updates.stem = q.stem;
          updates.stemHash = hashStem(q.stem);
          enrichedMetadata = true;
        }
        const effectiveStem = q.stem ?? existing.stem;
        const effectiveOptions = (questionOptions ?? existing.options) as
          | { id: string; text: string }[]
          | null;

        if (q.type === "judge") {
          if (!existing.options) {
            updates.options = JUDGE_OPTIONS;
            enrichedMetadata = true;
          }
        } else if (questionOptions && !existing.options) {
          updates.options = questionOptions;
          enrichedMetadata = true;
        }

        if (embedding && !existing.stemEmbedding) {
          updates.stemEmbedding = embedding;
          enrichedMetadata = true;
        } else if (!existing.stemEmbedding && effectiveStem) {
          const resolved = await resolveEmbedding(effectiveStem, effectiveOptions);
          if (resolved) {
            updates.stemEmbedding = resolved;
            enrichedMetadata = true;
          }
        } else if (!existing.options && questionOptions && !q.embedding && effectiveStem) {
          // Newly enriched with options: recompute embedding to include options
          const recomputed = await resolveEmbedding(effectiveStem, effectiveOptions);
          if (recomputed) {
            updates.stemEmbedding = recomputed;
            enrichedMetadata = true;
          }
        }
        if (q.type === "text" && existing.blanks === 0 && questionBlanks > 0) {
          updates.blanks = questionBlanks;
          enrichedMetadata = true;
        }

        if (enrichedMetadata) {
          await db.update(questions).set(updates).where(eq(questions.id, existing.id));
        }
      } else {
        // Create new question
        const stemHash = q.stem ? hashStem(q.stem) : null;

        const [inserted] = await db
          .insert(questions)
          .values({
            tid,
            questionId: q.question_id,
            type: q.type,
            stem: q.stem ?? null,
            stemHash,
            stemEmbedding: embedding,
            options: questionOptions,
            blanks: questionBlanks,
          })
          .returning({ id: questions.id });
        questionInternalId = inserted!.id;
      }

      // ── Step 2: Handle answers ──
      const effectiveOptions = (questionOptions ?? existing?.options) as
        | { id: string; text: string }[]
        | null;

      let toSaveCorrect: unknown[] | null = null;
      let toSaveWrongs: unknown[] = [];

      if (q.type === "judge") {
        // 判断题：永远只有 A. 正确、B. 错误两个选项，以唯一的 boolean 项存储
        if (rawAnswerValues && rawAnswerValues.length > 0) {
          for (const item of rawAnswerValues) {
            const b = normalizeJudgeValue(item);
            if (b !== null) {
              toSaveCorrect = [b];
              break;
            }
          }
        }
        if (q.wrong_answers && q.wrong_answers.length > 0) {
          for (const item of q.wrong_answers) {
            const b = normalizeJudgeValue(item);
            if (b !== null && !toSaveWrongs.includes(b)) {
              toSaveWrongs.push(b);
            }
          }
        }
      } else if (q.type === "single" || q.type === "multiple") {
        // 单选、多选题：仅保存对应 options[].id 值的选项，而不是保存实际的答案文本内容
        const chosen = normalizeChoiceAnswers(rawAnswerValues ?? [], effectiveOptions);
        toSaveCorrect = chosen.length > 0 ? chosen : null;
        toSaveWrongs = normalizeChoiceAnswers(q.wrong_answers ?? [], effectiveOptions);
      } else {
        // 填空题 (text) 及其他题型：values[] 数组，其标号对应该题目提供的填空的空数
        if (rawAnswerValues && rawAnswerValues.length > 0) {
          toSaveCorrect = rawAnswerValues.map((v) => String(v));
        }
        if (q.wrong_answers && q.wrong_answers.length > 0) {
          toSaveWrongs = q.wrong_answers.map((v) => String(v));
        }
      }

      let action = "no_change";

      if (toSaveCorrect && toSaveCorrect.length > 0) {
        // Check if a correct answer already exists
        const existingCorrect = await db.query.answers.findFirst({
          where: and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, true)),
        });

        if (existingCorrect) {
          const isSameAnswer = areAnswerValuesEqual(
            existingCorrect.values as unknown[],
            toSaveCorrect,
          );

          if (isSameAnswer) {
            // Same answer: not an overwrite attempt, confirmed existing standard answer
            action = action === "no_change" ? "verified_correct" : action;
          } else if (isAnonymous) {
            // Anonymous cannot overwrite a confirmed different correct answer
            action = "denied_anonymous_overwrite";
          } else {
            // Authenticated overwrite
            await db
              .update(answers)
              .set({
                values: toSaveCorrect,
                source,
                submittedBy: userId,
                confidence: 1.0,
                updatedAt: new Date(),
              })
              .where(eq(answers.id, existingCorrect.id));
            action = "updated_correct";

            // Delete old wrong-answer exclusions since we updated the correct answer
            await db
              .delete(answers)
              .where(and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, false)));
          }
        } else {
          // No correct answer exists yet (could have no answers, or only wrong answer exclusions)
          // Any new correct answer is a NEW write (象限变化: 无答案->有答案 / 排除项->确定正确选项)
          await db.insert(answers).values({
            questionId: questionInternalId,
            values: toSaveCorrect,
            source,
            submittedBy: userId,
            isCorrect: true,
            confidence: 1.0,
          });
          action = "added_correct";

          // Delete old wrong-answer exclusions since we now have a confirmed correct answer
          await db
            .delete(answers)
            .where(and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, false)));
        }
      }

      if (toSaveWrongs.length > 0) {
        // Only add wrong answers if there's no confirmed correct answer
        const hasCorrect =
          action === "added_correct" ||
          action === "updated_correct" ||
          action === "verified_correct" ||
          Boolean(
            await db.query.answers.findFirst({
              where: and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, true)),
            }),
          );

        if (!hasCorrect) {
          // Upsert wrong answer exclusions
          // 象限变化: 无答案->增加排除项 / 排除项->增加更多排除项
          for (const wrongVal of toSaveWrongs) {
            const existingWrong = await db.query.answers.findFirst({
              where: and(
                eq(answers.questionId, questionInternalId),
                eq(answers.isCorrect, false),
                sql`${answers.values} @> ${JSON.stringify([wrongVal])}::jsonb`,
              ),
            });

            if (!existingWrong) {
              await db.insert(answers).values({
                questionId: questionInternalId,
                values: [wrongVal],
                source,
                submittedBy: userId,
                isCorrect: false,
                confidence: 0.5,
              });
              action = action === "no_change" ? "added_wrong" : action;
            }
          }
        }
      }

      if (action === "no_change") {
        if (!existing) {
          action = "added_question";
        } else if (enrichedMetadata) {
          action = "enriched_metadata";
        }
      }

      results.push({
        question_id: q.question_id,
        action,
        internal_id: questionInternalId,
      });
    }

    // Invalidate cached question queries as new/updated questions or answers were written
    questionCacheManager.clear();

    return { ok: true, results };
  },
  { body: BatchUploadSchema },
);
