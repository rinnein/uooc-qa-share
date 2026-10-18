import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: any) => fn,
}));

import { onRequest } from "@/middleware";

describe("API Key Rate Limit & Session Resolution", () => {
  it("skips duplicate getSession verification on dedicated API routes in middleware", async () => {
    let nextCalled = false;
    const context = {
      request: new Request("http://localhost:4321/api/upload/batch", {
        method: "POST",
        headers: {
          "x-api-key": "uooc_test_key_123",
        },
      }),
      url: new URL("http://localhost:4321/api/upload/batch"),
      locals: {} as any,
    };

    const res = await (onRequest as any)(context, async () => {
      nextCalled = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(nextCalled).toBe(true);
    expect(res.status).toBe(200);
    // locals should not have been populated by getSession for /api/ routes
    expect(context.locals.user).toBeNull();
  });

  it("handles URL apiKey parameter and injects it as cookie on responses", async () => {
    const context = {
      request: new Request("http://localhost:4321/tasks?apiKey=uooc_url_key_abc", {
        method: "GET",
      }),
      url: new URL("http://localhost:4321/tasks?apiKey=uooc_url_key_abc"),
      locals: {} as any,
    };

    const res = await (onRequest as any)(context, async () => {
      return new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });

    expect(res.headers.get("Set-Cookie")).toContain("apiKey=uooc_url_key_abc");
  });
});
