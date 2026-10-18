import { useState, type FormEvent } from "react";

const AI_PROMPT = `你是一个专业的 UOOC（优课联盟）题目数据清洗与录入专家。给定包含测试结果、测验解析的 PDF、截图或文本内容，请提取该测验/题组的所有题目与答案，整理为符合平台规范的 JSON 数据。

【提取与清洗规范】
1. 基础信息：
   - tid: UOOC 题组 ID（必填，如 "100234"）
   - cid: UOOC 课程 ID（可选，如 "2048"）
   - task_name: 题组/测验名称（可选，如 "第3章单元测验"）
   - course_name: 课程名称（可选，如 "高等数学"）

2. 题目识别：
   - question_id: UOOC 题单真实单题 ID（优先提取对应 /exam/getTaskPaper 接口返回的真实数字 ID 如 "2057971114"；若解析文件中无真实单题 ID，请按题号提取为 "1", "2"）
   - type: 题型，必须为 single (单选) / multiple (多选) / judge (判断) / text (填空) 之一
   - stem: 完整题干纯文本（注意：严禁包含任何 HTML 标签，必须彻底过滤为纯文本；若包含 HTML 标签将被服务端直接拒绝）
   - options: 选项列表 [{"id": "A", "text": "选项完整纯文本"}, ...]。选项文本必须过滤 HTML 标签。对判断题，选项固定为 [{"id": "A", "text": "正确"}, {"id": "B", "text": "错误"}]
   - blanks: 填空题空数（填空题时填写，对应该题目提供的填空空数）

3. 答案识别：
   - 单选 / 多选题：保存选项时，应当仅保存对应 options[].id 值的那个选项（单选如 ["A"]，多选如 ["A", "C"]），切勿保存选项文本内容（因为选项内容已在 options[].text 内保存）
   - 判断题：永远只有 A. 正确、B. 错误 两个选项，以唯一的 boolean 项存储（正确为 [true]，错误为 [false]）
   - 填空题：支持上传 values[] 数组（如 ["第一空答案", "第二空答案"]），数组标号（0, 1...）严格对应该题目提供的填空的空数
   - wrong_answers: 若题目尚未得知正确答案但已知某些选项错误，提取已排除的错误选项 ID 数组（单选/多选如 ["B", "D"]，判断题如 [false]）；若无已知错误选项设为 null
   - 若答案完全未知，correct_answers / values 与 wrong_answers 均设为 null

【JSON 输出格式】
{
  "tid": "100234",
  "cid": "2048",
  "task_name": "第3章单元测验",
  "course_name": "高等数学",
  "questions": [
    {
      "question_id": "2057971114",
      "type": "single",
      "stem": "关于极限，下列说法正确的是？",
      "options": [
        {"id": "A", "text": "有界函数必有极限"},
        {"id": "B", "text": "单调有界数列必有极限"}
      ],
      "correct_answers": ["B"],
      "wrong_answers": null
    },
    {
      "question_id": "2057971115",
      "type": "judge",
      "stem": "所有初等函数在其定义域内均连续。",
      "options": [
        {"id": "A", "text": "正确"},
        {"id": "B", "text": "错误"}
      ],
      "correct_answers": [true],
      "wrong_answers": null
    },
    {
      "question_id": "2057971116",
      "type": "text",
      "stem": "微积分基本公式又称做____公式。",
      "blanks": 1,
      "values": ["牛顿-莱布尼茨"],
      "wrong_answers": null
    }
  ]
}

请直接输出符合上述格式的合法 JSON，不要包含额外的 Markdown 代码块外壳或任何多余解释。`;

export default function UploadForm() {
  const [mode, setMode] = useState<"json" | "ai">("ai");
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
      const hasHtml = /<(?:[a-zA-Z/][a-zA-Z0-9:-]*\b[^>]*|!--[\s\S]*?--)>/i;
      for (const q of data.questions) {
        if (!q.question_id) return { valid: false, error: "每道题必须有 question_id" };
        if (!["single", "multiple", "judge", "text"].includes(q.type))
          return { valid: false, error: `无效的题目类型: ${q.type}` };
        if (q.stem && hasHtml.test(q.stem))
          return {
            valid: false,
            error: `题目 #${q.question_id} 的题干包含未过滤的 HTML 标签，请先过滤纯文本后再提交`,
          };
        if (Array.isArray(q.options)) {
          for (const opt of q.options) {
            if (opt && (hasHtml.test(opt.text) || hasHtml.test(opt.id))) {
              return {
                valid: false,
                error: `题目 #${q.question_id} 的选项包含未过滤的 HTML 标签，请先过滤纯文本后再提交`,
              };
            }
          }
        }
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
          onClick={() => setMode("ai")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "ai" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          AI 辅助提取
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === "json" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          直接粘贴 JSON
        </button>
      </div>

      {mode === "ai" && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <h3 className="font-semibold text-sm">使用方法</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>复制下方提示词到你的 AI 对话工具 (ChatGPT, Claude, Cursor 等)</li>
            <li>发送包含答案的 PDF、试卷截图或网页解析文本给 AI</li>
            <li>将 AI 生成的标准 JSON 复制粘贴到下方输入框提交</li>
          </ol>
          <div className="relative">
            <pre className="rounded border bg-background p-3 text-xs overflow-auto max-h-56 whitespace-pre-wrap font-sans">
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
          </div>
          <textarea
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setStatus({ type: "idle", message: "" });
            }}
            rows={16}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="在此粘贴清洗后的 JSON 数据..."
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
