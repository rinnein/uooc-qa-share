import { auth } from "../../lib/auth";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  const configuration = await auth.api.getAgentConfiguration();
  return new Response(JSON.stringify(configuration), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
