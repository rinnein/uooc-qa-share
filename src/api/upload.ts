import { Elysia, t } from "elysia";
import { db } from "@/db";
import { courses, taskGroups, questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashStem } from "@/lib/stem";
import { generateEmbedding } from "@/lib/embedding";
import { auth } from "@/lib/auth";

const QuestionSchema = t.Object({
  question_id: t.String(),
  type: t.Union([
    t.Literal("single"),
    t.Literal("multiple"),
    t.Literal("judge"),
    t.Literal("text"),
  ]),
  stem: t.Optional(t.Nullable(t.String())),
  options: t.Optional(t.Nullable(t.Array(t.Object({ id: t.String(), text: t.String() })))),
  blanks: t.Optional(t.Number()),
  correct_answers: t.Optional(t.Nullable(t.Array(t.String()))),
  wrong_answers: t.Optional(t.Nullable(t.Array(t.String()))),
});

const BatchUploadSchema = t.Object({
  tid: t.String(),
  cid: t.Optional(t.String()),
  task_name: t.Optional(t.String()),
  course_name: t.Optional(t.String()),
  questions: t.Array(QuestionSchema),
});

async function resolveSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
}

export const uploadRoutes = new Elysia({ prefix: "/upload" }).post(
  "/batch",
  async ({ body, request }) => {
    const session = await resolveSession(request);
    const userId = session?.user?.id ?? null;
    const isAnonymous = !session || session.user.isAnonymous === true;
    const source = "plugin";

    const { tid, cid, questions: inputQuestions } = body;
    const courseId = cid ?? tid; // fallback: use tid as cid if not provided

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

      // 3. Fallback: match by vector similarity if stem is provided and direct ID/hash match failed
      if (!existing && q.stem) {
        const embedding = await generateEmbedding(q.stem);
        if (embedding) {
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
      }

      let questionInternalId: number;

      if (existing) {
        questionInternalId = existing.id;

        // Enrich with stem/options if newly provided
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (q.stem && !existing.stem) {
          updates.stem = q.stem;
          updates.stemHash = hashStem(q.stem);
          const embedding = await generateEmbedding(q.stem);
          if (embedding) updates.stemEmbedding = embedding;
        }
        if (q.options && !existing.options) {
          updates.options = q.options;
        }

        await db.update(questions).set(updates).where(eq(questions.id, existing.id));
      } else {
        // Create new question
        const stemHash = q.stem ? hashStem(q.stem) : null;
        const embedding = q.stem ? await generateEmbedding(q.stem) : null;

        const [inserted] = await db
          .insert(questions)
          .values({
            tid,
            questionId: q.question_id,
            type: q.type,
            stem: q.stem ?? null,
            stemHash,
            stemEmbedding: embedding,
            options: q.options ?? null,
            blanks: q.blanks ?? 0,
          })
          .returning({ id: questions.id });
        questionInternalId = inserted!.id;
      }

      // ── Step 2: Handle answers ──
      let action = "no_change";

      if (q.correct_answers && q.correct_answers.length > 0) {
        // Check if a correct answer already exists
        const existingCorrect = await db.query.answers.findFirst({
          where: and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, true)),
        });

        if (existingCorrect) {
          // Overwrite existing correct answer
          if (isAnonymous) {
            results.push({
              question_id: q.question_id,
              action: "denied_anonymous_overwrite",
              internal_id: questionInternalId,
            });
            continue;
          }
          await db
            .update(answers)
            .set({
              values: q.correct_answers,
              source,
              submittedBy: userId,
              confidence: 1.0,
              updatedAt: new Date(),
            })
            .where(eq(answers.id, existingCorrect.id));
          action = "updated_correct";
        } else {
          // Insert new correct answer
          await db.insert(answers).values({
            questionId: questionInternalId,
            values: q.correct_answers,
            source,
            submittedBy: userId,
            isCorrect: true,
            confidence: 1.0,
          });
          action = "added_correct";
        }

        // Delete old wrong-answer exclusions since we now have a correct answer
        await db
          .delete(answers)
          .where(and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, false)));
      }

      if (q.wrong_answers && q.wrong_answers.length > 0) {
        // Only add wrong answers if there's no correct answer yet
        const hasCorrect = await db.query.answers.findFirst({
          where: and(eq(answers.questionId, questionInternalId), eq(answers.isCorrect, true)),
        });

        if (!hasCorrect) {
          // Upsert wrong answer exclusions
          for (const wrongVal of q.wrong_answers) {
            // Check if this wrong answer already exists
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

      results.push({
        question_id: q.question_id,
        action,
        internal_id: questionInternalId,
      });
    }

    return { ok: true, results };
  },
  { body: BatchUploadSchema },
);
