const typeLabels: Record<string, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  text: "填空题",
};

const typeBadgeColors: Record<string, string> = {
  single: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  multiple: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  judge: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  text: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

type Answer = {
  id: number;
  values: unknown[];
  isCorrect: boolean;
  source: string;
  confidence: number;
};

type Question = {
  id: number;
  tid: string;
  questionId: string | null;
  type: string;
  stem: string | null;
  options: { id: string; text: string }[] | null;
  answers?: Answer[];
  similarity?: number;
};

function isOptionSelected(values: unknown[], optId: string, qType?: string): boolean {
  if (!Array.isArray(values)) return false;
  return values.some((val) => {
    if (val === optId) return true;
    if (qType === "judge" || optId === "A" || optId === "B") {
      if (optId === "A" && (val === true || val === "true" || val === "正确")) return true;
      if (optId === "B" && (val === false || val === "false" || val === "错误")) return true;
    }
    return false;
  });
}

function formatAnswerValues(values: unknown[], qType?: string): string {
  if (!Array.isArray(values)) return String(values);
  if (qType === "text" && values.length > 1) {
    return values.map((v, i) => `第${i + 1}空: ${String(v)}`).join("; ");
  }
  return values
    .map((v) => {
      if (typeof v === "boolean" || qType === "judge") {
        if (v === true || v === "true") return "A. 正确";
        if (v === false || v === "false") return "B. 错误";
      }
      return String(v);
    })
    .join(", ");
}

export default function QuestionCard({ question }: { question: Question }) {
  const q = question;
  const correctAnswers = q.answers?.filter((a) => a.isCorrect) ?? [];
  const wrongAnswers = q.answers?.filter((a) => !a.isCorrect) ?? [];
  const hasCorrect = correctAnswers.length > 0;
  const hasWrong = wrongAnswers.length > 0;

  return (
    <a
      href={`/questions/${q.id}`}
      className="block rounded-lg border p-4 space-y-2 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeColors[q.type] ?? "bg-gray-100 text-gray-800"}`}
        >
          {typeLabels[q.type] ?? q.type}
        </span>
        {hasCorrect ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            ✓ 已确认正确答案
          </span>
        ) : hasWrong ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            ✗ 已排除 {wrongAnswers.length} 项错误答案
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border">
            未录入答案
          </span>
        )}
        <span className="text-xs text-muted-foreground">tid: {q.tid}</span>
        {q.questionId && <span className="text-xs text-muted-foreground">#{q.questionId}</span>}
        {q.similarity != null && (
          <span className="text-xs text-muted-foreground">
            相似度: {(q.similarity * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {q.stem ? (
        <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: q.stem }} />
      ) : (
        <p className="text-sm text-muted-foreground italic">（题干未录入）</p>
      )}

      {q.options && q.options.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {q.options.map((opt) => {
            const isCorrectOpt = correctAnswers.some((a) =>
              isOptionSelected(a.values, opt.id, q.type),
            );
            const isWrongOpt = wrongAnswers.some((a) => isOptionSelected(a.values, opt.id, q.type));
            return (
              <span
                key={opt.id}
                className={`rounded border px-2 py-1 inline-flex items-center gap-1.5 transition-colors ${
                  isCorrectOpt
                    ? "border-green-500 bg-green-50 text-green-700 font-medium dark:bg-green-950 dark:text-green-300"
                    : isWrongOpt
                      ? "border-red-400 bg-red-50/80 text-red-700 line-through dark:bg-red-950/60 dark:text-red-300"
                      : "border-border"
                }`}
              >
                <span>
                  {opt.id}. {opt.text}
                </span>
                {isWrongOpt && (
                  <span className="text-[10px] no-underline font-normal text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/60 px-1 rounded">
                    已排除
                  </span>
                )}
                {isCorrectOpt && (
                  <span className="text-[10px] no-underline font-normal text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/60 px-1 rounded">
                    正确
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 text-xs pt-1 border-t border-border/50">
        {hasCorrect && (
          <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
            <span>✓ 正确答案:</span>
            <span>
              {correctAnswers.map((a) => formatAnswerValues(a.values, q.type)).join(" | ")}
            </span>
          </span>
        )}
        {hasWrong && (
          <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
            <span>✗ 已排除答案 (用户提交确认错误):</span>
            <span className="font-semibold underline decoration-red-400 decoration-wavy">
              {wrongAnswers.map((a) => formatAnswerValues(a.values, q.type)).join(", ")}
            </span>
          </span>
        )}
        {!hasCorrect && !hasWrong && <span className="text-muted-foreground">暂无答案</span>}
      </div>
    </a>
  );
}
