import { useState, type FormEvent } from "react";

const EXAMPLE_JSON = `{
  "tid": "12345",
  "cid": "678",
  "questions": [
    {
      "question_id": "q1",
      "type": "single",
      "stem": "以下哪个选项正确？",
      "options": [
        {"id": "A", "text": "选项A"},
        {"id": "B", "text": "选项B"},
        {"id": "C", "text": "选项C"},
        {"id": "D", "text": "选项D"}
      ],
      "correct_answers": ["A"],
      "wrong_answers": null
    }
  ]
}`;

const AI_PROMPT = `你是 UOOC 题目数据提取助手。给定包含测试结果的 PDF 或图片内容，请提取每道题目的以下信息：

- question_id: 题目编号/ID
- type: 题目类型 (single=单选, multiple=多选, judge=判断, text=填空)
- stem: 题干文本 (保留 HTML 标签)
- options: 选项列表 [{id: "A", text: "选项内容"}, ...] (选择题)
- correct_answers: 正确答案 (如已标注) ["A"] 或 ["填空内容"]
- wrong_answers: 已知错误答案 (如有) ["C", "D"]

请按以下 JSON 格式输出，按 tid (题组 ID) 分组：

{
  "tid": "题组ID",
  "cid": "课程ID",
  "questions": [
    {
      "question_id": "题目ID",
      "type": "single",
      "stem": "题干内容",
      "options": [{"id": "A", "text": "选项A"}],
      "correct_answers": ["A"],
      "wrong_answers": null
    }
  ]
}

注意：
- 题干和选项中的 HTML 标签请保留
- 如果无法确定正确答案，设为 null
- 如果只知道某些选项是错的，放入 wrong_answers
- question_id 和 type 是必填项`;

export default function UploadForm() {
  const [mode, setMode] = useState<"json" | "ai">("json");
  const [json, setJson] = useState("");
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "success" | "error";
    message: string;
  }>({ type: "idle", message: "" });
  const [promptCopied, setPromptCopied] = useState(false);

  function validate(text: string): { valid: boolean; data?: unknown; error?: string } {
    try {
      const data = JSON.parse(text);
      if (!data.tid) return { valid: false, error: "缺少 tid 字段" };
      if (!Array.isArray(data.questions) || data.questions.length === 0)
        return { valid: false, error: "questions 必须是非空数组" };
      for (const q of data.questions) {
        if (!q.question_id) return { valid: false, error: "每道题必须有 question_id" };
        if (!["single", "multiple", "judge", "text"].includes(q.type))
          return { valid: false, error: `无效的题目类型: ${q.type}` };
      }
      return { valid: true, data };
    } catch {
      return { valid: false, error: "JSON 格式错误" };
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { valid, error } = validate(json);
    if (!valid) {
      setStatus({ type: "error", message: error! });
      return;
    }

    setStatus({ type: "loading", message: "上传中..." });
    try {
      const res = await fetch("/api/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      const data = await res.json();
      if (data.ok) {
        const count = data.results?.length ?? 0;
        setStatus({ type: "success", message: `上传成功！处理了 ${count} 道题目` });
      } else {
        setStatus({ type: "error", message: data.error ?? "上传失败" });
      }
    } catch {
      setStatus({ type: "error", message: "网络错误" });
    }
  }

  function copyPrompt() {
    void navigator.clipboard.writeText(AI_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "json" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          直接粘贴 JSON
        </button>
        <button
          type="button"
          onClick={() => setMode("ai")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "ai" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          AI 辅助提取
        </button>
      </div>

      {mode === "ai" && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <h3 className="font-semibold text-sm">使用方法</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>复制下方提示词到你的 AI 对话工具 (ChatGPT, Claude 等)</li>
            <li>发送包含答案的 PDF 或图片给 AI</li>
            <li>将 AI 返回的 JSON 粘贴到下方文本框</li>
          </ol>
          <div className="relative">
            <pre className="rounded border bg-background p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap">
              {AI_PROMPT}
            </pre>
            <button
              type="button"
              onClick={copyPrompt}
              className="absolute top-2 right-2 rounded border bg-background px-2 py-1 text-xs hover:bg-accent transition-colors"
            >
              {promptCopied ? "已复制 ✓" : "复制"}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">JSON 数据</label>
            <button
              type="button"
              onClick={() => setJson(EXAMPLE_JSON)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              填入示例
            </button>
          </div>
          <textarea
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setStatus({ type: "idle", message: "" });
            }}
            rows={16}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="在此粘贴 JSON 数据..."
          />
        </div>

        {status.type !== "idle" && (
          <p
            className={`text-sm ${status.type === "error" ? "text-red-500" : status.type === "success" ? "text-green-600" : "text-muted-foreground"}`}
          >
            {status.message}
          </p>
        )}

        <button
          type="submit"
          disabled={status.type === "loading" || !json.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {status.type === "loading" ? "上传中..." : "提交上传"}
        </button>
      </form>
    </div>
  );
}
