import { createMcpServer } from "@/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIRoute } from "astro";

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-session-id, mcp-protocol-version, *",
  );
  headers.set("Access-Control-Expose-Headers", "x-session-id, mcp-protocol-version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-session-id, mcp-protocol-version, *",
      "Access-Control-Expose-Headers": "x-session-id, mcp-protocol-version",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  const res = await transport.handleRequest(request);
  return withCors(res);
};

export const GET: APIRoute = async ({ request }) => {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(request);
    return withCors(res);
  }

  return withCors(
    new Response(
      JSON.stringify({
        name: "uooc-qa-share",
        version: "1.0.0",
        description: "UOOC 题库共享 MCP 服务器 (支持 CORS)",
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
  return withCors(res);
};
