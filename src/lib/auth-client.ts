import { createAuthClient } from "better-auth/react";
import { anonymousClient, deviceAuthorizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  const fromLocal = localStorage.getItem("uooc_api_key");
  if (fromLocal) return fromLocal;
  const cookieMatch = document.cookie.match(/(?:^|;\s*)(?:apiKey|uooc_api_key)=([^;]+)/);
  if (cookieMatch?.[1]) return decodeURIComponent(cookieMatch[1]);
  return "";
}

export const authClient = createAuthClient({
  plugins: [anonymousClient(), apiKeyClient(), deviceAuthorizationClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => getStoredApiKey(),
    },
    headers: {
      get "x-api-key"() {
        return getStoredApiKey();
      },
    },
  },
});

export const { useSession, signIn, signOut, signUp } = authClient;
