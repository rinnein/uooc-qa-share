import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { anonymous } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins";
import { bearer } from "better-auth/plugins";
import { db } from "@/db";
import { env } from "@/lib/env";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  trustedOrigins: env.CORS_ORIGINS.split(",").filter(Boolean),
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    },
  },
  plugins: [
    anonymous(),
    bearer(),
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
