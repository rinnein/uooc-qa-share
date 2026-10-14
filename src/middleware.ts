import { auth } from "@/lib/auth";
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
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

  let session = await auth.api.getSession({
    headers: requestHeaders,
  });

  // Fallback: direct verifyApiKey if getSession did not resolve it
  if (!session && targetApiKey) {
    try {
      const verifyRes = await auth.api.verifyApiKey({
        body: { key: targetApiKey },
      });
      if (verifyRes?.valid && verifyRes.key?.referenceId) {
        const dbUser = await (
          await auth.$context
        ).internalAdapter.findUserById(verifyRes.key.referenceId);

        if (dbUser) {
          session = {
            user: {
              ...dbUser,
              isAnonymous: (dbUser as { isAnonymous?: boolean | null }).isAnonymous ?? false,
            },
            session: {
              id: verifyRes.key.id,
              userId: dbUser.id,
              token: targetApiKey,
              expiresAt: verifyRes.key.expiresAt ?? new Date(Date.now() + 31 * 86400000),
              createdAt: verifyRes.key.createdAt ?? new Date(),
              updatedAt: verifyRes.key.updatedAt ?? new Date(),
              ipAddress: null,
              userAgent: null,
            },
          };
        }
      }
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

  // If apiKey was injected via URL parameter, persist it to cookie for subsequent webview navigations
  if (urlApiKey && response) {
    const headers = new Headers(response.headers);
    headers.append(
      "Set-Cookie",
      `apiKey=${encodeURIComponent(urlApiKey)}; Path=/; Max-Age=2678400; SameSite=Lax`,
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
});
