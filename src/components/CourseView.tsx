import { useState, useEffect } from "react";

type TaskGroup = { tid: string; cid: string; name: string | null };
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
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          课程 {cid}
          {course?.name && (
            <span className="text-muted-foreground font-normal"> — {course.name}</span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">共 {groups.length} 个题组</p>
      </div>
      <div className="space-y-2">
        {groups.map((g) => (
          <a
            key={g.tid}
            href={`/tasks/${g.tid}`}
            className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
          >
            <span className="font-medium">题组 {g.tid}</span>
            {g.name && <span className="ml-2 text-muted-foreground">{g.name}</span>}
          </a>
        ))}
        {groups.length === 0 && <p className="text-muted-foreground text-sm">该课程暂无题组数据</p>}
      </div>
    </div>
  );
}
