import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { isOriginAllowed } from "@/lib/cors";
import { questionsRoutes } from "./questions";
import { tasksRoutes } from "./tasks";
import { uploadRoutes } from "./upload";
import { automationRoutes } from "./automation";
import { db } from "@/db";
import { questions, courses, taskGroups, answers } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

export const api = new Elysia({ prefix: "/api" })
  .onError(({ code, error, set, request }) => {
    const isDev = Boolean(import.meta.env?.DEV || process.env.NODE_ENV !== "production");

    console.error(`\x1b[31m[Elysia Error] [${request.method}] ${request.url} (${code})\x1b[0m`);
    console.error(error);

    if (code === "VALIDATION") {
      set.status = 400;
      const validationError = error as any;
      return {
        success: false,
        code,
        error: "参数校验失败",
        details: validationError?.all ?? validationError?.message ?? "Invalid request",
      };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return {
        success: false,
        code,
        error: "接口未找到",
      };
    }

    const currentStatus = Number(set.status);
    if (!currentStatus || currentStatus < 400) {
      set.status = 500;
    }

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);

    return {
      success: false,
      code,
      error: errorMessage,
      ...(isDev && error instanceof Error ? { stack: error.stack } : {}),
    };
  })
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
        "If-None-Match",
        "Cache-Control",
        "x-refresh",
        "*",
      ],
      exposeHeaders: [
        "Set-Cookie",
        "x-api-key",
        "Authorization",
        "x-session-id",
        "mcp-protocol-version",
        "WWW-Authenticate",
        "X-Cache",
        "ETag",
        "Cache-Control",
      ],
    }),
  )
  .use(questionsRoutes)
  .use(tasksRoutes)
  .use(uploadRoutes)
  .use(automationRoutes)
  .get("/health", () => ({ ok: true, time: new Date().toISOString() }))
  .get("/stats", async () => {
    const [qCount] = await db.select({ count: sql<number>`count(*)` }).from(questions);
    const [cCount] = await db.select({ count: sql<number>`count(*)` }).from(courses);
    const [tCount] = await db.select({ count: sql<number>`count(*)` }).from(taskGroups);
    const [aCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(answers)
      .where(eq(answers.isCorrect, true));

    return {
      questions: Number(qCount?.count ?? 0),
      courses: Number(cCount?.count ?? 0),
      taskGroups: Number(tCount?.count ?? 0),
      correctAnswers: Number(aCount?.count ?? 0),
    };
  });
