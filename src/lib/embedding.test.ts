import { afterEach, describe, expect, it, vi } from "vite-plus/test";

async function loadEmbeddingModule(config: {
  EMBEDDING_API_URL?: string;
  EMBEDDING_API_KEY?: string;
}) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      ...config,
      EMBEDDING_MODEL: "test-model",
    },
  }));
  return import("./embedding");
}

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.restoreAllMocks();
});

describe("buildEmbeddingText", () => {
  it("combines stem and options with prefix", async () => {
    const { buildEmbeddingText } = await loadEmbeddingModule({});
    const text = buildEmbeddingText("以下属于监督学习的是", [
      { id: "A", text: "线性回归" },
      { id: "B", text: "K-Means" },
    ]);
    expect(text).toBe("以下属于监督学习的是\nA. 线性回归\nB. K-Means");
  });

  it("avoids redundant prefix when option text already starts with the id", async () => {
    const { buildEmbeddingText } = await loadEmbeddingModule({});
    const text = buildEmbeddingText("题目题干", [
      { id: "A", text: "A. 选项A内容" },
      { id: "B", text: "B、选项B内容" },
      { id: "C", text: "C: 选项C内容" },
    ]);
    expect(text).toBe("题目题干\nA. 选项A内容\nB、选项B内容\nC: 选项C内容");
  });

  it("handles null/empty options gracefully", async () => {
    const { buildEmbeddingText } = await loadEmbeddingModule({});
    expect(buildEmbeddingText("仅题干", null)).toBe("仅题干");
    expect(buildEmbeddingText("仅题干", [])).toBe("仅题干");
    expect(buildEmbeddingText("", [{ id: "A", text: "选项A" }])).toBe("A. 选项A");
    expect(buildEmbeddingText(null, null)).toBe("");
  });
});

describe("embedding resolution", () => {
  it("does not call fetch when the server embedding API is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateEmbedding, resolveEmbedding } = await loadEmbeddingModule({});

    await expect(generateEmbedding("题干")).resolves.toBeNull();
    await expect(resolveEmbedding("题干")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a client vector without calling the server model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { resolveEmbedding } = await loadEmbeddingModule({
      EMBEDDING_API_URL: "https://embedding.test/v1/embeddings",
      EMBEDDING_API_KEY: "test-key",
    });
    const clientEmbedding = [0.1, 0.2];

    await expect(resolveEmbedding("题干", clientEmbedding)).resolves.toBe(clientEmbedding);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the configured server model when no client vector is supplied", async () => {
    const serverEmbedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: serverEmbedding }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { resolveEmbedding } = await loadEmbeddingModule({
      EMBEDDING_API_URL: "https://embedding.test/v1/embeddings",
      EMBEDDING_API_KEY: "test-key",
    });

    await expect(resolveEmbedding("题干")).resolves.toEqual(serverEmbedding);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("calls the configured server model combining stem and options", async () => {
    const serverEmbedding = Array.from({ length: 1536 }, (_, index) => index / 1536);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: serverEmbedding }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { resolveEmbedding } = await loadEmbeddingModule({
      EMBEDDING_API_URL: "https://embedding.test/v1/embeddings",
      EMBEDDING_API_KEY: "test-key",
    });

    const options = [
      { id: "A", text: "选项A" },
      { id: "B", text: "选项B" },
    ];
    await expect(resolveEmbedding("题干文本", options)).resolves.toEqual(serverEmbedding);
    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.input).toBe("题干文本\nA. 选项A\nB. 选项B");
  });

  it("rejects server vectors with an incompatible dimension", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { generateEmbedding } = await loadEmbeddingModule({
      EMBEDDING_API_URL: "https://embedding.test/v1/embeddings",
      EMBEDDING_API_KEY: "test-key",
    });

    await expect(generateEmbedding("题干")).resolves.toBeNull();
  });
});
