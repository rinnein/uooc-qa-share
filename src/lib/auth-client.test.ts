import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import {
  getSessionCache,
  setSessionCache,
  clearSessionCache,
  getStoredApiKey,
  logout,
  SESSION_CACHE_KEY,
} from "./auth-client";
import { ALL } from "@/pages/api/auth/[...all]";

function createStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
}

describe("Client Auth Cache and Logout Management", () => {
  let mockLocalStorage: ReturnType<typeof createStorageMock>;
  let mockSessionStorage: ReturnType<typeof createStorageMock>;
  let originalWindow: any;

  beforeEach(() => {
    mockLocalStorage = createStorageMock();
    mockSessionStorage = createStorageMock();

    originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      document: {
        cookie: "",
      },
      dispatchEvent: vi.fn(),
      location: {
        href: "/login",
      },
    };
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).sessionStorage = mockSessionStorage;
    (globalThis as any).document = (globalThis as any).window.document;
  });

  afterEach(() => {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
      delete (globalThis as any).localStorage;
      delete (globalThis as any).sessionStorage;
      delete (globalThis as any).document;
    }
    vi.restoreAllMocks();
  });

  it("stores and retrieves session from sessionStorage cache", () => {
    const mockSession = {
      user: { id: "u123", name: "Test User", isAnonymous: false },
      session: { id: "s123" },
    };

    setSessionCache(mockSession);
    const cached = getSessionCache();
    expect(cached).toEqual(mockSession);
  });

  it("invalidates cache when TTL expires", () => {
    const mockSession = {
      user: { id: "u123", name: "Test User" },
      session: { id: "s123" },
    };

    // Store directly with an expired timestamp (> 60s TTL)
    const expiredEntry = {
      data: mockSession,
      cachedAt: Date.now() - 70 * 1000,
      apiKey: "",
    };
    mockSessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(expiredEntry));

    expect(getSessionCache()).toBeNull();
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(SESSION_CACHE_KEY);
  });

  it("invalidates cache if stored API key changes", () => {
    const mockSession = {
      user: { id: "u123", name: "Test User" },
    };

    mockLocalStorage.setItem("uooc_api_key", "key_old");
    setSessionCache(mockSession);

    // Key changes to key_new
    mockLocalStorage.setItem("uooc_api_key", "key_new");
    expect(getSessionCache()).toBeNull();
  });

  it("clears session cache explicitly", () => {
    setSessionCache({ user: { id: "u1" } });
    expect(getSessionCache()).not.toBeNull();

    clearSessionCache();
    expect(getSessionCache()).toBeNull();
  });

  it("retrieves API key from localStorage or cookie fallback", () => {
    expect(getStoredApiKey()).toBe("");

    mockLocalStorage.setItem("uooc_api_key", "key_from_local");
    expect(getStoredApiKey()).toBe("key_from_local");

    mockLocalStorage.removeItem("uooc_api_key");
    (globalThis as any).document.cookie = "apiKey=key_from_cookie";
    expect(getStoredApiKey()).toBe("key_from_cookie");
  });

  it("performs complete logout: cleans credentials, suppresses auto-relogin, and notifies plugin hooks", async () => {
    mockLocalStorage.setItem("uooc_api_key", "uooc_test_key");
    setSessionCache({ user: { id: "u123" } });
    (globalThis as any).document.cookie = "apiKey=uooc_test_key; Path=/";

    const pluginHookSpy = vi.fn();
    (globalThis as any).window.__UOOC_ON_LOGOUT__ = pluginHookSpy;

    await logout();

    // Verify localStorage cleanup and suppression flags
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("uooc_api_key");
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("uooc_logged_out", "true");
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("uooc_logged_out_key", "uooc_test_key");

    // Verify session cache cleared
    expect(getSessionCache()).toBeNull();

    // Verify plugin callback called
    expect(pluginHookSpy).toHaveBeenCalledWith({ apiKey: "uooc_test_key" });

    // Verify redirect to "/"
    expect((globalThis as any).window.location.href).toBe("/");
  });
});

describe("Auth Endpoint Header & Cookie Invalidation (/api/auth/[...all])", () => {
  it("attaches Cache-Control on successful get-session GET requests", async () => {
    const request = new Request("http://localhost:4321/api/auth/get-session", {
      method: "GET",
    });

    const context = {
      request,
      url: new URL(request.url),
    } as any;

    const response = await ALL(context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });

  it("expires apiKey and uooc_api_key cookies on POST /api/auth/sign-out", async () => {
    const request = new Request("http://localhost:4321/api/auth/sign-out", {
      method: "POST",
    });

    const context = {
      request,
      url: new URL(request.url),
    } as any;

    const response = await ALL(context);
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain("apiKey=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
