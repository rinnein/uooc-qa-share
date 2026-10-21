import { describe, it, expect, vi } from "vite-plus/test";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
  },
}));

vi.mock("@/db", () => ({
  db: mockDb,
}));

import { getAllowedTaskTypesForLevel, matchQuestionBank } from "./auto-tasks";

describe("getAllowedTaskTypesForLevel", () => {
  it("should return empty array for level 'none'", () => {
    const tasks = getAllowedTaskTypesForLevel("none");
    expect(tasks).toEqual([]);
  });

  it("should return all request types including answer_request for level 'anonymous' as new writes", () => {
    const tasks = getAllowedTaskTypesForLevel("anonymous");
    expect(tasks).toContain("stem_request");
    expect(tasks).toContain("embedding_request");
    expect(tasks).toContain("options_request");
    expect(tasks).toContain("answer_request");
  });

  it("should return all task types for level 'authenticated' and 'admin'", () => {
    const authTasks = getAllowedTaskTypesForLevel("authenticated");
    expect(authTasks).toEqual([
      "stem_request",
      "embedding_request",
      "options_request",
      "answer_request",
    ]);

    const adminTasks = getAllowedTaskTypesForLevel("admin");
    expect(adminTasks).toEqual([
      "stem_request",
      "embedding_request",
      "options_request",
      "answer_request",
    ]);
  });
});

describe("matchQuestionBank", () => {
  it("should identify questions missing on server and filter matched tasks", async () => {
    const mockServerQuestions = [
      { id: 101, questionId: "q_existing_1", tid: "tid_1", cid: "cid_1" },
      { id: 102, questionId: "q_existing_2", tid: "tid_1", cid: "cid_1" },
    ];

    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
          where: vi.fn().mockResolvedValue(mockServerQuestions),
        }),
      }),
    }));

    const result = await matchQuestionBank({
      cid: "cid_1",
      tid: "tid_1",
      localQuestionIds: ["q_existing_1", "q_missing_server"],
      allowedTypes: ["stem_request"],
    });

    expect(result.scope.cid).toBe("cid_1");
    expect(result.scope.tid).toBe("tid_1");
    expect(result.stats.localCount).toBe(2);
    expect(result.stats.serverMatchedCount).toBe(1);
    expect(result.stats.missingOnServerCount).toBe(1);
    expect(result.missingOnServer).toHaveLength(1);
    expect(result.missingOnServer[0].questionId).toBe("q_missing_server");
  });
});
