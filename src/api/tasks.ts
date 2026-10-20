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

  // Get all courses with task groups and statistics (supports pagination & search)
  .get(
    "/courses",
    async ({ query }) => {
      const page = Math.max(1, query.page ? Number.parseInt(query.page, 10) || 1 : 1);
      const pageSize = Math.min(
        50,
        Math.max(
          1,
          query.pageSize
            ? Number.parseInt(query.pageSize, 10) || 10
            : query.limit
              ? Number.parseInt(query.limit, 10) || 10
              : 10,
        ),
      );
      const q = query.q?.trim()?.toLowerCase();

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

      const excludedCounts = await db
        .select({
          tid: questions.tid,
          count: sql<number>`count(distinct ${questions.id})`,
        })
        .from(questions)
        .innerJoin(answers, eq(questions.id, answers.questionId))
        .where(eq(answers.isCorrect, false))
        .groupBy(questions.tid);

      const qMap = new Map<string, number>();
      for (const row of questionCounts) qMap.set(row.tid, Number(row.count));

      const aMap = new Map<string, number>();
      for (const row of answeredCounts) aMap.set(row.tid, Number(row.count));

      const eMap = new Map<string, number>();
      for (const row of excludedCounts) eMap.set(row.tid, Number(row.count));

      const groupsByCid = new Map<
        string,
        Array<{
          tid: string;
          cid: string;
          name: string | null;
          questionCount: number;
          answeredCount: number;
          excludedCount: number;
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
          excludedCount: eMap.get(g.tid) ?? 0,
        });
        groupsByCid.set(g.cid, list);
      }

      const mappedCourses = allCourses.map((c) => {
        const tGroups = groupsByCid.get(c.cid) ?? [];
        return {
          cid: c.cid,
          name: c.name,
          updatedAt: c.updatedAt,
          taskGroups: tGroups,
          taskGroupCount: tGroups.length,
          totalQuestions: tGroups.reduce((acc, g) => acc + g.questionCount, 0),
          totalAnswered: tGroups.reduce((acc, g) => acc + g.answeredCount, 0),
          totalExcluded: tGroups.reduce((acc, g) => acc + g.excludedCount, 0),
        };
      });

      // Filter by q if provided
      const filteredCourses = q
        ? mappedCourses.filter((c) => {
            const matchCid = c.cid.toLowerCase().includes(q);
            const matchName = c.name?.toLowerCase().includes(q) ?? false;
            const matchTask = c.taskGroups.some(
              (t) =>
                t.tid.toLowerCase().includes(q) || (t.name?.toLowerCase().includes(q) ?? false),
            );
            return matchCid || matchName || matchTask;
          })
        : mappedCourses;

      const total = filteredCourses.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;
      const paginatedCourses = filteredCourses.slice(offset, offset + pageSize);

      return {
        courses: paginatedCourses,
        total,
        page,
        pageSize,
        totalPages,
        allCoursesCount: allCourses.length,
        allTaskGroupsCount: allTaskGroups.length,
        allQuestionsCount: Array.from(qMap.values()).reduce((a, b) => a + b, 0),
      };
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
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

      const tids = groups.map((g) => g.tid);
      let questionCounts: { tid: string; count: number }[] = [];
      let answeredCounts: { tid: string; count: number }[] = [];
      let excludedCounts: { tid: string; count: number }[] = [];

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

        excludedCounts = await db
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
              eq(answers.isCorrect, false),
            ),
          )
          .groupBy(questions.tid);
      }

      const qMap = new Map<string, number>();
      for (const row of questionCounts) qMap.set(row.tid, Number(row.count));

      const aMap = new Map<string, number>();
      for (const row of answeredCounts) aMap.set(row.tid, Number(row.count));

      const eMap = new Map<string, number>();
      for (const row of excludedCounts) eMap.set(row.tid, Number(row.count));

      return {
        course,
        taskGroups: groups.map((g) => ({
          ...g,
          questionCount: qMap.get(g.tid) ?? 0,
          answeredCount: aMap.get(g.tid) ?? 0,
          excludedCount: eMap.get(g.tid) ?? 0,
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
