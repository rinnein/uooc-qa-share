import { Elysia, t } from "elysia";
import { db } from "@/db";
import { courses, taskGroups, questions, answers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const tasksRoutes = new Elysia()
  // Get all questions + answers in a task group
  .get(
    "/tasks/:tid",
    async ({ params }) => {
      const taskGroup = await db.query.taskGroups.findFirst({
        where: eq(taskGroups.tid, params.tid),
      });
      if (!taskGroup) return { error: "Task group not found", questions: [] };

      const qs = await db.query.questions.findMany({
        where: eq(questions.tid, params.tid),
      });

      // Batch-fetch answers for all questions
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

      const answersByQuestion = new Map<number, (typeof allAnswers)[0][]>();
      for (const a of allAnswers) {
        const list = answersByQuestion.get(a.questionId) ?? [];
        list.push(a);
        answersByQuestion.set(a.questionId, list);
      }

      return {
        taskGroup,
        questions: qs.map((q) => ({
          ...q,
          answers: answersByQuestion.get(q.id) ?? [],
        })),
      };
    },
    { params: t.Object({ tid: t.String() }) },
  )

  // Get task group metadata
  .get(
    "/tasks/:tid/info",
    async ({ params }) => {
      const taskGroup = await db.query.taskGroups.findFirst({
        where: eq(taskGroups.tid, params.tid),
      });
      if (!taskGroup) return { error: "Task group not found" };

      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(questions)
        .where(eq(questions.tid, params.tid));

      return { taskGroup, questionCount: Number(count[0]?.count ?? 0) };
    },
    { params: t.Object({ tid: t.String() }) },
  )

  // Get all task groups under a course
  .get(
    "/courses/:cid",
    async ({ params }) => {
      const course = await db.query.courses.findFirst({
        where: eq(courses.cid, params.cid),
      });
      if (!course) return { error: "Course not found", taskGroups: [] };

      const groups = await db.query.taskGroups.findMany({
        where: eq(taskGroups.cid, params.cid),
      });

      return { course, taskGroups: groups };
    },
    { params: t.Object({ cid: t.String() }) },
  )

  // Get questions in a specific course + task group
  .get(
    "/courses/:cid/tasks/:tid",
    async ({ params }) => {
      // Verify the tid belongs to the cid
      const taskGroup = await db.query.taskGroups.findFirst({
        where: eq(taskGroups.tid, params.tid),
      });
      if (!taskGroup || taskGroup.cid !== params.cid)
        return { error: "Task group not found in this course" };

      const qs = await db.query.questions.findMany({
        where: eq(questions.tid, params.tid),
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

      const answersByQuestion = new Map<number, (typeof allAnswers)[0][]>();
      for (const a of allAnswers) {
        const list = answersByQuestion.get(a.questionId) ?? [];
        list.push(a);
        answersByQuestion.set(a.questionId, list);
      }

      return {
        taskGroup,
        questions: qs.map((q) => ({
          ...q,
          answers: answersByQuestion.get(q.id) ?? [],
        })),
      };
    },
    {
      params: t.Object({ cid: t.String(), tid: t.String() }),
    },
  );
