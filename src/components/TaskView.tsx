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

  const answered = questions.filter((q) => q.answers && q.answers.some((a) => a.isCorrect)).length;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          题组 {tid}
          {taskGroup?.name && (
            <span className="text-muted-foreground font-normal"> — {taskGroup.name}</span>
          )}
        </h1>
        {taskGroup && (
          <p className="text-sm text-muted-foreground">
            课程:{" "}
            <a href={`/courses/${taskGroup.cid}`} className="underline hover:text-foreground">
              {taskGroup.cid}
            </a>
            {" · "}共 {questions.length} 题{" · "}已有正确答案 {answered} 题
          </p>
        )}
      </div>
      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionCard key={q.id} question={q} />
        ))}
      </div>
    </div>
  );
}
