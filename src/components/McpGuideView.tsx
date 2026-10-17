import { useState, useEffect } from "react";

export default function McpGuideView() {
  const [origin, setOrigin] = useState("http://localhost:4321");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const mcpUrl = `${origin}/mcp`;

  const installPrompt = `请帮我安装并配置 UOOC QA Share 的 MCP (Model Context Protocol) 服务：

- 服务名称: uooc-qa-share
- 传输协议: HTTP / SSE (Streamable HTTP)
- Server URL: ${mcpUrl}
- (可选) Headers: 如果需要绑定认证账号以获得覆盖更新答案的权限，可添加请求头 x-api-key: <你的_API_KEY>

请在当前环境的 MCP 配置文件或工具设置中添加该服务，并核验工具连接状态。`;

  const scenarioPrompt = `这是我刚导出的 UOOC 测验结果 PDF，对应的课程号 cid 是 2048，题组号 tid 是 100234。请使用 MCP 工具 analyze_and_upload_qa 分析该文件，提取每道题的题型、题干、选项与确认答案，并通过 upload_answers 工具录入题库。`;

  const cliCommand = `claude mcp add uooc-qa-share -- ${mcpUrl}`;

  return (
    <div className="space-y-8 max-w-3xl mx-auto py-4">
      {/* 头部说明 */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-primary/5 text-primary text-xs font-medium">
          <span>🤖 Model Context Protocol</span>
          <span>·</span>
          <span>AI 自动化接入</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">MCP + AI Agent 接入指南</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          平台内置标准的 MCP 服务端点。无需手动翻找和修改配置文件，您可以直接将安装 Prompt
          发送给支持 MCP 的 AI Agent（如 Claude Code、Cursor、Windsurf、Cline、Roo Code、Claude
          Desktop 等），让 AI 自动帮您连接题库。
        </p>
      </div>

      {/* 1. 直接指导 AI 安装 MCP 的 Prompt 示例 */}
      <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
              <span>⚡ 直接指导 AI 安装 MCP</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              复制以下 Prompt，直接发送给您的 AI 助手，AI 会自动帮您在本地完成 MCP Server 配置：
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyText("installPrompt", installPrompt)}
            className="shrink-0 text-xs rounded-md border bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90 transition-colors font-medium"
          >
            {copiedKey === "installPrompt" ? "已复制 Prompt ✓" : "复制安装 Prompt"}
          </button>
        </div>

        <div className="relative">
          <pre className="p-3.5 rounded-lg bg-muted/60 font-sans text-xs leading-relaxed overflow-auto whitespace-pre-wrap text-foreground select-all border">
            {installPrompt}
          </pre>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-muted-foreground font-sans">CLI 快捷命令:</span>
            <code className="p-1 rounded bg-muted/50 border">{cliCommand}</code>
          </div>
          <button
            type="button"
            onClick={() => copyText("cliCommand", cliCommand)}
            className="self-start sm:self-auto text-[11px] underline hover:text-foreground"
          >
            {copiedKey === "cliCommand" ? "已复制 ✓" : "复制命令"}
          </button>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2.5">
          💡 提示：如需绑定个人账号以获得答案覆盖更新权限，可先在{" "}
          <a href="/login" className="text-primary underline">
            账户中心
          </a>{" "}
          获取 API Key，并在 Prompt 中将 <code>&lt;你的_API_KEY&gt;</code> 替换为真实 Key。
        </div>
      </div>

      {/* 2. 场景实战部分 */}
      <div className="rounded-xl border p-5 bg-card space-y-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
              <span>📸 场景实战：Agent 本地分析 PDF / 截图自动入库</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              连接成功后，在 Agent 对话中拖入试卷或解析文件，并附带以下指令即可自动入库：
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyText("scenarioPrompt", scenarioPrompt)}
            className="shrink-0 text-xs rounded-md border bg-background px-3 py-1.5 hover:bg-accent transition-colors font-medium"
          >
            {copiedKey === "scenarioPrompt" ? "已复制 Prompt ✓" : "复制实战 Prompt"}
          </button>
        </div>

        <div className="p-3.5 rounded-lg bg-muted/30 border font-sans text-xs leading-relaxed text-foreground select-all">
          {scenarioPrompt}
        </div>

        <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground pt-2">
          <div className="border rounded-lg p-3 space-y-1 bg-muted/10">
            <span className="font-semibold text-foreground block">1. 本地阅读与识别</span>
            Agent 利用多模态直接阅读 PDF 文档或截图标注，保留题干与选项中可能的 HTML 格式。
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/10">
            <span className="font-semibold text-foreground block">2. 标准格式清洗</span>
            提取真实单题 ID、完整选项文本以防乱序，并自动分离已确认正确答案与排除错误项。
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/10">
            <span className="font-semibold text-foreground block">3. 工具一键上传</span>
            Agent 调用 <code>upload_answers</code> 工具提交，平台自动执行三级匹配去重与答案更新。
          </div>
        </div>
      </div>
    </div>
  );
}
