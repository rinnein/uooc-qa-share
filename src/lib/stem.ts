import { createHash } from "node:crypto";

/**
 * Normalize a question stem for hashing:
 * strip HTML tags, collapse whitespace, lowercase.
 */
export function normalizeStem(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "") // strip HTML
    .replace(/&[a-z]+;/gi, " ") // strip HTML entities
    .replace(/\s+/g, " ") // collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Compute SHA-256 hash of a normalized stem.
 */
export function hashStem(raw: string): string {
  const normalized = normalizeStem(raw);
  return createHash("sha256").update(normalized).digest("hex");
}
