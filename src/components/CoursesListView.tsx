import { useState, useEffect, useMemo } from "react";

type TaskGroupItem = {
  tid: string;
  cid: string;
  name: string | null;
  questionCount: number;
  answeredCount: number;
};

type CourseItem = {
  cid: string;
  name: string | null;
  updatedAt: string;
  taskGroups: TaskGroupItem[];
  taskGroupCount: number;
  totalQuestions: number;
  totalAnswered: number;
};

export default function CoursesListView() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setCourses(data.courses ?? []);
        }
      })
      .catch(() => setError("加载课程列表失败"))
      .finally(() => setLoading(false));
  }, []);

  const filteredCourses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => {
      const matchCid = c.cid.toLowerCase().includes(q);
      const matchName = c.name?.toLowerCase().includes(q) ?? false;
      const matchTask = c.taskGroups.some(
        (t) => t.tid.toLowerCase().includes(q) || (t.name?.toLowerCase().includes(q) ?? false),
      );
      return matchCid || matchName || matchTask;
    });
  }, [courses, searchQuery]);

  const totalStats = useMemo(() => {
    const totalCourses = courses.length;
    const totalGroups = courses.reduce((acc, c) => acc + c.taskGroupCount, 0);
    const totalQuestions = courses.reduce((acc, c) => acc + c.totalQuestions, 0);
    const totalAnswered = courses.reduce((acc, c) => acc + c.totalAnswered, 0);
    return { totalCourses, totalGroups, totalQuestions, totalAnswered };
  }, [courses]);

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p>正在加载课程题单列表...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">课程题单目录</h1>
          <p className="text-sm text-muted-foreground mt-1">按课程浏览测验题组、作业与已收录题单</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-medium">
            共 {totalStats.totalCourses} 门课程
          </span>
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-medium">
            {totalStats.totalGroups} 个题单
          </span>
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-medium">
            {totalStats.totalQuestions} 道试题
          </span>
        </div>
      </div>

      {/* 搜索过滤框 */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索课程名称、课程 ID (cid) 或测验题单名称..."
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        )}
      </div>

      {/* 课程列表 */}
      {filteredCourses.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
          <div className="text-3xl">📚</div>
          <p className="text-base font-medium text-foreground">
            {searchQuery ? "未找到符合搜索条件的课程或题单" : "暂无课程数据"}
          </p>
          <p className="text-xs text-muted-foreground">
            {searchQuery
              ? "尝试更换关键词，或者搜索课程 cid 编号"
              : "您可以通过上传页面批量导入试卷数据"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCourses.map((c) => (
            <div
              key={c.cid}
              className="rounded-xl border bg-card transition-all hover:border-primary/40 shadow-sm"
            >
              {/* 课程头部卡片 */}
              <div className="p-4 sm:p-5 border-b bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                      {c.name || `课程 ${c.cid}`}
                    </h2>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border">
                      cid: {c.cid}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    包含 {c.taskGroupCount} 个测验题单 · 共 {c.totalQuestions} 题 · 已收录正确答案{" "}
                    {c.totalAnswered} 题
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/courses/${c.cid}`}
                    className="inline-flex items-center justify-center text-xs font-medium rounded-md border px-3 py-1.5 hover:bg-accent transition-colors"
                  >
                    课程主页 →
                  </a>
                </div>
              </div>

              {/* 课程下的题单列表 */}
              <div className="p-4 sm:p-5">
                {c.taskGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">该课程下暂未收录具体题单</p>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {c.taskGroups.map((g) => (
                      <a
                        key={g.tid}
                        href={`/tasks/${g.tid}`}
                        className="group flex flex-col justify-between rounded-lg border p-3 hover:bg-accent/40 hover:border-primary/30 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1">
                              {g.name || `题组 ${g.tid}`}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                              tid: {g.tid}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span>共 {g.questionCount} 题</span>
                          <span
                            className={
                              g.answeredCount > 0 ? "text-green-600 dark:text-green-400" : ""
                            }
                          >
                            已录答案 {g.answeredCount} 题
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
