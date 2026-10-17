import { Elysia, t } from "elysia";
import { db } from "@/db";
import { courses, taskGroups, questions, answers } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

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

  // Get all courses with task groups and statistics
  .get("/courses", async () => {
    const allCourses = await db.query.courses.findMany({
      orderBy: (c, { desc }) => [desc(c.updatedAt)],
    });

    const allTaskGroups = await db.query.taskGroups.findMany({
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    const questionCounts = await db
      .select({
        tid: questions.tid,
        count: sql<number>`count(*)`,
      })
      .from(questions)
      .groupBy(questions.tid);

    const answeredCounts = await db
      .select({
        tid: questions.tid,
        count: sql<number>`count(distinct ${questions.id})`,
      })
      .from(questions)
      .innerJoin(answers, eq(questions.id, answers.questionId))
      .where(eq(answers.isCorrect, true))
      .groupBy(questions.tid);

    const qMap = new Map<string, number>();
    for (const row of questionCounts) qMap.set(row.tid, Number(row.count));

    const aMap = new Map<string, number>();
    for (const row of answeredCounts) aMap.set(row.tid, Number(row.count));

    const groupsByCid = new Map<
      string,
      Array<{
        tid: string;
        cid: string;
        name: string | null;
        questionCount: number;
        answeredCount: number;
      }>
    >();

    for (const g of allTaskGroups) {
      const list = groupsByCid.get(g.cid) ?? [];
      list.push({
        tid: g.tid,
        cid: g.cid,
        name: g.name,
        questionCount: qMap.get(g.tid) ?? 0,
        answeredCount: aMap.get(g.tid) ?? 0,
      });
      groupsByCid.set(g.cid, list);
    }

    return {
      courses: allCourses.map((c) => {
        const tGroups = groupsByCid.get(c.cid) ?? [];
        return {
          cid: c.cid,
          name: c.name,
          updatedAt: c.updatedAt,
          taskGroups: tGroups,
          taskGroupCount: tGroups.length,
          totalQuestions: tGroups.reduce((acc, g) => acc + g.questionCount, 0),
          totalAnswered: tGroups.reduce((acc, g) => acc + g.answeredCount, 0),
        };
      }),
    };
  })

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

      const tids = groups.map((g) => g.tid);
      let questionCounts: { tid: string; count: number }[] = [];
      let answeredCounts: { tid: string; count: number }[] = [];

      if (tids.length > 0) {
        questionCounts = await db
          .select({
            tid: questions.tid,
            count: sql<number>`count(*)`,
          })
          .from(questions)
          .where(
            sql`${questions.tid} IN (${sql.join(
              tids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
          .groupBy(questions.tid);

        answeredCounts = await db
          .select({
            tid: questions.tid,
            count: sql<number>`count(distinct ${questions.id})`,
          })
          .from(questions)
          .innerJoin(answers, eq(questions.id, answers.questionId))
          .where(
            and(
              sql`${questions.tid} IN (${sql.join(
                tids.map((id) => sql`${id}`),
                sql`, `,
              )})`,
              eq(answers.isCorrect, true),
            ),
          )
          .groupBy(questions.tid);
      }

      const qMap = new Map<string, number>();
      for (const row of questionCounts) qMap.set(row.tid, Number(row.count));

      const aMap = new Map<string, number>();
      for (const row of answeredCounts) aMap.set(row.tid, Number(row.count));

      return {
        course,
        taskGroups: groups.map((g) => ({
          ...g,
          questionCount: qMap.get(g.tid) ?? 0,
          answeredCount: aMap.get(g.tid) ?? 0,
        })),
      };
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
