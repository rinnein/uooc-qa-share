import { createHash } from "node:crypto";

/**
 * Check if a string contains HTML tags (e.g. <p>, <br>, <span>, etc.).
 */
export function hasHtmlTags(raw: string): boolean {
  return /<(?:[a-zA-Z/][a-zA-Z0-9:-]*\b[^>]*|!--[\s\S]*?--)>/i.test(raw);
}

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "") // strip HTML
    .replace(/&[a-z]+;/gi, " "); // strip HTML entities
}

/**
 * Normalize a question stem for hashing:
 * strip HTML tags, collapse whitespace, lowercase.
 */
export function normalizeStem(raw: string): string {
  return stripHtml(raw)
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
