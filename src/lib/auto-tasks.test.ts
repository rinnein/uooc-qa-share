import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("@/db", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
  },
}));

import { getAllowedTaskTypesForLevel } from "./auto-tasks";

describe("getAllowedTaskTypesForLevel", () => {
  it("should return empty array for level 'none'", () => {
    const tasks = getAllowedTaskTypesForLevel("none");
    expect(tasks).toEqual([]);
  });

  it("should return stem, embedding, and options requests for level 'anonymous'", () => {
    const tasks = getAllowedTaskTypesForLevel("anonymous");
    expect(tasks).toContain("stem_request");
    expect(tasks).toContain("embedding_request");
    expect(tasks).toContain("options_request");
    expect(tasks).not.toContain("answer_request");
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
