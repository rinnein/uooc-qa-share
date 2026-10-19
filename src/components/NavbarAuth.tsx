import { authClient, getSessionCache, logout, setSessionCache } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export interface SessionData {
  user: {
    id: string;
    name: string;
    email?: string;
    isAnonymous?: boolean | null;
    [key: string]: any;
  };
  session?: any;
}

export interface NavbarAuthProps {
  initialSession?: SessionData | null;
}

export default function NavbarAuth({ initialSession }: NavbarAuthProps) {
  // 1. Resolve initial state immediately from SSR prop or sessionStorage cache
  const [cachedSession, setCachedSession] = useState<SessionData | null>(() => {
    if (initialSession !== undefined) {
      if (initialSession) {
        setSessionCache(initialSession);
      }
      return initialSession;
    }
    const cached = getSessionCache();
    return cached ?? null;
  });

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // 2. Hook into Better Auth's reactive session in background
  const { data: liveSession, isPending } = authClient.useSession();

  useEffect(() => {
    if (liveSession !== undefined) {
      setCachedSession(liveSession);
      if (liveSession) {
        setSessionCache(liveSession);
      }
    }
  }, [liveSession]);

  const activeSession = liveSession ?? cachedSession;

  // Only show loading if we genuinely have no session data AND live query is pending
  if (isPending && !activeSession) {
    return <span className="text-xs text-muted-foreground">加载中...</span>;
  }

  if (activeSession) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground text-xs">
          {activeSession.user.name}
          {activeSession.user.isAnonymous ? " (匿名)" : " (已认证)"}
        </span>
        <button
          type="button"
          disabled={isLoggingOut}
          onClick={async () => {
            setIsLoggingOut(true);
            await logout();
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline transition-colors disabled:opacity-50"
        >
          {isLoggingOut ? "退出中..." : "退出"}
        </button>
      </div>
    );
  }

  return (
    <a
      href="/login"
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      登录
    </a>
  );
}
