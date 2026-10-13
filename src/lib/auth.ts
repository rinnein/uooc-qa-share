import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { anonymous } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins";
import { bearer } from "better-auth/plugins";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  trustedOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      enabled: !!process.env.GITHUB_CLIENT_ID,
    },
  },
  plugins: [
    anonymous(),
    bearer(),
    genericOAuth({
      config: [
        {
          providerId: "bili-sign",
          clientId: process.env.BILI_SIGN_CLIENT_ID!,
          clientSecret: process.env.BILI_SIGN_CLIENT_SECRET!,
          authorizationUrl: process.env.BILI_SIGN_AUTHORIZATION_URL!,
          tokenUrl: process.env.BILI_SIGN_TOKEN_URL!,
          userInfoUrl: process.env.BILI_SIGN_USERINFO_URL!,
          scopes: ["openid", "profile", "email"],
          pkce: false,
        },
      ],
    }),
  ],
});
