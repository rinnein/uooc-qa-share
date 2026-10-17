import { Elysia } from "elysia";

export interface CacheEntry<T = unknown> {
  data: T;
  etag: string;
  expiresAt: number;
  createdAt: number;
}

export class QuestionCacheManager {
  private cache = new Map<string, CacheEntry>();
  private maxItems: number;

  constructor(maxItems = 1000) {
    this.maxItems = maxItems;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh LRU order: delete and re-insert
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: string, data: unknown, ttlSeconds: number, etag?: string): CacheEntry {
    if (this.cache.size >= this.maxItems) {
      // Evict oldest entry (first item in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const calculatedEtag = etag ?? this.generateEtag(data);
    const entry: CacheEntry = {
      data,
      etag: calculatedEtag,
      expiresAt: Date.now() + ttlSeconds * 1000,
      createdAt: Date.now(),
    };
    this.cache.set(key, entry);
    return entry;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(pattern?: RegExp | string): number {
    if (!pattern) {
      const count = this.cache.size;
      this.cache.clear();
      return count;
    }
    let count = 0;
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    for (const key of Array.from(this.cache.keys())) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxItems: this.maxItems,
    };
  }

  generateEtag(data: unknown): string {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    // 32-bit FNV-1a hash
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `W/"${(hash >>> 0).toString(36)}-${str.length.toString(36)}"`;
  }
}

export const questionCacheManager = new QuestionCacheManager(1000);

export interface QuestionCacheOptions {
  ttl?: number; // default TTL in seconds (e.g. 60)
  singleQuestionTtl?: number; // TTL for single question detail (e.g. 180s)
  searchTtl?: number; // TTL for search results (e.g. 60s)
}

/**
 * Elysia plugin for Question query caching.
 * Leverages Elysia's lifecycle hooks (`onBeforeHandle`, `onAfterHandle`)
 * to intercept question requests, return cached responses with ETag / 304 Not Modified,
 * and populate HTTP caching headers (Cache-Control, X-Cache).
 */
export function createQuestionCachePlugin(options: QuestionCacheOptions = {}) {
  const defaultTtl = options.ttl ?? 60;
  const singleQuestionTtl = options.singleQuestionTtl ?? 180;
  const searchTtl = options.searchTtl ?? 60;

  return new Elysia({ name: "question-cache" })
    .onBeforeHandle({ as: "scoped" }, async ({ request, set, body }) => {
      // 1. Bypass cache if client requested no-cache or explicit refresh
      const cacheControl = request.headers.get("cache-control");
      if (cacheControl?.includes("no-cache") || request.headers.get("x-refresh") === "true") {
        return;
      }

      const method = request.method;
      const url = new URL(request.url);

      let cacheKey: string | null = null;
      if (method === "GET") {
        cacheKey = `GET:${url.pathname}${url.search}`;
      } else if (method === "POST" && url.pathname.endsWith("/search")) {
        cacheKey = `POST:${url.pathname}:${JSON.stringify(body ?? {})}`;
      }

      if (!cacheKey) return;

      const cached = questionCacheManager.get(cacheKey);
      if (cached) {
        // ETag conditional check (HTTP 304 Not Modified)
        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch && ifNoneMatch === cached.etag) {
          set.status = 304;
          set.headers["etag"] = cached.etag;
          set.headers["x-cache"] = "HIT";
          return "";
        }

        const remainingTtl = Math.max(1, Math.ceil((cached.expiresAt - Date.now()) / 1000));
        set.headers["x-cache"] = "HIT";
        set.headers["etag"] = cached.etag;
        set.headers["cache-control"] =
          `public, max-age=${remainingTtl}, stale-while-revalidate=120`;
        return cached.data;
      }
    })
    .onAfterHandle({ as: "scoped" }, ({ request, response, set, body }) => {
      // Skip if response was already served from cache hit
      if (set.headers["x-cache"] === "HIT") return;

      // Don't cache error responses or non-object payloads
      if (set.status && Number(set.status) >= 400) return;
      if (!response || typeof response !== "object") return;
      if (
        "error" in (response as Record<string, unknown>) &&
        Boolean((response as Record<string, unknown>).error)
      ) {
        return;
      }

      const method = request.method;
      const url = new URL(request.url);

      let cacheKey: string | null = null;
      let ttl = defaultTtl;

      if (method === "GET") {
        cacheKey = `GET:${url.pathname}${url.search}`;
        if (url.pathname.includes("/questions/") && !url.pathname.endsWith("/search")) {
          ttl = singleQuestionTtl;
        } else {
          ttl = searchTtl;
        }
      } else if (method === "POST" && url.pathname.endsWith("/search")) {
        cacheKey = `POST:${url.pathname}:${JSON.stringify(body ?? {})}`;
        ttl = searchTtl;
      }

      if (cacheKey) {
        const entry = questionCacheManager.set(cacheKey, response, ttl);
        set.headers["x-cache"] = "MISS";
        set.headers["etag"] = entry.etag;
        set.headers["cache-control"] = `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`;
      }
    });
}

export const questionCachePlugin = createQuestionCachePlugin();
