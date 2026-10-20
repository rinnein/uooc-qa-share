import { useState, useEffect } from "react";
import QuestionCard from "./QuestionCard";

type Question = {
  id: number;
  tid: string;
  questionId: string | null;
  type: string;
  stem: string | null;
  options: { id: string; text: string }[] | null;
  answers?: {
    id: number;
    values: string[];
    isCorrect: boolean;
    source: string;
    confidence: number;
  }[];
};

type TaskGroup = { tid: string; cid: string; name: string | null };

export default function TaskView({ tid }: { tid: string }) {
  const [taskGroup, setTaskGroup] = useState<TaskGroup | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "correct" | "excluded" | "unanswered">("all");

  useEffect(() => {
    fetch(`/api/tasks/${tid}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setTaskGroup(data.taskGroup);
          setQuestions(data.questions ?? []);
        }
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false));
  }, [tid]);

  if (loading) return <p className="text-muted-foreground">加载中...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  const answeredCount = questions.filter(
    (q) => q.answers && q.answers.some((a) => a.isCorrect),
  ).length;

  const excludedOnlyCount = questions.filter(
    (q) => q.answers && !q.answers.some((a) => a.isCorrect) && q.answers.some((a) => !a.isCorrect),
  ).length;

  const unansweredCount = questions.length - answeredCount - excludedOnlyCount;

  const filteredQuestions = questions.filter((q) => {
    if (filter === "correct") {
      return q.answers && q.answers.some((a) => a.isCorrect);
    }
    if (filter === "excluded") {
      return (
        q.answers && !q.answers.some((a) => a.isCorrect) && q.answers.some((a) => !a.isCorrect)
      );
    }
    if (filter === "unanswered") {
      return !q.answers || q.answers.length === 0;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          题组 {tid}
          {taskGroup?.name && (
            <span className="text-muted-foreground font-normal"> — {taskGroup.name}</span>
          )}
        </h1>
        {taskGroup && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>
              课程:{" "}
              <a href={`/courses/${taskGroup.cid}`} className="underline hover:text-foreground">
                {taskGroup.cid}
              </a>
            </span>
            <span>·</span>
            <span>共 {questions.length} 题</span>
            <span>·</span>
            <span className="text-green-600 dark:text-green-400 font-medium">
              已有正确答案 {answeredCount} 题
            </span>
            {excludedOnlyCount > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  仅有已排除答案 {excludedOnlyCount} 题
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 快捷状态筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "border bg-muted/40 text-muted-foreground hover:bg-accent"
          }`}
        >
          全部 ({questions.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("correct")}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filter === "correct"
              ? "bg-green-600 text-white"
              : "border border-green-200 text-green-700 bg-green-50/50 dark:border-green-800 dark:text-green-300 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-900/40"
          }`}
        >
          ✓ 已确认正确答案 ({answeredCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("excluded")}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filter === "excluded"
              ? "bg-amber-600 text-white"
              : "border border-amber-200 text-amber-700 bg-amber-50/50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          }`}
        >
          ✗ 仅有已排除答案 ({excludedOnlyCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("unanswered")}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            filter === "unanswered"
              ? "bg-foreground text-background"
              : "border bg-muted/40 text-muted-foreground hover:bg-accent"
          }`}
        >
          未解答 ({unansweredCount})
        </button>
      </div>

      {filteredQuestions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          当前分类下暂无试题
        </div>
      ) : (
        <div className="space-y-3">
          {filteredQuestions.map((q) => (
            <QuestionCard key={q.id} question={q} />
          ))}
        </div>
      )}
    </div>
  );
}
