import { describe, it, expect, vi } from "vite-plus/test";

const { mockDb, mockGenerateEmbedding } = vi.hoisted(() => ({
  mockDb: {
    query: {
      questions: {
        findMany: vi.fn(),
      },
      answers: {
        findMany: vi.fn(),
      },
    },
    execute: vi.fn(),
  },
  mockGenerateEmbedding: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/embedding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embedding")>();
  return {
    ...actual,
    EMBEDDING_DIMENSIONS: 512,
    generateEmbedding: mockGenerateEmbedding,
  };
});

import { searchQuestionsInternal } from "./questions";

describe("searchQuestionsInternal", () => {
  it("uses client-provided vector directly without calling generateEmbedding on server", async () => {
    mockGenerateEmbedding.mockClear();
    mockDb.execute.mockResolvedValueOnce([{ id: 1, stem: "测试题干" }]);

    const clientVector = Array.from({ length: 512 }, (_, i) => i / 512);

    const result = await searchQuestionsInternal({
      q: "任意关键词",
      embedding: clientVector,
    });

    expect(result.results).toEqual([{ id: 1, stem: "测试题干", answers: [] }]);
    // Must NOT call server embedding generator
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });

  it("calls generateEmbedding on server when no client vector is supplied", async () => {
    mockGenerateEmbedding.mockClear();
    const serverVector = Array.from({ length: 512 }, () => 0.1);
    mockGenerateEmbedding.mockResolvedValueOnce(serverVector);
    mockDb.execute.mockResolvedValueOnce([{ id: 2, stem: "服务端计算题干" }]);

    const result = await searchQuestionsInternal({
      q: "需服务端计算的文本",
    });

    expect(result.results).toEqual([{ id: 2, stem: "服务端计算题干", answers: [] }]);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("需服务端计算的文本");
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });

  it("calls generateEmbedding on server with stem and options combined when options are supplied", async () => {
    mockGenerateEmbedding.mockClear();
    const serverVector = Array.from({ length: 512 }, () => 0.1);
    mockGenerateEmbedding.mockResolvedValueOnce(serverVector);
    mockDb.execute.mockResolvedValueOnce([{ id: 4, stem: "题目带选项" }]);

    const result = await searchQuestionsInternal({
      q: "题目题干",
      options: [
        { id: "A", text: "选项内容A" },
        { id: "B", text: "选项内容B" },
      ],
    });

    expect(result.results).toEqual([{ id: 4, stem: "题目带选项", answers: [] }]);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("题目题干\nA. 选项内容A\nB. 选项内容B");
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });

  it("falls back to ILIKE text search when embedding is null and no client vector is provided", async () => {
    mockGenerateEmbedding.mockClear();
    mockGenerateEmbedding.mockResolvedValueOnce(null);
    mockDb.query.questions.findMany.mockResolvedValueOnce([{ id: 3, stem: "文本模糊搜索" }]);

    const result = await searchQuestionsInternal({
      q: "文本模糊",
    });

    expect(result.results).toEqual([{ id: 3, stem: "文本模糊搜索", answers: [] }]);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("文本模糊");
    expect(mockDb.query.questions.findMany).toHaveBeenCalledOnce();
  });

  it("attaches answers (including correct and excluded answers) to search results", async () => {
    mockGenerateEmbedding.mockClear();
    mockGenerateEmbedding.mockResolvedValueOnce(null);
    mockDb.query.questions.findMany.mockResolvedValueOnce([{ id: 10, stem: "含答案测试题" }]);
    mockDb.query.answers.findMany.mockResolvedValueOnce([
      { id: 101, questionId: 10, values: ["A"], isCorrect: true },
      { id: 102, questionId: 10, values: ["C"], isCorrect: false },
    ]);

    const result = await searchQuestionsInternal({
      q: "含答案测试题",
    });

    expect(result.results).toEqual([
      {
        id: 10,
        stem: "含答案测试题",
        answers: [
          { id: 101, questionId: 10, values: ["A"], isCorrect: true },
          { id: 102, questionId: 10, values: ["C"], isCorrect: false },
        ],
      },
    ]);
  });
});
