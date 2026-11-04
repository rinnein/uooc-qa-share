import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { Elysia } from "elysia";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      courses: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      taskGroups: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      questions: {
        findMany: vi.fn(),
      },
      answers: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
  },
}));

vi.mock("@/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/embedding", () => ({
  EMBEDDING_DIMENSIONS: 512,
  resolveEmbedding: vi.fn().mockResolvedValue(null),
}));

import { tasksRoutes } from "./tasks";
import { api } from "./index";

describe("Tasks API Filtering (Empty Task Groups)", () => {
  const app = new Elysia().use(tasksRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /courses filters out empty task groups and courses without valid task groups by default", async () => {
    // Setup courses: C1 (has valid & empty tasks), C2 (has excluded answers), C3 (only empty tasks)
    mockDb.query.courses.findMany.mockResolvedValueOnce([
      { cid: "c1", name: "高等数学", updatedAt: new Date() },
      { cid: "c2", name: "大学物理", updatedAt: new Date() },
      { cid: "c3", name: "线性代数", updatedAt: new Date() },
    ]);

    mockDb.query.taskGroups.findMany.mockResolvedValueOnce([
      { tid: "t1", cid: "c1", name: "第1章测验", updatedAt: new Date() },
      { tid: "t2", cid: "c1", name: "第2章测验(空)", updatedAt: new Date() },
      { tid: "t3", cid: "c2", name: "物测1", updatedAt: new Date() },
      { tid: "t4", cid: "c3", name: "线代测验(全空)", updatedAt: new Date() },
    ]);

    // 1. questionCounts
    const selectMock1 = {
      from: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValueOnce([
          { tid: "t1", count: 10 },
          { tid: "t2", count: 5 },
          { tid: "t3", count: 8 },
          { tid: "t4", count: 12 },
        ]),
      }),
    };
    // 2. answeredCounts (isCorrect = true)
    const selectMock2 = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t1", count: 6 }]),
          }),
        }),
      }),
    };
    // 3. excludedCounts (isCorrect = false)
    const selectMock3 = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t3", count: 2 }]),
          }),
        }),
      }),
    };

    mockDb.select
      .mockReturnValueOnce(selectMock1)
      .mockReturnValueOnce(selectMock2)
      .mockReturnValueOnce(selectMock3);

    const res = await app.handle(new Request("http://localhost/courses"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // C3 has 0 valid quizzes, so it should be filtered out
    expect(data.courses).toHaveLength(2);
    expect(data.courses.map((c: any) => c.cid)).toEqual(["c1", "c2"]);

    // C1 should only retain t1 (t2 is empty: 0 answered, 0 excluded)
    const c1 = data.courses.find((c: any) => c.cid === "c1");
    expect(c1.taskGroups).toHaveLength(1);
    expect(c1.taskGroups[0].tid).toBe("t1");
    expect(c1.taskGroupCount).toBe(1);
    expect(c1.totalQuestions).toBe(10);
    expect(c1.totalAnswered).toBe(6);

    // C2 has t3 (0 correct, but 2 excluded -> non-empty)
    const c2 = data.courses.find((c: any) => c.cid === "c2");
    expect(c2.taskGroups).toHaveLength(1);
    expect(c2.taskGroups[0].tid).toBe("t3");
    expect(c2.totalQuestions).toBe(8);
    expect(c2.totalExcluded).toBe(2);

    // Global counts should reflect filtered results
    expect(data.allCoursesCount).toBe(2);
    expect(data.allTaskGroupsCount).toBe(2); // t1 and t3
    expect(data.allQuestionsCount).toBe(18); // 10 (t1) + 8 (t3)
  });

  it("GET /courses?hideEmpty=false returns all courses and all task groups", async () => {
    mockDb.query.courses.findMany.mockResolvedValueOnce([
      { cid: "c1", name: "高等数学", updatedAt: new Date() },
      { cid: "c2", name: "大学物理", updatedAt: new Date() },
      { cid: "c3", name: "线性代数", updatedAt: new Date() },
    ]);

    mockDb.query.taskGroups.findMany.mockResolvedValueOnce([
      { tid: "t1", cid: "c1", name: "第1章测验", updatedAt: new Date() },
      { tid: "t2", cid: "c1", name: "第2章测验(空)", updatedAt: new Date() },
      { tid: "t3", cid: "c2", name: "物测1", updatedAt: new Date() },
      { tid: "t4", cid: "c3", name: "线代测验(全空)", updatedAt: new Date() },
    ]);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValueOnce([
            { tid: "t1", count: 10 },
            { tid: "t2", count: 5 },
            { tid: "t3", count: 8 },
            { tid: "t4", count: 12 },
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t1", count: 6 }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t3", count: 2 }]),
            }),
          }),
        }),
      });

    const res = await app.handle(new Request("http://localhost/courses?hideEmpty=false"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // All 3 courses and all 4 task groups returned
    expect(data.courses).toHaveLength(3);
    expect(data.allCoursesCount).toBe(3);
    expect(data.allTaskGroupsCount).toBe(4);
    expect(data.allQuestionsCount).toBe(35); // 10 + 5 + 8 + 12
  });

  it("GET /courses/:cid filters out empty task groups by default", async () => {
    mockDb.query.courses.findFirst.mockResolvedValueOnce({
      cid: "c1",
      name: "高等数学",
    });

    mockDb.query.taskGroups.findMany.mockResolvedValueOnce([
      { tid: "t1", cid: "c1", name: "第1章" },
      { tid: "t2", cid: "c1", name: "第2章(空)" },
    ]);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValueOnce([
              { tid: "t1", count: 10 },
              { tid: "t2", count: 5 },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t1", count: 4 }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        }),
      });

    const res = await app.handle(new Request("http://localhost/courses/c1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Only t1 should be returned
    expect(data.taskGroups).toHaveLength(1);
    expect(data.taskGroups[0].tid).toBe("t1");
    expect(data.taskGroups[0].answeredCount).toBe(4);
  });

  it("GET /courses/:cid?hideEmpty=false returns all task groups", async () => {
    mockDb.query.courses.findFirst.mockResolvedValueOnce({
      cid: "c1",
      name: "高等数学",
    });

    mockDb.query.taskGroups.findMany.mockResolvedValueOnce([
      { tid: "t1", cid: "c1", name: "第1章" },
      { tid: "t2", cid: "c1", name: "第2章(空)" },
    ]);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValueOnce([
              { tid: "t1", count: 10 },
              { tid: "t2", count: 5 },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([{ tid: "t1", count: 4 }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        }),
      });

    const res = await app.handle(new Request("http://localhost/courses/c1?hideEmpty=false"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Both t1 and t2 returned
    expect(data.taskGroups).toHaveLength(2);
    expect(data.taskGroups.map((g: any) => g.tid)).toEqual(["t1", "t2"]);
  });
});

describe("Stats API Filtering (GET /api/stats)", () => {
  it("computes stats and excludes empty task groups, courses, and questions", async () => {
    mockDb.select
      // qCount (questions in non-empty quizzes)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([{ count: 18 }]),
        }),
      })
      // cCount (courses with non-empty quizzes)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockResolvedValueOnce([{ count: 2 }]),
          }),
        }),
      })
      // tCount (non-empty task groups)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockResolvedValueOnce([{ count: 2 }]),
        }),
      })
      // aCount (correct answers)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([{ count: 6 }]),
        }),
      })
      // wCount (excluded answers)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValueOnce([{ count: 2 }]),
        }),
      });

    const res = await api.handle(new Request("http://localhost/api/stats"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      questions: 18,
      courses: 2,
      taskGroups: 2,
      correctAnswers: 6,
      excludedAnswers: 2,
    });
  });
});
