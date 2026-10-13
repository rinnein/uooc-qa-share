import { env } from "@/lib/env";

/**
 * Generate an embedding vector for text using an OpenAI-compatible API.
 * Returns null if the embedding service is not configured.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiUrl = env.EMBEDDING_API_URL;
  const apiKey = env.EMBEDDING_API_KEY;
  const model = env.EMBEDDING_MODEL;

  if (!apiUrl || !apiKey) return null;

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
  return data.data[0]?.embedding ?? null;
}
