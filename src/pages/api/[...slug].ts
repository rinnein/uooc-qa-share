import { api } from "@/api";
import type { APIRoute } from "astro";

const handle: APIRoute = async ({ request }) => {
  try {
    return await api.handle(request);
  } catch (err) {
    console.error(`[API Route Unhandled Error] [${request.method}] ${request.url}:`, err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        stack:
          Boolean(import.meta.env?.DEV || process.env.NODE_ENV !== "production") &&
          err instanceof Error
            ? err.stack
            : undefined,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
