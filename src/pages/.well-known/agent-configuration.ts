import { auth } from "../../lib/auth";
import { applyCorsHeaders, handleCorsPreflight } from "../../lib/cors";
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request }) => {
  const configuration = await auth.api.getAgentConfiguration();
  const res = new Response(JSON.stringify(configuration), {
    headers: {
      "Content-Type": "application/json",
    },
  });
  return applyCorsHeaders(request, res);
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCorsPreflight(request);
};
