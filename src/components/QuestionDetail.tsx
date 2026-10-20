import { useState, useEffect } from "react";

const typeLabels: Record<string, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  text: "填空题",
};

type Answer = {
  id: number;
  values: unknown[];
  isCorrect: boolean;
  source: string;
  confidence: number;
  submittedBy: string | null;
  createdAt: string;
};
type Question = {
  id: number;
  tid: string;
  questionId: string | null;
  type: string;
  stem: string | null;
  options: { id: string; text: string }[] | null;
  blanks: number;
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

export default function QuestionDetail({ questionId }: { questionId: string }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/questions/${questionId}`)
      .then((r) => r.json())
      .then((data) => {
        setQuestion(data.question ?? null);
        setAnswers(data.answers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [questionId]);

  if (loading) return <p className="text-muted-foreground">加载中...</p>;
  if (!question) return <p className="text-red-500">题目不存在</p>;

  const correct = answers.filter((a) => a.isCorrect);
  const wrong = answers.filter((a) => !a.isCorrect);
  const hasCorrect = correct.length > 0;
  const hasWrong = wrong.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {typeLabels[question.type] ?? question.type}
          </span>
          {hasCorrect ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              ✓ 已收录标准答案
            </span>
          ) : hasWrong ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
              ✗ 暂无标准答案 · 已排除 {wrong.length} 项错误答案
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border">
              未录入答案
            </span>
          )}
          {question.type === "text" && question.blanks > 0 && (
            <span className="text-xs text-muted-foreground">共 {question.blanks} 空</span>
          )}
          <span className="text-xs text-muted-foreground">ID: {question.id}</span>
          <span className="text-xs text-muted-foreground">
            题组:{" "}
            <a href={`/tasks/${question.tid}`} className="underline">
              {question.tid}
            </a>
          </span>
        </div>
        {question.stem ? (
          <div
            className="text-base leading-relaxed"
            dangerouslySetInnerHTML={{ __html: question.stem }}
          />
        ) : (
          <p className="text-muted-foreground italic">（题干未录入）</p>
        )}
      </div>

      {/* 答案高亮看板 */}
      {hasCorrect && (
        <div className="rounded-xl border border-green-300 bg-green-50/80 p-4 dark:border-green-900/60 dark:bg-green-950/30 space-y-1">
          <div className="flex items-center gap-2 text-green-800 dark:text-green-200 font-semibold text-sm">
            <span>✓ 已确认标准正确答案</span>
          </div>
          <div className="text-base font-bold text-green-900 dark:text-green-100">
            {correct.map((a) => formatAnswerValues(a.values, question.type)).join(" | ")}
          </div>
        </div>
      )}

      {!hasCorrect && hasWrong && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/30 space-y-2.5">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-semibold text-sm">
            <span>⚠️ 暂无确认的标准正确答案，已记录用户提交确认的错误答案（已排除项）：</span>
          </div>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
            以下答案已由做题用户在实际考试/测验提交后确认为错误答案。系统已将其标记为排除项，做题或使用插件时会自动剪枝避开，大幅降低试错成本。
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {wrong.map((a) => (
              <div
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-100/90 dark:border-red-800 dark:bg-red-950/70 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-200 shadow-sm"
              >
                <span className="line-through">{formatAnswerValues(a.values, question.type)}</span>
                <span className="rounded bg-red-200/80 dark:bg-red-900/80 px-1 py-0.5 text-[10px] text-red-800 dark:text-red-100">
                  已排除
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {question.options && question.options.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-muted-foreground">选项</h3>
          {question.options.map((opt) => {
            const isCorrect = correct.some((a) =>
              isOptionSelected(a.values, opt.id, question.type),
            );
            const isWrong = wrong.some((a) => isOptionSelected(a.values, opt.id, question.type));
            return (
              <div
                key={opt.id}
                className={`rounded border px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                  isCorrect
                    ? "border-green-500 bg-green-50 dark:bg-green-950 font-medium"
                    : isWrong
                      ? "border-red-400 bg-red-50/80 dark:bg-red-950/60 text-muted-foreground line-through"
                      : "border-border"
                }`}
              >
                <div>
                  <span className="font-medium mr-2">{opt.id}.</span>
                  {opt.text}
                </div>
                <div>
                  {isCorrect && (
                    <span className="text-xs font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/60 px-2 py-0.5 rounded no-underline">
                      ✓ 标准正确答案
                    </span>
                  )}
                  {isWrong && (
                    <span className="text-xs font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/60 px-2 py-0.5 rounded no-underline inline-block">
                      ✗ 已排除 (用户提交确认错误)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">答案与试错记录</h3>
        {answers.length === 0 && <p className="text-sm text-muted-foreground">暂无答案记录</p>}
        {answers.map((a) => (
          <div
            key={a.id}
            className={`rounded-lg border p-3 text-sm space-y-1.5 ${
              a.isCorrect
                ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/50"
                : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                    a.isCorrect
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                  }`}
                >
                  {a.isCorrect ? "✓ 确认的正确答案" : "✗ 已排除的答案 (用户提交确认错误)"}
                </span>
                <span className="font-medium text-foreground">
                  {formatAnswerValues(a.values, question.type)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {a.isCorrect ? "标准有效" : "剪枝排除项"}
              </span>
            </div>
            {!a.isCorrect && (
              <p className="text-xs text-muted-foreground">
                该答案已被用户在实际答题提交后确认为错误答案，系统已将其列为排除项用于剪枝防错。
              </p>
            )}
            <div className="text-xs text-muted-foreground flex items-center gap-3 pt-0.5">
              <span>来源: {a.source}</span>
              <span>置信度: {(a.confidence * 100).toFixed(0)}%</span>
              {a.createdAt && (
                <span>提交时间: {new Date(a.createdAt).toLocaleString("zh-CN")}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
