import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginButtons() {
  const { data: session, isPending } = authClient.useSession();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleApiKeyLogin(e: FormEvent) {
    e.preventDefault();
    const key = apiKeyInput.trim();
    if (!key) return;

    localStorage.setItem("uooc_api_key", key);
    document.cookie = `apiKey=${encodeURIComponent(key)}; path=/; max-age=2678400; SameSite=Lax`;
    window.location.href = "/";
  }

  async function handleCreateApiKey() {
    setKeyLoading(true);
    try {
      const res = await fetch("/api/auth/api-key/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "plugin-key",
          prefix: "uooc_",
          expiresIn: 60 * 60 * 24 * 365,
        }),
      });
      const data = await res.json();
      if (data?.key) {
        setGeneratedKey(data.key);
        localStorage.setItem("uooc_api_key", data.key);
      }
    } catch {
      alert("创建 API Key 失败，请确认服务正常运行");
    } finally {
      setKeyLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("uooc_api_key");
    document.cookie = "apiKey=; path=/; max-age=0; SameSite=Lax";
    void authClient.signOut().then(() => window.location.reload());
  }

  if (isPending) return <p className="text-center text-muted-foreground text-sm">加载中...</p>;

  if (session) {
    return (
      <div className="space-y-4 rounded-lg border p-4 text-center">
        <div>
          <p className="text-sm">
            已登录为 <span className="font-medium">{session.user.name}</span>
            {session.user.isAnonymous && (
              <span className="ml-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                (匿名账号)
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {session.user.isAnonymous
              ? "权限：仅可添加新答案，无法覆盖已有答案"
              : "权限：已认证用户，可更新与覆盖答案"}
          </p>
        </div>

        {session.user.isAnonymous && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-left dark:border-amber-900/60 dark:bg-amber-950/20 space-y-2">
            <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              绑定 OAuth 主账号升级
            </h4>
            <p className="text-xs text-muted-foreground">
              将当前匿名账户绑定至 OAuth 账号（或作为主账户绑定）：您的 API
              Key、历史提交答案将无缝继承并升级为正式权限。
            </p>
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={() =>
                  void authClient.linkSocial({
                    provider: "github",
                    callbackURL: "/login",
                  })
                }
                className="rounded bg-[#24292f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#24292f]/90 transition-colors"
              >
                绑定 GitHub 账号
              </button>
              <button
                type="button"
                onClick={() =>
                  void authClient.linkSocial({
                    provider: "bili-sign",
                    callbackURL: "/login",
                  })
                }
                className="rounded bg-[#fb7299] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#fb7299]/90 transition-colors"
              >
                绑定 bili-sign 账号
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <button
            type="button"
            onClick={handleCreateApiKey}
            disabled={keyLoading}
            className="w-full rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            {keyLoading ? "生成中..." : "为插件生成 API Key"}
          </button>

          {generatedKey && (
            <div className="rounded border bg-muted/40 p-2 text-left">
              <p className="text-xs text-muted-foreground mb-1">你的插件 API Key (请妥善保存)：</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono break-all flex-1">{generatedKey}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedKey);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="rounded border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
        >
          退出登录
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void authClient.signIn.social({ provider: "github", callbackURL: "/" })}
        className="w-full rounded-md bg-[#24292f] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#24292f]/90 transition-colors"
      >
        使用 GitHub 登录
      </button>
      <button
        type="button"
        onClick={() => void authClient.signIn.social({ provider: "bili-sign", callbackURL: "/" })}
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
        onClick={() => {
          void fetch("/api/auth/anonymous-key", { method: "POST" })
            .then((r) => r.json())
            .then((data) => {
              if (data?.apiKey) {
                localStorage.setItem("uooc_api_key", data.apiKey);
                document.cookie = `apiKey=${encodeURIComponent(data.apiKey)}; path=/; max-age=2678400; SameSite=Lax`;
              }
              window.location.href = "/";
            });
        }}
        className="w-full rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
      >
        匿名注册并下发 API Key（可用于插件）
      </button>

      <form onSubmit={handleApiKeyLogin} className="space-y-2 border-t pt-3">
        <label className="text-xs font-medium text-muted-foreground block">
          软件插件已登录 / Webview 注入 API Key 登录
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="粘贴 uooc_ 开头的 API Key..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={!apiKeyInput.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            登录
          </button>
        </div>
      </form>
    </div>
  );
}
