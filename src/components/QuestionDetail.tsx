import { useState, useEffect } from "react";

const typeLabels: Record<string, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  text: "填空题",
};

type Answer = {
  id: number;
  values: string[];
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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {typeLabels[question.type] ?? question.type}
          </span>
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

      {question.options && question.options.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-muted-foreground">选项</h3>
          {question.options.map((opt) => {
            const isCorrect = correct.some((a) => (a.values as string[]).includes(opt.id));
            const isWrong = wrong.some((a) => (a.values as string[]).includes(opt.id));
            return (
              <div
                key={opt.id}
                className={`rounded border px-3 py-1.5 text-sm ${
                  isCorrect
                    ? "border-green-500 bg-green-50 dark:bg-green-950"
                    : isWrong
                      ? "border-red-500 bg-red-50 line-through dark:bg-red-950"
                      : "border-border"
                }`}
              >
                <span className="font-medium mr-2">{opt.id}.</span>
                {opt.text}
                {isCorrect && <span className="ml-2 text-green-600">✓ 正确</span>}
                {isWrong && <span className="ml-2 text-red-500">✗ 已排除</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">答案记录</h3>
        {answers.length === 0 && <p className="text-sm text-muted-foreground">暂无答案</p>}
        {answers.map((a) => (
          <div
            key={a.id}
            className={`rounded border px-3 py-2 text-sm ${a.isCorrect ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/50" : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/50"}`}
          >
            <div className="flex items-center gap-2">
              <span>{a.isCorrect ? "✓ 正确答案" : "✗ 错误答案"}</span>
              <span className="text-muted-foreground">{(a.values as string[]).join(", ")}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              来源: {a.source} · 置信度: {(a.confidence * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
