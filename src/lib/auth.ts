import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { jwt, anonymous, bearer, genericOAuth, deviceAuthorization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { agentAuth } from "@better-auth/agent-auth";
import { mcp } from "@better-auth/mcp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { getTrustedOriginsList, isOriginAllowed } from "@/lib/cors";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 31, // 31 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  trustedOrigins: (request) => {
    const list = getTrustedOriginsList();
    if (request) {
      const origin = request.headers.get("origin");
      if (origin && isOriginAllowed(origin) && !list.includes(origin)) {
        list.push(origin);
      }
    }
    return list;
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    },
  },
  plugins: [
    jwt(),
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        // Seamlessly transfer all submitted answers and API keys from anonymous account to OAuth account
        try {
          await db
            .update(schema.answers)
            .set({ submittedBy: newUser.user.id })
            .where(eq(schema.answers.submittedBy, anonymousUser.user.id));

          await db
            .update(schema.apikey)
            .set({ referenceId: newUser.user.id })
            .where(eq(schema.apikey.referenceId, anonymousUser.user.id));
        } catch (e) {
          console.error("Failed to migrate anonymous data on link account:", e);
        }
      },
    }),
    bearer(),
    apiKey({
      rateLimit: {
        enabled: env.API_KEY_RATE_LIMIT_ENABLED,
        timeWindow: env.API_KEY_RATE_LIMIT_TIME_WINDOW,
        maxRequests: env.API_KEY_RATE_LIMIT_MAX,
      },
      enableSessionForAPIKeys: true,
      apiKeyHeaders: ["x-api-key", "api-key"],
      customAPIKeyGetter: (ctx) => {
        const headerKey = ctx.headers?.get("x-api-key") || ctx.headers?.get("api-key");
        if (headerKey) return headerKey;

        const authHeader = ctx.headers?.get("authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7).trim();
          if (token.startsWith("uooc_")) return token;
        }

        const cookieHeader = ctx.headers?.get("cookie") || "";
        const match = cookieHeader.match(/(?:^|;\s*)(?:apiKey|uooc_api_key)=([^;]+)/);
        if (match?.[1]) return decodeURIComponent(match[1]);

        return null;
      },
    }),
    agentAuth({
      providerName: "UOOC QA Share",
      providerDescription: "UOOC QA sharing platform for AI agents",
      deviceAuthorizationPage: "/device",
      modes: ["delegated", "autonomous"],
      resolveAutonomousUser: async ({ agentId, agentMode }) => {
        return {
          id: `agent_${agentId}`,
          name: `AI Agent (${agentMode})`,
          email: `agent_${agentId}@agent.local`,
          role: "agent",
          isAnonymous: true,
        };
      },
      capabilities: [
        {
          name: "search_questions",
          description:
            "Search questions by stem text, options, or semantic query, optionally supplying a precomputed 512-dim vector (bge-small-zh-v1.5)",
          input: {
            type: "object",
            properties: {
              query: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    text: { type: "string" },
                  },
                },
              },
              embedding: {
                type: "array",
                items: { type: "number" },
              },
            },
          },
        },
        {
          name: "get_task_answers",
          description: "Get all questions and answers for a task group by tid",
          input: {
            type: "object",
            properties: { tid: { type: "string" } },
            required: ["tid"],
          },
        },
        {
          name: "get_question_answer",
          description: "Get single question and its answers by question ID",
          input: {
            type: "object",
            properties: { question_id: { type: "string" } },
            required: ["question_id"],
          },
        },
        {
          name: "get_course_tasks",
          description: "Get all task groups under a course by cid",
          input: {
            type: "object",
            properties: { cid: { type: "string" } },
            required: ["cid"],
          },
        },
        {
          name: "upload_answers",
          description: "Batch upload questions and answers for a task group",
          input: {
            type: "object",
            properties: { data: { type: "string" } },
            required: ["data"],
          },
        },
        {
          name: "list_pending_tasks",
          description: "List pending tasks calculated from missing data in database",
          input: {
            type: "object",
            properties: {
              type: { type: "string" },
              tid: { type: "string" },
              limit: { type: "number" },
            },
          },
        },
        {
          name: "fulfill_stem_task",
          description: "Fulfill missing stem text for a question",
          input: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              stem: { type: "string" },
            },
            required: ["question_id", "stem"],
          },
        },
        {
          name: "fulfill_embedding_task",
          description: "Fulfill missing stem embedding vector for a question",
          input: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              embedding: {
                type: "array",
                items: { type: "number" },
              },
            },
            required: ["question_id"],
          },
        },
        {
          name: "match_question_bank",
          description:
            "Match local question IDs with server database to detect missing questions and filtered tasks",
          input: {
            type: "object",
            properties: {
              cid: { type: "string" },
              tid: { type: "string" },
              local_question_ids: {
                type: "array",
                items: { type: "string" },
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    tid: { type: "string" },
                    question_id: { type: "string" },
                  },
                  required: ["question_id"],
                },
              },
              task_types: {
                type: "array",
                items: { type: "string" },
              },
              limit: { type: "number" },
            },
          },
        },
      ],
    }),
    deviceAuthorization({
      verificationUri: "/device",
      validateClient: () => true,
    }),
    mcp({
      loginPage: "/login",
      consentPage: "/consent",
      resource: `${env.BETTER_AUTH_URL}/mcp`,
    }),
    genericOAuth({
      config: [
        {
          providerId: "bili-sign",
          clientId: env.BILI_SIGN_CLIENT_ID ?? "",
          clientSecret: env.BILI_SIGN_CLIENT_SECRET ?? "",
          authorizationUrl: env.BILI_SIGN_AUTHORIZATION_URL,
          tokenUrl: env.BILI_SIGN_TOKEN_URL,
          userInfoUrl: env.BILI_SIGN_USERINFO_URL,
          scopes: ["openid", "profile", "email"],
          pkce: false,
        },
      ],
    }),
  ],
});
