import { env } from "@/lib/env";

export const EMBEDDING_DIMENSIONS = 1536;

/** Return whether the server can generate embeddings through its configured API. */
export function isEmbeddingConfigured(): boolean {
  return Boolean(env.EMBEDDING_API_URL && env.EMBEDDING_API_KEY);
}

/** Resolve a vector from the client first, then optionally from the server model. */
export async function resolveEmbedding(
  text: string | undefined,
  providedEmbedding?: number[],
): Promise<number[] | null> {
  if (providedEmbedding) return providedEmbedding;
  if (!text || !isEmbeddingConfigured()) return null;
  return generateEmbedding(text);
}

/**
 * Generate an embedding vector for text using an OpenAI-compatible API.
 * Returns null if the embedding service is not configured.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiUrl = env.EMBEDDING_API_URL;
  const apiKey = env.EMBEDDING_API_KEY;
  const model = env.EMBEDDING_MODEL;

  if (!isEmbeddingConfigured() || !apiUrl || !apiKey) return null;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    console.error(`Embedding API error: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = (await response.json()) as {
    data: { embedding: number[] }[];
  };
  const embedding = data.data[0]?.embedding;
  return embedding?.length === EMBEDDING_DIMENSIONS ? embedding : null;
}
