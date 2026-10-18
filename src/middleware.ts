import { auth } from "@/lib/auth";
import { applyCorsHeaders, handleCorsPreflight, isCorsPath } from "@/lib/cors";
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  // Handle CORS preflight requests
  if (
    context.request.method === "OPTIONS" &&
    (isCorsPath(context.url.pathname) || Boolean(context.request.headers.get("origin")))
  ) {
    return handleCorsPreflight(context.request);
  }

  const urlApiKey =
    context.url.searchParams.get("apiKey") || context.url.searchParams.get("api_key");

  const headerApiKey =
    context.request.headers.get("x-api-key") || context.request.headers.get("api-key");

  const cookieHeader = context.request.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)(?:apiKey|uooc_api_key)=([^;]+)/);
  const cookieApiKey = cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : null;

  const targetApiKey = urlApiKey || headerApiKey || cookieApiKey;

  // Build headers with x-api-key if an apiKey was identified
  const requestHeaders = new Headers(context.request.headers);
  if (targetApiKey && !requestHeaders.has("x-api-key")) {
    requestHeaders.set("x-api-key", targetApiKey);
  }

  let session = null;
  // Dedicated API / MCP endpoints handle their own authentication.
  // Skipping getSession here avoids double-incrementing API key rate limits per request.
  const isDedicatedAuthRoute =
    context.url.pathname.startsWith("/api/") || context.url.pathname.startsWith("/mcp");

  if (!isDedicatedAuthRoute) {
    try {
      session = await auth.api.getSession({
        headers: requestHeaders,
      });
    } catch {}
  }

  if (session) {
    context.locals.user = session.user;
    context.locals.session = session.session;
  } else {
    context.locals.user = null;
    context.locals.session = null;
  }

  const response = await next();

  let finalResponse = response;

  // If apiKey was injected via URL parameter, persist it to cookie for subsequent webview navigations
  if (urlApiKey && finalResponse) {
    const headers = new Headers(finalResponse.headers);
    headers.append(
      "Set-Cookie",
      `apiKey=${encodeURIComponent(urlApiKey)}; Path=/; Max-Age=2678400; SameSite=Lax`,
    );
    finalResponse = new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers,
    });
  }

  if (
    finalResponse &&
    (isCorsPath(context.url.pathname) || Boolean(context.request.headers.get("origin")))
  ) {
    return applyCorsHeaders(context.request, finalResponse);
  }

  return finalResponse;
});
