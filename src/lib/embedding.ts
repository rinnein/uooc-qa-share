import { env } from "@/lib/env";

export const EMBEDDING_DIMENSIONS = 512;

export interface OptionItem {
  id?: string;
  text?: string;
}

/** Return whether the server can generate embeddings through its configured API. */
export function isEmbeddingConfigured(): boolean {
  return Boolean(env.EMBEDDING_API_URL && env.EMBEDDING_API_KEY);
}

/**
 * Build combined text from question stem and options for embedding calculation.
 * Including options significantly improves question search hit rate.
 */
export function buildEmbeddingText(stem?: string | null, options?: OptionItem[] | null): string {
  const parts: string[] = [];
  const trimmedStem = stem?.trim();
  if (trimmedStem) {
    parts.push(trimmedStem);
  }

  if (options && Array.isArray(options) && options.length > 0) {
    const optionLines = options
      .map((opt) => {
        if (!opt) return "";
        const id = opt.id?.trim();
        const text = opt.text?.trim();
        if (!text) return "";
        if (id) {
          // If text already starts with the id (e.g. "A. xxx" or "A、xxx" or "A: xxx"), avoid redundant prefix
          if (new RegExp(`^${id}[.、:：\\s]`, "i").test(text)) {
            return text;
          }
          return `${id}. ${text}`;
        }
        return text;
      })
      .filter(Boolean);

    if (optionLines.length > 0) {
      parts.push(optionLines.join("\n"));
    }
  }

  return parts.join("\n");
}

/** Resolve a vector from the client first, then optionally from the server model using stem and options. */
export async function resolveEmbedding(
  stemOrText: string | undefined,
  optionsOrEmbedding?: OptionItem[] | number[] | null,
  providedEmbedding?: number[],
): Promise<number[] | null> {
  let finalProvidedEmbedding = providedEmbedding;
  let finalOptions: OptionItem[] | null = null;

  if (Array.isArray(optionsOrEmbedding)) {
    if (optionsOrEmbedding.length > 0 && typeof optionsOrEmbedding[0] === "number") {
      finalProvidedEmbedding = optionsOrEmbedding as number[];
    } else {
      finalOptions = optionsOrEmbedding as OptionItem[];
    }
  }

  if (finalProvidedEmbedding) return finalProvidedEmbedding;
  const text = buildEmbeddingText(stemOrText, finalOptions);
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
