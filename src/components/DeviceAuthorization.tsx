import { useState, useEffect, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

interface VerifiedInfo {
  clientId?: string;
  scope?: string;
  status?: string;
}

export default function DeviceAuthorization() {
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const [userCode, setUserCode] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifiedInfo, setVerifiedInfo] = useState<VerifiedInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);

  // Parse URL query parameters on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("user_code") || params.get("code");
    const agentParam = params.get("agent_id");

    if (codeParam) {
      setUserCode(codeParam.trim().toUpperCase());
    }
    if (agentParam) {
      setAgentId(agentParam.trim());
    }
  }, []);

  // When user is logged in and userCode is available, verify the code
  useEffect(() => {
    if (!userCode || sessionLoading || !session?.user) return;
    // Don't auto-verify if already finished
    if (result) return;

    if (agentId) {
      // Agent-auth mode: agentId and userCode are present
      setVerifiedInfo({
        clientId: `Agent (${agentId})`,
        status: "pending",
      });
      return;
    }

    // Standard device authorization verification
    let canceled = false;
    async function verify() {
      setVerifying(true);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (canceled) return;

        if (!res.ok) {
          const desc = data?.error_description || data?.message || "设备验证码无效或已过期";
          setErrorMessage(desc);
          setVerifiedInfo(null);
        } else {
          setVerifiedInfo({
            clientId: data?.client_id || "未知客户端 / 插件",
            scope: data?.scope || "全量题目访问与答案提交权限",
            status: data?.status || "pending",
          });
          if (data?.status === "approved") {
            setResult("approved");
          } else if (data?.status === "denied") {
            setResult("denied");
          }
        }
      } catch (err: unknown) {
        if (!canceled) {
          setErrorMessage((err as Error)?.message || "无法连接至认证服务器");
        }
      } finally {
        if (!canceled) setVerifying(false);
      }
    }

    void verify();
    return () => {
      canceled = true;
    };
  }, [userCode, session, sessionLoading, agentId, result]);

  // Handle manual code submission form
  function handleManualCodeSubmit(e: FormEvent) {
    e.preventDefault();
    const formatted = userCode.trim().toUpperCase();
    if (!formatted) return;
    setUserCode(formatted);
    // Update URL query parameter without page reload
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("user_code", formatted);
      window.history.replaceState({}, "", url.toString());
    }
  }

  // Handle Approve
  async function handleApprove() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      if (agentId) {
        // Agent Auth approval
        const res = await fetch("/api/auth/agent/approve-capability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            user_code: userCode,
            action: "approve",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error_description || data?.message || "Agent 授权失败");
        }
        setResult("approved");
      } else {
        // Better Auth Device Authorization approval
        const res = await fetch("/api/auth/device/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userCode,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error_description || data?.message || "设备授权失败");
        }
        setResult("approved");
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || "提交授权时发生异常");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Deny
  async function handleDeny() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      if (agentId) {
        const res = await fetch("/api/auth/agent/approve-capability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            user_code: userCode,
            action: "deny",
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data?.error_description || "拒绝操作失败");
        }
      } else {
        const res = await fetch("/api/auth/device/deny", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userCode,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data?.error_description || "拒绝操作失败");
        }
      }
      setResult("denied");
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || "拒绝授权时发生错误");
    } finally {
      setSubmitting(false);
    }
  }

  const currentUrl = typeof window !== "undefined" ? window.location.href : "/device";

  if (sessionLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">正在检查账户登录状态...</div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border bg-primary/5 text-primary text-xs font-medium">
          <span>📱 RFC 8628 Device Authorization</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">设备与插件授权</h1>
        <p className="text-sm text-muted-foreground">
          允许无回调地址的终端、插件或 AI Agent 安全连接并认证至您的 UOOC QA 账户
        </p>
      </div>

      {/* Case 1: Finished - Approved */}
      {result === "approved" && (
        <div className="rounded-xl border border-green-500/30 bg-green-50/50 dark:bg-green-950/20 p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 mx-auto flex items-center justify-center text-2xl font-bold">
            ✓
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-green-800 dark:text-green-300">授权成功！</h2>
            <p className="text-xs text-muted-foreground">
              您已成功将账号授权给外部设备或浏览器插件。终端与插件已自动获取认证凭据，您可以关闭此页面并返回继续操作。
            </p>
          </div>
          <div className="pt-2">
            <a
              href="/"
              className="inline-block rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              返回题库首页
            </a>
          </div>
        </div>
      )}

      {/* Case 2: Finished - Denied */}
      {result === "denied" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive mx-auto flex items-center justify-center text-2xl font-bold">
            ✕
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-destructive">已拒绝授权</h2>
            <p className="text-xs text-muted-foreground">
              您已取消本次设备授权请求。该设备将不会获得访问您的题库账号的权限。
            </p>
          </div>
          <div className="pt-2">
            <a
              href="/"
              className="inline-block rounded-md border px-4 py-2 text-xs font-medium hover:bg-accent transition-colors"
            >
              返回首页
            </a>
          </div>
        </div>
      )}

      {/* Case 3: Need User Login */}
      {!result && !session?.user && (
        <div className="rounded-xl border bg-card p-6 space-y-5">
          <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20 p-3.5 space-y-1 text-left">
            <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              请先登录您的账户
            </div>
            <p className="text-xs text-muted-foreground">
              完成设备授权后，您的插件或 Agent
              将以您的用户身份执行录题与答案覆盖，因此需要您先登录。
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() =>
                void authClient.signIn.social({ provider: "github", callbackURL: currentUrl })
              }
              className="w-full rounded-md bg-[#24292f] px-4 py-2 text-xs font-medium text-white hover:bg-[#24292f]/90 transition-colors"
            >
              使用 GitHub 登录并继续授权
            </button>
            <button
              type="button"
              onClick={() =>
                void authClient.signIn.social({ provider: "bili-sign", callbackURL: currentUrl })
              }
              className="w-full rounded-md bg-[#fb7299] px-4 py-2 text-xs font-medium text-white hover:bg-[#fb7299]/90 transition-colors"
            >
              使用 bili-sign 登录并继续授权
            </button>
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
                    window.location.reload();
                  });
              }}
              className="w-full rounded-md border px-4 py-2 text-xs font-medium hover:bg-accent transition-colors text-muted-foreground"
            >
              以匿名账户登录并继续
            </button>
          </div>
        </div>
      )}

      {/* Case 4: Logged in - Input code or Review authorization */}
      {!result && session?.user && (
        <div className="rounded-xl border bg-card p-6 space-y-6">
          {/* User badge */}
          <div className="flex items-center justify-between text-xs pb-3 border-b">
            <span className="text-muted-foreground">当前登录身份：</span>
            <span className="font-semibold text-foreground">
              {session.user.name}{" "}
              {session.user.isAnonymous && (
                <span className="text-amber-600 dark:text-amber-400 font-normal">(匿名)</span>
              )}
            </span>
          </div>

          {/* If no userCode specified yet, prompt user to enter it */}
          {!userCode && (
            <form onSubmit={handleManualCodeSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold block">
                  输入设备或终端上显示的 8 位用户码 (User Code)
                </label>
                <input
                  type="text"
                  maxLength={16}
                  value={userCode}
                  onChange={(e) => setUserCode(e.target.value.toUpperCase())}
                  placeholder="例如: ABCD-1234"
                  className="w-full rounded-md border border-input bg-background px-4 py-2.5 text-center text-lg font-mono tracking-widest uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  若您的插件已通过链接自动打开此页，用户码将自动填入。
                </p>
              </div>

              <button
                type="submit"
                disabled={!userCode.trim()}
                className="w-full rounded-md bg-primary py-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                验证用户码
              </button>
            </form>
          )}

          {/* When userCode is present: show verification details and action buttons */}
          {userCode && (
            <div className="space-y-5">
              <div className="rounded-lg bg-muted/40 p-4 border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">用户码 (User Code)</span>
                  <code className="text-base font-mono font-bold tracking-wider text-primary">
                    {userCode}
                  </code>
                </div>

                {verifying ? (
                  <div className="py-2 text-center text-xs text-muted-foreground">
                    正在核对设备授权码...
                  </div>
                ) : verifiedInfo ? (
                  <>
                    <div className="flex items-center justify-between text-xs border-t pt-2">
                      <span className="text-muted-foreground">请求客户端 (Client ID)</span>
                      <span className="font-mono font-medium">{verifiedInfo.clientId}</span>
                    </div>
                    {verifiedInfo.scope && (
                      <div className="flex items-start justify-between text-xs border-t pt-2">
                        <span className="text-muted-foreground">授权权限</span>
                        <span className="text-right text-foreground max-w-[200px]">
                          {verifiedInfo.scope}
                        </span>
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {errorMessage && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}

              {verifiedInfo && (
                <div className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={submitting || verifying}
                      onClick={handleApprove}
                      className="rounded-md bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {submitting ? "正在授权..." : "批准授权"}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || verifying}
                      onClick={handleDeny}
                      className="rounded-md border py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-center pt-1">
                    批准后，该应用将在有效期内代表您访问题库数据并上传题目
                  </p>
                </div>
              )}

              {!verifiedInfo && !verifying && errorMessage && (
                <button
                  type="button"
                  onClick={() => {
                    setUserCode("");
                    setErrorMessage(null);
                  }}
                  className="w-full rounded-md border py-2 text-xs font-medium hover:bg-accent"
                >
                  重新输入用户码
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Help & Integration Tip */}
      <div className="rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
        <div className="font-semibold text-foreground">💡 开发者与插件集成提示</div>
        <p>
          在无法预先指定固定重定向 URI（如油猴脚本、浏览器扩展程序、本地 CLI
          或外部大模型代理）的场景下，通过向{" "}
          <code className="text-primary font-mono">/api/auth/device/code</code> 发起 POST
          请求即可触发 RFC 8628 设备授权流，用户确认后轮询{" "}
          <code className="text-primary font-mono">/api/auth/device/token</code> 即可无缝获取
          Session Bearer Token。
        </p>
      </div>
    </div>
  );
}
