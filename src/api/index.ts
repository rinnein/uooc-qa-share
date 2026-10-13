import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "@/lib/env";
import { questionsRoutes } from "./questions";
import { tasksRoutes } from "./tasks";
import { uploadRoutes } from "./upload";

const corsOrigins = env.CORS_ORIGINS.split(",").filter(Boolean);

export const api = new Elysia({ prefix: "/api" })
  .use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      credentials: true,
    }),
  )
  .use(questionsRoutes)
  .use(tasksRoutes)
  .use(uploadRoutes)
  .get("/health", () => ({ ok: true, time: new Date().toISOString() }));
