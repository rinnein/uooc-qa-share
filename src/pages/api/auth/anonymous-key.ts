import { auth } from "@/lib/auth";
import { applyCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Perform anonymous sign-in via Better Auth Anonymous plugin
    const signinResult = await auth.api.signInAnonymous({
      headers: request.headers,
    });

    if (!signinResult?.user) {
      const errorRes = new Response(
        JSON.stringify({ ok: false, error: "Failed to sign in anonymously" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
      return applyCorsHeaders(request, errorRes);
    }

    const user = signinResult.user;

    // 2. Automatically generate and issue a persistent API key for this anonymous user
    const keyResult = await auth.api.createApiKey({
      body: {
        userId: user.id,
        name: `plugin-anon-${user.id.slice(0, 8)}`,
        prefix: "uooc_",
        // Long-lived API key for persistent client plugin integration (1 year)
        expiresIn: 60 * 60 * 24 * 365,
      },
    });

    const apiKey = keyResult?.key;

    const headers = new Headers({
      "Content-Type": "application/json",
    });

    if (apiKey) {
      headers.set("x-api-key", apiKey);
      headers.set(
        "Set-Cookie",
        `apiKey=${encodeURIComponent(apiKey)}; Path=/; Max-Age=31536000; SameSite=Lax`,
      );
    }

    const res = new Response(
      JSON.stringify({
        ok: true,
        user,
        token: signinResult.token,
        apiKey,
        message: "Anonymous registration completed and persistent API key issued",
      }),
      { status: 200, headers },
    );
    return applyCorsHeaders(request, res);
  } catch (error) {
    const errorRes = new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    return applyCorsHeaders(request, errorRes);
  }
};

export const GET: APIRoute = POST;

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCorsPreflight(request);
};
