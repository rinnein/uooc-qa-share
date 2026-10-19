import { createAuthClient } from "better-auth/react";
import { anonymousClient, deviceAuthorizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

export const SESSION_CACHE_KEY = "uooc_session_cache";
export const SESSION_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export interface CachedSessionEntry {
  data: any;
  cachedAt: number;
  apiKey: string;
}

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  const fromLocal = localStorage.getItem("uooc_api_key");
  if (fromLocal) return fromLocal;
  const cookieMatch = document.cookie.match(/(?:^|;\s*)(?:apiKey|uooc_api_key)=([^;]+)/);
  if (cookieMatch?.[1]) return decodeURIComponent(cookieMatch[1]);
  return "";
}

export function getSessionCache(): any {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedSessionEntry = JSON.parse(raw);
    const currentKey = getStoredApiKey();
    if (parsed.apiKey !== currentKey) {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
      return null;
    }
    if (Date.now() - parsed.cachedAt > SESSION_CACHE_TTL_MS) {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function setSessionCache(data: any): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedSessionEntry = {
      data,
      cachedAt: Date.now(),
      apiKey: getStoredApiKey(),
    };
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage quota or access errors
  }
}

export function clearSessionCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {}
}

/**
 * Custom fetch implementation that caches get-session requests to reduce server load
 * and invalidate on sign-out.
 */
async function cachedFetchImpl(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  const method = init?.method || (typeof url === "object" && "method" in url ? url.method : "GET");

  const isGetSession = urlStr.includes("/get-session") && method.toUpperCase() === "GET";
  const isSignOut = urlStr.includes("/sign-out");

  if (isSignOut) {
    clearSessionCache();
  }

  // Check cache for get-session requests (unless x-refresh or no-cache requested)
  if (isGetSession) {
    const headers = new Headers(
      init?.headers || (typeof url === "object" && "headers" in url ? url.headers : undefined),
    );
    const bypassCache =
      headers.get("cache-control")?.includes("no-cache") || headers.get("x-refresh") === "true";

    if (!bypassCache) {
      const cached = getSessionCache();
      if (cached !== null) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-cache": "HIT",
          },
        });
      }
    }
  }

  const response = await fetch(url, init);

  // Populate cache on successful get-session response
  if (isGetSession && response.ok) {
    try {
      const cloned = response.clone();
      const data = await cloned.json();
      if (data) {
        setSessionCache(data);
      }
    } catch {}
  }

  return response;
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
    customFetchImpl: cachedFetchImpl,
  },
});

/**
 * Complete logout design for plugin and webview environments.
 * Clears localStorage, cookies, session caches, marks logout suppression to prevent
 * auto re-injection from window.__UOOC_API_KEY__, and notifies host plugins.
 */
export async function logout(): Promise<void> {
  if (typeof window !== "undefined") {
    const currentKey =
      getStoredApiKey() ||
      ((window as any).__UOOC_API_KEY__ ? String((window as any).__UOOC_API_KEY__) : "");

    try {
      // 1. Mark as explicitly logged out for this key to prevent auto-re-injection by window.__UOOC_API_KEY__
      localStorage.setItem("uooc_logged_out", "true");
      if (currentKey) {
        localStorage.setItem("uooc_logged_out_key", currentKey);
      }

      // 2. Clear credentials and caches from browser storage
      localStorage.removeItem("uooc_api_key");
      clearSessionCache();

      // 3. Clear auth cookies with expired date
      const expiredSuffix =
        "; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
      document.cookie = `apiKey=${expiredSuffix}`;
      document.cookie = `uooc_api_key=${expiredSuffix}`;
      document.cookie = `session_data=${expiredSuffix}`;
    } catch (e) {
      console.warn("[Auth] Failed to clear local storage credentials:", e);
    }

    // 4. Notify host plugin / webview environments
    try {
      window.dispatchEvent(new CustomEvent("uooc:logout", { detail: { apiKey: currentKey } }));
      if (typeof (window as any).__UOOC_ON_LOGOUT__ === "function") {
        (window as any).__UOOC_ON_LOGOUT__({ apiKey: currentKey });
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "uooc:logout", apiKey: currentKey }, "*");
      }
    } catch (e) {
      console.warn("[Auth] Failed to dispatch logout events:", e);
    }
  }

  // 5. Call Better Auth sign out
  try {
    await authClient.signOut();
  } catch (e) {
    console.warn("[Auth] signOut error:", e);
  }

  // 6. Navigate to home
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}

export const { useSession, signIn, signOut, signUp } = authClient;
