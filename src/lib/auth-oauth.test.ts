import { describe, it, expect } from "vite-plus/test";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";

describe("OAuth 2.1 PKCE configuration for bili-sign", () => {
  it("initializes and generates PKCE authorization URL without clientSecret", async () => {
    const testAuth = betterAuth({
      baseURL: "http://localhost:4321",
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "bili-sign",
              clientId: "test_pkce_client_id",
              clientSecret: undefined,
              authorizationUrl: "https://bili-sign.rinne.in/oauth/authorize",
              tokenUrl: "https://bili-sign.rinne.in/oauth/token",
              userInfoUrl: "https://bili-sign.rinne.in/oauth/userinfo",
              scopes: ["openid", "profile", "email"],
              pkce: true,
              tokenEndpointAuth: { method: "none" },
            },
          ],
        }),
      ],
    });

    const req = new Request("http://localhost:4321/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "bili-sign",
        callbackURL: "http://localhost:4321/",
      }),
    });

    const res = await testAuth.handler(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { url: string; redirect: boolean };
    expect(data.redirect).toBe(true);

    const authUrl = new URL(data.url);
    expect(authUrl.origin + authUrl.pathname).toBe("https://bili-sign.rinne.in/oauth/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe("test_pkce_client_id");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
  });
});
