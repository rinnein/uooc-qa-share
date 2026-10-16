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
