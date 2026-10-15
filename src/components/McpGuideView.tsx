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
  const discoveryUrl = `${origin}/.well-known/agent-configuration`;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        "uooc-qa-share": {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );

  const claudeDesktopWithKeyConfig = JSON.stringify(
    {
      mcpServers: {
        "uooc-qa-share": {
          url: mcpUrl,
          headers: {
            "x-api-key": "uooc_YOUR_API_KEY_HERE",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-2">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-primary/5 text-primary text-xs font-medium">
          <span>🤖 Model Context Protocol</span>
          <span>·</span>
          <span>Streamable HTTP & CORS Ready</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">MCP + AI Agent 模式接入说明</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          平台内置标准的 MCP（Model Context Protocol）协议端点，支持跨域访问与 Agent Auth
          规范。您可以在 Claude Desktop、Cursor、Cline、Windsurf
          等客户端中直接连接本平台，利用大模型分析本地包含答案的试卷
          PDF、截图与文本，自动清洗并一键批量入库。
        </p>
      </div>

      {/* Endpoint Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4 bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              MCP Server Endpoint
            </span>
            <button
              type="button"
              onClick={() => copyText("mcpUrl", mcpUrl)}
              className="text-xs rounded border px-2 py-0.5 hover:bg-accent transition-colors"
            >
              {copiedKey === "mcpUrl" ? "已复制 ✓" : "复制 URL"}
            </button>
          </div>
          <code className="text-sm font-mono block p-2 rounded bg-muted/50 break-all text-primary font-medium">
            {mcpUrl}
          </code>
          <p className="text-xs text-muted-foreground">
            支持 HTTP POST (JSON-RPC) 与 GET SSE，跨域已开启。
          </p>
        </div>

        <div className="rounded-xl border p-4 bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Agent Auth Discovery
            </span>
            <button
              type="button"
              onClick={() => copyText("discoveryUrl", discoveryUrl)}
              className="text-xs rounded border px-2 py-0.5 hover:bg-accent transition-colors"
            >
              {copiedKey === "discoveryUrl" ? "已复制 ✓" : "复制 URL"}
            </button>
          </div>
          <code className="text-sm font-mono block p-2 rounded bg-muted/50 break-all text-foreground/80">
            {discoveryUrl}
          </code>
          <p className="text-xs text-muted-foreground">
            遵循 Agent Auth 协议规范，供智能体自主发现端点与 Capabilities。
          </p>
        </div>
      </div>

      {/* Client Setup Guide */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span>⚡ 客户端快速配置</span>
        </h2>

        <div className="space-y-4">
          {/* Claude Desktop */}
          <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">1. Claude Desktop 配置</h3>
                <p className="text-xs text-muted-foreground">
                  编辑 <code>claude_desktop_config.json</code> 文件加入服务器
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyText("claudeJson", claudeDesktopConfig)}
                className="text-xs rounded border px-2 py-1 bg-background hover:bg-accent"
              >
                {copiedKey === "claudeJson" ? "已复制 ✓" : "复制配置"}
              </button>
            </div>
            <pre className="p-3 rounded-md bg-muted/60 font-mono text-xs overflow-auto">
              {claudeDesktopConfig}
            </pre>
            <p className="text-xs text-muted-foreground">
              注：若希望 Agent 以您的特定身份录入题目（覆盖更新权限），可在 <code>headers</code>{" "}
              中添加 <code>x-api-key</code>：
            </p>
            <pre className="p-2.5 rounded-md bg-muted/40 font-mono text-xs overflow-auto">
              {claudeDesktopWithKeyConfig}
            </pre>
          </div>

          {/* Cursor / Windsurf / Cline */}
          <div className="rounded-lg border p-4 space-y-2 bg-muted/10">
            <h3 className="font-semibold text-sm">2. Cursor / Windsurf / Cline / Roo Code 配置</h3>
            <p className="text-xs text-muted-foreground">在客户端的 MCP 设置中添加自定义服务器：</p>
            <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
              <li>
                <strong>Server Name</strong>: <code>uooc-qa-share</code>
              </li>
              <li>
                <strong>Type</strong>: <code>sse</code> 或 <code>http</code>
              </li>
              <li>
                <strong>Server URL</strong>: <code>{mcpUrl}</code>
              </li>
              <li>
                <strong>Headers (可选)</strong>: <code>x-api-key: uooc_YOUR_KEY</code>{" "}
                (用于绑定特定账号)
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* How to use with PDF / Images */}
      <div className="space-y-4 rounded-xl border p-5 bg-card">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span>📸 场景实战：Agent 本地分析 PDF / 截图自动入库</span>
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          平台内置了系统提示词模板 <code>analyze_and_upload_qa</code>。连接 MCP 后，您只需在 Agent
          对话框中拖入试卷或解析文件，并给出简短指令，Agent 就会自动完成识别、清洗与上报：
        </p>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            推荐发送给 Agent 的 Prompt 示例：
          </p>
          <div className="p-3 rounded bg-background border font-sans text-xs leading-relaxed text-foreground select-all">
            "这是我刚导出的 UOOC 测验结果 PDF，对应的课程号 cid 是 2048，题组号 tid 是
            100234。请使用 MCP 工具 analyze_and_upload_qa
            分析该文件，提取每道题的题型、题干、选项与确认答案，并通过 upload_answers
            工具录入题库。"
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground pt-1">
          <div className="border rounded p-3 space-y-1">
            <span className="font-semibold text-foreground block">1. 本地阅读与识别</span>
            Agent 利用多模态能力直接在本地阅读 PDF 文档或截图标注，保留题干与选项中可能的 HTML
            标签。
          </div>
          <div className="border rounded p-3 space-y-1">
            <span className="font-semibold text-foreground block">2. 标准格式清洗</span>
            区分单选/多选/判断/填空，分离已确认正确答案与排除错误答案。
          </div>
          <div className="border rounded p-3 space-y-1">
            <span className="font-semibold text-foreground block">3. 工具一键上传</span>
            Agent 调用 <code>upload_answers</code> 工具入库，平台自动执行三级匹配去重与答案清理。
          </div>
        </div>
      </div>

      {/* Tools List */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span>🛠️ 平台注册的 MCP 工具列表</span>
        </h2>
        <div className="grid gap-3">
          <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <code className="text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                search_questions
              </code>
              <span className="text-xs text-muted-foreground">搜索题目</span>
            </div>
            <p className="text-xs text-muted-foreground">
              按题干关键词或自然语言描述搜索题库。支持 pgvector 词向量语义检索与 ILIKE
              文本模糊回退。
            </p>
            <div className="text-[11px] font-mono text-muted-foreground">
              参数: <code>query: string</code> (搜索词)
            </div>
          </div>

          <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <code className="text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                get_task_answers
              </code>
              <span className="text-xs text-muted-foreground">获取题组全量试卷与答案</span>
            </div>
            <p className="text-xs text-muted-foreground">
              获取某个题组(tid)下所有题目以及已知答案列表（包含正确答案与已排除的错误答案）。
            </p>
            <div className="text-[11px] font-mono text-muted-foreground">
              参数: <code>tid: string</code> (UOOC 题组 ID)
            </div>
          </div>

          <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <code className="text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                get_question_answer
              </code>
              <span className="text-xs text-muted-foreground">单题详情</span>
            </div>
            <p className="text-xs text-muted-foreground">
              获取单道题目的详情、选项、置信度与答案记录（支持平台内部数字 ID 或 UOOC DOM
              question_id）。
            </p>
            <div className="text-[11px] font-mono text-muted-foreground">
              参数: <code>question_id: string</code>
            </div>
          </div>

          <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <code className="text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                get_course_tasks
              </code>
              <span className="text-xs text-muted-foreground">课程题组列表</span>
            </div>
            <p className="text-xs text-muted-foreground">
              获取指定课程号(cid)下已收录的全部测验/任务题组。
            </p>
            <div className="text-[11px] font-mono text-muted-foreground">
              参数: <code>cid: string</code> (课程 ID)
            </div>
          </div>

          <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <code className="text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                upload_answers
              </code>
              <span className="text-xs text-muted-foreground">批量清洗上传题目</span>
            </div>
            <p className="text-xs text-muted-foreground">
              批量上传题目、选项与答案。支持单题正确答案录入或错误答案排除。
            </p>
            <div className="text-[11px] font-mono text-muted-foreground">
              参数: <code>data: string</code> (符合平台规范的 JSON 字符串)
            </div>
          </div>
        </div>
      </div>

      {/* Auth Info */}
      <div className="rounded-xl border p-4 bg-muted/20 space-y-2 text-xs text-muted-foreground">
        <h3 className="font-semibold text-foreground text-sm">🔒 认证与身份继承说明</h3>
        <p>
          - <strong>Agent 默认连接</strong>：采用 Agent Auth
          协议或匿名访问模式，平台自动分配临时匿名 Agent
          用户态，允许查阅全库答案与新增试卷，但不可覆盖现有正确答案。
        </p>
        <p>
          - <strong>升级至正式权限</strong>：在客户端配置中附带在
          <a href="/login" className="underline text-primary mx-1">
            账户中心
          </a>
          生成的 API Key，Agent 上报时将自动继承您的认证用户身份，拥有完整覆盖与更新权限。
        </p>
      </div>
    </div>
  );
}
