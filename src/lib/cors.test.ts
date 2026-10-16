import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: any) => fn,
}));

import {
  isOriginAllowed,
  matchesPattern,
  handleCorsPreflight,
  applyCorsHeaders,
  isCorsPath,
} from "./cors";
import { ALL } from "@/pages/api/auth/[...all]";
import { api } from "@/api";
import { onRequest } from "@/middleware";

describe("CORS utility functions", () => {
  it("matches wildcard and exact patterns correctly", () => {
    expect(matchesPattern("tauri://localhost", "tauri://*")).toBe(true);
    expect(matchesPattern("https://tauri.localhost", "https://tauri.localhost")).toBe(true);
    expect(matchesPattern("https://sub.uooc.net.cn", "https://*.uooc.net.cn")).toBe(true);
    expect(matchesPattern("https://uooc.net.cn", "https://*.uooc.net.cn")).toBe(true);
    expect(matchesPattern("http://localhost:3000", "http://localhost:*")).toBe(true);
    expect(matchesPattern("https://evil.com", "http://localhost:*")).toBe(false);
  });

  it("identifies allowed origins for Tauri, dev, and UOOC", () => {
    // Tauri schemes
    expect(isOriginAllowed("tauri://localhost")).toBe(true);
    expect(isOriginAllowed("tauri://my-app")).toBe(true);
    expect(isOriginAllowed("https://tauri.localhost")).toBe(true);
    expect(isOriginAllowed("http://tauri.localhost")).toBe(true);
    expect(isOriginAllowed("https://sub.tauri.localhost")).toBe(true);

    // Local development
    expect(isOriginAllowed("http://localhost:1420")).toBe(true);
    expect(isOriginAllowed("http://localhost:5173")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:8080")).toBe(true);

    // WebViews & official domains
    expect(isOriginAllowed("vscode-webview://something")).toBe(true);
    expect(isOriginAllowed("https://www.uooc.net.cn")).toBe(true);
    expect(isOriginAllowed("https://api.uooc.net.cn")).toBe(true);

    // Disallowed origins
    expect(isOriginAllowed("https://malicious.org")).toBe(false);
    expect(isOriginAllowed("http://fake-uooc.net.cn")).toBe(false);
    expect(isOriginAllowed(null)).toBe(false);
    expect(isOriginAllowed(undefined)).toBe(false);
    expect(isOriginAllowed("")).toBe(false);
  });

  it("identifies CORS target paths", () => {
    expect(isCorsPath("/api/auth/get-session")).toBe(true);
    expect(isCorsPath("/api/questions")).toBe(true);
    expect(isCorsPath("/api")).toBe(true);
    expect(isCorsPath("/mcp")).toBe(true);
    expect(isCorsPath("/mcp/tools")).toBe(true);
    expect(isCorsPath("/.well-known/agent-configuration")).toBe(true);
    expect(isCorsPath("/questions/123")).toBe(false);
    expect(isCorsPath("/")).toBe(false);
  });

  it("handles CORS preflight (OPTIONS) with credentials", () => {
    const req = new Request("http://localhost:4321/api/auth/sign-in/email", {
      method: "OPTIONS",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, authorization, x-api-key",
      },
    });

    const res = handleCorsPreflight(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type, authorization, x-api-key",
    );
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("does not allow credentials or origin for unauthorized origins in preflight", () => {
    const req = new Request("http://localhost:4321/api/auth/sign-in/email", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.org",
        "access-control-request-method": "POST",
      },
    });

    const res = handleCorsPreflight(req);
    expect(res.headers.get("access-control-allow-origin")).toBe(null);
    expect(res.headers.get("access-control-allow-credentials")).toBe(null);
  });

  it("applies CORS headers and overrides wildcard with specific origin", () => {
    const req = new Request("http://localhost:4321/api/tasks", {
      headers: {
        origin: "https://tauri.localhost",
      },
    });

    // Simulate an inner response that had wildcard origin
    const originalRes = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

    const finalRes = applyCorsHeaders(req, originalRes);
    expect(finalRes.headers.get("access-control-allow-origin")).toBe("https://tauri.localhost");
    expect(finalRes.headers.get("access-control-allow-credentials")).toBe("true");
    expect(finalRes.headers.get("vary")).toContain("Origin");
    expect(finalRes.headers.get("access-control-expose-headers")).toContain("Set-Cookie");
  });
});

