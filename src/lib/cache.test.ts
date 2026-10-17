import { describe, it, expect, beforeEach } from "vite-plus/test";
import { Elysia } from "elysia";
import { QuestionCacheManager, createQuestionCachePlugin } from "./cache";

describe("QuestionCacheManager", () => {
  let cache: QuestionCacheManager;

  beforeEach(() => {
    cache = new QuestionCacheManager(3); // Small capacity for testing
  });

  it("stores and retrieves cached items", () => {
    cache.set("key1", { data: "test" }, 60);
    const entry = cache.get("key1");
    expect(entry).toBeDefined();
    expect(entry?.data).toEqual({ data: "test" });
    expect(entry?.etag).toMatch(/^W\//);
  });

  it("expires items after TTL", async () => {
    cache.set("key-ttl", { val: 1 }, 0.05); // 50ms TTL
    expect(cache.get("key-ttl")).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cache.get("key-ttl")).toBeUndefined();
  });

  it("evicts oldest items when exceeding maxItems (LRU)", () => {
    cache.set("k1", 1, 60);
    cache.set("k2", 2, 60);
    cache.set("k3", 3, 60);

    // Access k1 so k2 becomes the oldest
    cache.get("k1");

    // Insert 4th item -> k2 should be evicted
    cache.set("k4", 4, 60);

    expect(cache.get("k2")).toBeUndefined();
    expect(cache.get("k1")).toBeDefined();
    expect(cache.get("k3")).toBeDefined();
    expect(cache.get("k4")).toBeDefined();
  });

  it("invalidates keys matching pattern or clears all", () => {
    cache.set("GET:/questions/1", 1, 60);
    cache.set("GET:/questions/2", 2, 60);
    cache.set("GET:/courses/1", 3, 60);

    cache.invalidate(/\/questions\//);

    expect(cache.get("GET:/questions/1")).toBeUndefined();
    expect(cache.get("GET:/questions/2")).toBeUndefined();
    expect(cache.get("GET:/courses/1")).toBeDefined();

    cache.clear();
    expect(cache.get("GET:/courses/1")).toBeUndefined();
  });

  it("generates deterministic ETags", () => {
    const etag1 = cache.generateEtag({ id: 10, text: "hello" });
    const etag2 = cache.generateEtag({ id: 10, text: "hello" });
    const etag3 = cache.generateEtag({ id: 11, text: "world" });

    expect(etag1).toBe(etag2);
    expect(etag1).not.toBe(etag3);
  });
});

describe("Elysia Question Cache Plugin", () => {
  let callCount = 0;
  const testApp = new Elysia()
    .use(createQuestionCachePlugin({ ttl: 60, searchTtl: 30 }))
    .get("/questions/:id", ({ params }) => {
      callCount++;
      if (params.id === "not-found") {
        return { error: "Question not found" };
      }
      return { id: params.id, stem: "测试题干" };
    })
    .get("/questions/search", ({ query }) => {
      callCount++;
      return { results: [{ id: 1, q: query.q }] };
    })
    .post("/questions/search", ({ body }) => {
      callCount++;
      return { results: [{ id: 1, body }] };
    });

  beforeEach(() => {
    callCount = 0;
  });

  it("returns X-Cache: MISS on first request, and X-Cache: HIT on subsequent request", async () => {
    // First request -> MISS
    const res1 = await testApp.handle(new Request("http://localhost/questions/100"));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("x-cache")).toBe("MISS");
    expect(res1.headers.get("etag")).toBeDefined();
    expect(res1.headers.get("cache-control")).toContain("public, max-age=");
    const data1 = await res1.json();
    expect(data1).toEqual({ id: "100", stem: "测试题干" });
    expect(callCount).toBe(1);

    // Second request -> HIT (handler is skipped)
    const res2 = await testApp.handle(new Request("http://localhost/questions/100"));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-cache")).toBe("HIT");
    expect(res2.headers.get("etag")).toBe(res1.headers.get("etag"));
    const data2 = await res2.json();
    expect(data2).toEqual({ id: "100", stem: "测试题干" });
    expect(callCount).toBe(1); // Handler was NOT called again!
  });

  it("returns HTTP 304 Not Modified when If-None-Match matches ETag", async () => {
    const res1 = await testApp.handle(new Request("http://localhost/questions/200"));
    const etag = res1.headers.get("etag");
    expect(etag).toBeTruthy();

    const res2 = await testApp.handle(
      new Request("http://localhost/questions/200", {
        headers: { "if-none-match": etag! },
      }),
    );

    expect(res2.status).toBe(304);
    expect(res2.headers.get("x-cache")).toBe("HIT");
  });

  it("bypasses cache when Cache-Control: no-cache is passed", async () => {
    await testApp.handle(new Request("http://localhost/questions/300"));
    expect(callCount).toBe(1);

    // Forced refresh
    const res = await testApp.handle(
      new Request("http://localhost/questions/300", {
        headers: { "cache-control": "no-cache" },
      }),
    );
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(callCount).toBe(2);
  });

  it("does not cache error responses", async () => {
    const res1 = await testApp.handle(new Request("http://localhost/questions/not-found"));
    expect(res1.headers.get("x-cache")).toBeNull();

    const res2 = await testApp.handle(new Request("http://localhost/questions/not-found"));
    expect(res2.headers.get("x-cache")).toBeNull();
    expect(callCount).toBe(2);
  });

  it("caches GET and POST /search requests based on query and body", async () => {
    // GET /questions/search?q=math
    const resGet1 = await testApp.handle(new Request("http://localhost/questions/search?q=math"));
    expect(resGet1.headers.get("x-cache")).toBe("MISS");

    const resGet2 = await testApp.handle(new Request("http://localhost/questions/search?q=math"));
    expect(resGet2.headers.get("x-cache")).toBe("HIT");

    // POST /questions/search with body
    const bodyStr = JSON.stringify({ q: "physics", limit: 10 });
    const resPost1 = await testApp.handle(
      new Request("http://localhost/questions/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyStr,
      }),
    );
    expect(resPost1.headers.get("x-cache")).toBe("MISS");

    const resPost2 = await testApp.handle(
      new Request("http://localhost/questions/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyStr,
      }),
    );
    expect(resPost2.headers.get("x-cache")).toBe("HIT");
  });
});
