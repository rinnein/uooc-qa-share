import { env } from "./env";

/**
 * Standard list of trusted origin patterns for Tauri, WebViews, local development, and UOOC domains.
 */
const DEFAULT_TRUSTED_PATTERNS = [
  "tauri://*",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "https://*.tauri.localhost",
  "http://*.tauri.localhost",
  "http://localhost:*",
  "https://localhost:*",
  "http://127.0.0.1:*",
  "https://127.0.0.1:*",
  "vscode-webview://*",
  "https://www.uooc.net.cn",
  "https://*.uooc.net.cn",
];

/**
 * Get all configured and built-in trusted origins/patterns.
 */
export function getTrustedOriginsList(): string[] {
  const configured = env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const set = new Set([...configured, ...DEFAULT_TRUSTED_PATTERNS]);
  return Array.from(set);
}

/**
 * Helper to match an origin string against a pattern that may contain wildcards (*).
 */
export function matchesPattern(origin: string, pattern: string): boolean {
  if (!origin || !pattern) return false;
  if (pattern === "*" || origin === pattern) return true;

  if (pattern.includes("*")) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\\\./g, "(?:.*\\.)?")
      .replace(/\*/g, ".*");

    return new RegExp(`^${escaped}$`, "i").test(origin);
  }

  return false;
}

/**
 * Check whether an incoming Origin header is allowed for CORS and credentials.
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;

  const patterns = getTrustedOriginsList();
  for (const pattern of patterns) {
    if (matchesPattern(origin, pattern)) {
      return true;
    }
  }

  // Common Tauri and localhost RegExp fallbacks
  if (origin.startsWith("tauri://")) return true;
  if (/^https?:\/\/([a-z0-9-]+\.)?tauri\.localhost(:\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (origin.startsWith("vscode-webview://")) return true;

  return false;
}

/**
 * Check if the request path is an API or MCP route requiring CORS headers.
 */
export function isCorsPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/.well-known/")
  );
}

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD";
const CORS_EXPOSE_HEADERS =
  "Set-Cookie, x-api-key, Authorization, x-session-id, mcp-protocol-version, WWW-Authenticate";

/**
 * Handle CORS preflight (OPTIONS) requests with credentials support.
 */
export function handleCorsPreflight(request: Request): Response {
  const origin = request.headers.get("origin");
  const headers = new Headers();

  if (origin && isOriginAllowed(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin, Access-Control-Request-Headers");
  } else if (!origin) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Methods", CORS_METHODS);

  const requestHeaders = request.headers.get("access-control-request-headers");
  if (requestHeaders) {
    headers.set("Access-Control-Allow-Headers", requestHeaders);
  } else {
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, api-key, x-session-id, mcp-protocol-version, *",
    );
  }

  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);

  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Append CORS and credentials headers to a Response.
 */
export function applyCorsHeaders(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  if (!origin || !isOriginAllowed(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);

  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", "Origin");
  } else if (
    !vary
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .includes("origin")
  ) {
    headers.set("Vary", `${vary}, Origin`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