describe("Better-Auth CORS integration", () => {
  it("handles OPTIONS preflight for Better-Auth endpoints with credentials", async () => {
    const req = new Request("http://localhost:4321/api/auth/get-session", {
      method: "OPTIONS",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "GET",
      },
    });

    const res = await ALL({
      request: req,
      url: new URL(req.url),
      params: { all: "get-session" },
    } as any);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("attaches CORS credentials headers to Better-Auth GET/POST responses", async () => {
    const req = new Request("http://localhost:4321/api/auth/get-session", {
      method: "GET",
      headers: {
        origin: "tauri://localhost",
      },
    });

    const res = await ALL({
      request: req,
      url: new URL(req.url),
      params: { all: "get-session" },
    } as any);

    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toContain("Origin");
  });
});

describe("Elysia API CORS integration", () => {
  it("supports CORS with credentials for Tauri in Elysia API", async () => {
    const req = new Request("http://localhost/api/health", {
      method: "GET",
      headers: {
        origin: "tauri://localhost",
      },
    });

    const res = await api.handle(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("Astro Middleware CORS integration", () => {
  it("intercepts OPTIONS for any CORS path in middleware", async () => {
    const req = new Request("http://localhost:4321/api/auth/sign-in/email", {
      method: "OPTIONS",
      headers: {
        origin: "https://tauri.localhost",
        "access-control-request-method": "POST",
      },
    });

    let nextCalled = false;
    const context = {
      request: req,
      url: new URL(req.url),
      locals: {},
    };

    const res = await (onRequest as any)(context, async () => {
      nextCalled = true;
      return new Response("ok");
    });

    expect(nextCalled).toBe(false);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tauri.localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("applies CORS headers to API route response in middleware", async () => {
    const req = new Request("http://localhost:4321/api/custom-endpoint", {
      method: "GET",
      headers: {
        origin: "tauri://localhost",
      },
    });

    const context = {
      request: req,
      url: new URL(req.url),
      locals: {},
    };

    const res = await (onRequest as any)(context, async () => {
      return new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("handles URL apiKey injection while preserving CORS and credentials headers", async () => {
    const req = new Request("http://localhost:4321/api/tasks?apiKey=uooc_test123", {
      method: "GET",
      headers: {
        origin: "tauri://localhost",
      },
    });

    const context = {
      request: req,
      url: new URL(req.url),
      locals: {},
    };

    const res = await (onRequest as any)(context, async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("set-cookie")).toContain("apiKey=uooc_test123");
  });
});

describe("Special API endpoints CORS integration", () => {
  it("handles OPTIONS on anonymous-key endpoint with credentials", async () => {
    const { OPTIONS } = await import("@/pages/api/auth/anonymous-key");
    const req = new Request("http://localhost:4321/api/auth/anonymous-key", {
      method: "OPTIONS",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "POST",
      },
    });

    const res = await (OPTIONS as any)({ request: req });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("handles OPTIONS on agent-configuration endpoint with credentials", async () => {
    const { OPTIONS } = await import("@/pages/.well-known/agent-configuration");
    const req = new Request("http://localhost:4321/.well-known/agent-configuration", {
      method: "OPTIONS",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "GET",
      },
    });

    const res = await (OPTIONS as any)({ request: req });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("handles OPTIONS on MCP endpoint with credentials", async () => {
    const { OPTIONS } = await import("@/pages/mcp/[...slug]");
    const req = new Request("http://localhost:4321/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://tauri.localhost",
        "access-control-request-method": "POST",
      },
    });

    const res = await (OPTIONS as any)({ request: req });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tauri.localhost");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
