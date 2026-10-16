import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { isOriginAllowed } from "@/lib/cors";
import { questionsRoutes } from "./questions";
import { tasksRoutes } from "./tasks";
import { uploadRoutes } from "./upload";
import { automationRoutes } from "./automation";

export const api = new Elysia({ prefix: "/api" })
  .use(
    cors({
      origin: (request) => isOriginAllowed(request.headers.get("origin") ?? ""),
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-api-key",
        "api-key",
        "x-session-id",
        "mcp-protocol-version",
        "*",
      ],
      exposeHeaders: [
        "Set-Cookie",
        "x-api-key",
        "Authorization",
        "x-session-id",
        "mcp-protocol-version",
        "WWW-Authenticate",
      ],
    }),
  )
  .use(questionsRoutes)
  .use(tasksRoutes)
  .use(uploadRoutes)
  .use(automationRoutes)
  .get("/health", () => ({ ok: true, time: new Date().toISOString() }));
