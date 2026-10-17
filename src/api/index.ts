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
