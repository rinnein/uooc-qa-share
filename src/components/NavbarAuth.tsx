import { authClient } from "@/lib/auth-client";

export default function NavbarAuth() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <span className="text-xs text-muted-foreground">加载中...</span>;
  }

  if (session) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground text-xs">
          {session.user.name}
          {session.user.isAnonymous ? " (匿名)" : " (已认证)"}
        </span>
        <button
          type="button"
          onClick={() => authClient.signOut().then(() => window.location.reload())}
          className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
        >
          退出
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
