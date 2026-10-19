import { auth } from "@/lib/auth";
import { applyCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import type { APIRoute } from "astro";

export const ALL: APIRoute = async (ctx) => {
  if (ctx.request.method === "OPTIONS") {
    return handleCorsPreflight(ctx.request);
  }
  const response = await auth.handler(ctx.request);

  if (response) {
    const headers = new Headers(response.headers);
    let modified = false;

    // When signing out, ensure apiKey and uooc_api_key cookies are explicitly expired
    if (ctx.request.method === "POST" && ctx.url.pathname.endsWith("/sign-out")) {
      const expiredCookie =
        "Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
      headers.append("Set-Cookie", `apiKey=; ${expiredCookie}`);
      headers.append("Set-Cookie", `uooc_api_key=; ${expiredCookie}`);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      modified = true;
    } else if (
      ctx.request.method === "GET" &&
      ctx.url.pathname.endsWith("/get-session") &&
      response.status === 200
    ) {
      // Add private caching header for get-session to avoid repeat requests on page switches
      headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
      modified = true;
    }

    if (modified) {
      const finalResp = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      return applyCorsHeaders(ctx.request, finalResp);
    }
  }

  return applyCorsHeaders(ctx.request, response);
};
