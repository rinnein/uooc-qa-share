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
  values: string[];
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

export default function QuestionCard({ question }: { question: Question }) {
  const q = question;
  const correctAnswers = q.answers?.filter((a) => a.isCorrect) ?? [];
  const wrongAnswers = q.answers?.filter((a) => !a.isCorrect) ?? [];

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
          {q.options.map((opt) => (
            <span
              key={opt.id}
              className={`rounded border px-1.5 py-0.5 ${
                correctAnswers.some((a) => (a.values as string[]).includes(opt.id))
                  ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : wrongAnswers.some((a) => (a.values as string[]).includes(opt.id))
                    ? "border-red-500 bg-red-50 text-red-700 line-through dark:bg-red-950 dark:text-red-300"
                    : "border-border"
              }`}
            >
              {opt.id}. {opt.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        {correctAnswers.length > 0 && (
          <span className="text-green-600 dark:text-green-400">
            ✓ 正确答案: {correctAnswers.map((a) => (a.values as string[]).join(", ")).join(" | ")}
          </span>
        )}
        {wrongAnswers.length > 0 && (
          <span className="text-red-500 dark:text-red-400">
            ✗ 排除: {wrongAnswers.map((a) => (a.values as string[]).join(", ")).join(", ")}
          </span>
        )}
        {correctAnswers.length === 0 && wrongAnswers.length === 0 && (
          <span className="text-muted-foreground">暂无答案</span>
        )}
      </div>
    </a>
  );
}
