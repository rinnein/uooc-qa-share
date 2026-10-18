import { createMcpServer } from "@/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { auth } from "@/lib/auth";
import { applyCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import type { APIRoute } from "astro";

function withCors(request: Request, response: Response): Response {
  return applyCorsHeaders(request, response);
}

/**
 * Resolve agent user state via Agent Auth or API Key
 */
async function resolveAgentUser(request: Request) {
  // 1. Try Agent Auth signed JWT session
  try {
    const agentSession = await auth.api.getAgentSession({
      headers: request.headers,
    });
    if (agentSession?.user) {
      return {
        user: agentSession.user,
        mode: "agent-auth",
        agentId: agentSession.agent?.id,
      };
    }
  } catch {}

  // 2. Try API key verification
  const apiKey =
    request.headers.get("x-api-key") ||
    request.headers.get("api-key") ||
    (request.headers.get("authorization")?.startsWith("Bearer ")
      ? request.headers.get("authorization")!.slice(7).trim()
      : null);

  if (apiKey) {
    try {
      const verified = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (verified?.valid && verified.key?.referenceId) {
        return {
          user: {
            id: verified.key.referenceId,
            name: "Agent (API Key)",
            email: `apikey-${verified.key.id}@agent.local`,
            isAnonymous: true,
          },
          mode: "api-key",
        };
      }
    } catch {}
    return null;
  }

  // 3. Fallback: provision temporary anonymous agent session if requested
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      return {
        user: session.user,
        mode: "session",
      };
    }
  } catch {}

  return null;
}

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCorsPreflight(request);
};

export const POST: APIRoute = async ({ request }) => {
  // Authenticate agent session (supports Agent Auth JWT, API Key, or creates temporary user state)
  const agentUser = await resolveAgentUser(request);

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  const res = await transport.handleRequest(request, {
    authInfo: agentUser
      ? {
          token: request.headers.get("authorization") ?? "",
          clientId: agentUser.user.id,
          scopes: ["mcp:read", "mcp:write"],
        }
      : undefined,
  });
  return withCors(request, res);
};

export const GET: APIRoute = async ({ request }) => {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    const agentUser = await resolveAgentUser(request);
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(request, {
      authInfo: agentUser
        ? {
            token: request.headers.get("authorization") ?? "",
            clientId: agentUser.user.id,
            scopes: ["mcp:read", "mcp:write"],
          }
        : undefined,
    });
    return withCors(request, res);
  }

  return withCors(
    request,
    new Response(
      JSON.stringify({
        name: "uooc-qa-share",
        version: "1.0.0",
        description: "UOOC 题库共享 MCP 服务器 (支持 Agent Auth & CORS)",
        auth: {
          type: "agent-auth",
          discovery: "/.well-known/agent-configuration",
          oauth_protected_resource: "/.well-known/oauth-protected-resource",
        },
        tools: [
          "search_questions",
          "get_task_answers",
          "get_question_answer",
          "get_course_tasks",
          "upload_answers",
        ],
        prompts: ["analyze_and_upload_qa"],
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
};

export const DELETE: APIRoute = async ({ request }) => {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(request);
  return withCors(request, res);
};
