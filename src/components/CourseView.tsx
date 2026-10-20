import { useState, useEffect } from "react";

type TaskGroup = {
  tid: string;
  cid: string;
  name: string | null;
  questionCount?: number;
  answeredCount?: number;
  excludedCount?: number;
};
type Course = { cid: string; name: string | null };

export default function CourseView({ cid }: { cid: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/courses/${cid}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setCourse(data.course);
          setGroups(data.taskGroups ?? []);
        }
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false));
  }, [cid]);

  if (loading) return <p className="text-muted-foreground">加载中...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  return (
    <div className="space-y-4">
      <div>
        <a
          href="/courses"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          ← 返回课程题单列表
        </a>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">
            课程 {cid}
            {course?.name && (
              <span className="text-muted-foreground font-normal"> — {course.name}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">共 {groups.length} 个题组</p>
        </div>
      </div>
      <div className="space-y-2">
        {groups.map((g) => (
          <a
            key={g.tid}
            href={`/tasks/${g.tid}`}
            className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
          >
            <div>
              <span className="font-medium">题组 {g.tid}</span>
              {g.name && <span className="ml-2 text-muted-foreground">{g.name}</span>}
            </div>
            {typeof g.questionCount === "number" && (
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>共 {g.questionCount} 题</span>
                {typeof g.answeredCount === "number" && g.answeredCount > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    已录答案 {g.answeredCount} 题
                  </span>
                )}
                {typeof g.excludedCount === "number" && g.excludedCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    已排除错误 {g.excludedCount} 题
                  </span>
                )}
              </div>
            )}
          </a>
        ))}
        {groups.length === 0 && <p className="text-muted-foreground text-sm">该课程暂无题组数据</p>}
      </div>
    </div>
  );
}
