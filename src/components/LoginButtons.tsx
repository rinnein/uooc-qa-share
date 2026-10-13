import { authClient } from "@/lib/auth-client";

export default function LoginButtons() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <p className="text-center text-muted-foreground text-sm">加载中...</p>;

  if (session) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm">
          已登录为 <span className="font-medium">{session.user.name}</span>
          {session.user.isAnonymous && <span className="ml-1 text-muted-foreground">(匿名)</span>}
        </p>
        <button
          type="button"
          onClick={() => authClient.signOut().then(() => window.location.reload())}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
        >
          退出登录
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/" })}
        className="w-full rounded-md bg-[#24292f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#24292f]/90 transition-colors"
      >
        使用 GitHub 登录
      </button>
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "bili-sign", callbackURL: "/" })}
        className="w-full rounded-md bg-[#fb7299] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#fb7299]/90 transition-colors"
      >
        使用 bili-sign 登录
      </button>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">或</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => authClient.signIn.anonymous().then(() => (window.location.href = "/"))}
        className="w-full rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
      >
        匿名使用（仅可添加答案）
      </button>
    </div>
  );
}
