import { auth } from "@/lib/auth";
import { applyCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import type { APIRoute } from "astro";

export const ALL: APIRoute = async (ctx) => {
  if (ctx.request.method === "OPTIONS") {
    return handleCorsPreflight(ctx.request);
  }
  const response = await auth.handler(ctx.request);
  return applyCorsHeaders(ctx.request, response);
};
