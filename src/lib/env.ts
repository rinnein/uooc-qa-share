import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1).default("postgresql://localhost:5432/uooc_qa_share"),
    BETTER_AUTH_SECRET: z.string().min(1).default("change-me-to-a-random-secret-in-production"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:4321"),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    BILI_SIGN_CLIENT_ID: z.string().optional(),
    BILI_SIGN_CLIENT_SECRET: z.string().optional(),
    BILI_SIGN_AUTHORIZATION_URL: z
      .string()
      .url()
      .default("https://bili-sign.rinne.in/oauth/authorize"),
    BILI_SIGN_TOKEN_URL: z.string().url().default("https://bili-sign.rinne.in/oauth/token"),
    BILI_SIGN_USERINFO_URL: z.string().url().default("https://bili-sign.rinne.in/oauth/userinfo"),

    EMBEDDING_API_URL: z.string().url().optional(),
    EMBEDDING_API_KEY: z.string().optional(),
    EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

    CORS_ORIGINS: z
      .string()
      .default("https://www.uooc.net.cn,tauri://localhost,https://tauri.localhost"),
  },
  clientPrefix: "PUBLIC_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
