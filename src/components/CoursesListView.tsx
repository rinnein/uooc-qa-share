import { useState, useEffect, useRef } from "react";
import Pagination from "./Pagination";

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

interface CoursesListViewProps {
  initialQuery?: string;
  initialPage?: number;
}

export default function CoursesListView({
  initialQuery = "",
  initialPage = 1,
}: CoursesListViewProps) {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [globalStats, setGlobalStats] = useState({
    allCoursesCount: 0,
    allTaskGroupsCount: 0,
    allQuestionsCount: 0,
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateUrl(q: string, p: number) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");

    if (p > 1) url.searchParams.set("page", String(p));
    else url.searchParams.delete("page");

    window.history.pushState(null, "", url.toString());
  }

  function fetchCourses(q: string, targetPage: number) {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("page", String(targetPage));
    params.set("pageSize", "10");

    fetch(`/api/courses?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setCourses(data.courses ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
          setPage(data.page ?? targetPage);
          if (data.allCoursesCount != null) {
            setGlobalStats({
              allCoursesCount: data.allCoursesCount,
              allTaskGroupsCount: data.allTaskGroupsCount ?? 0,
              allQuestionsCount: data.allQuestionsCount ?? 0,
            });
          }
        }
      })
      .catch(() => setError("加载课程列表失败"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchCourses(initialQuery, initialPage);
  }, []);

  function handleSearchChange(val: string) {
    setSearchQuery(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      updateUrl(val, 1);
      fetchCourses(val, 1);
    }, 300);
  }

  function handleClear() {
    setSearchQuery("");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    updateUrl("", 1);
    fetchCourses("", 1);
  }

  function handlePageChange(newPage: number) {
    updateUrl(searchQuery, newPage);
    fetchCourses(searchQuery, newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
            共 {globalStats.allCoursesCount || total} 门课程
          </span>
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-medium">
            {globalStats.allTaskGroupsCount} 个题单
          </span>
          <span className="rounded-full border bg-muted/40 px-3 py-1 font-medium">
            {globalStats.allQuestionsCount} 道试题
          </span>
        </div>
      </div>

      {/* 搜索过滤框 */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="搜索课程名称、课程 ID (cid) 或测验题单名称..."
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        )}
      </div>

      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          <p>正在加载课程题单列表...</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          <p>{error}</p>
        </div>
      )}

      {/* 课程列表 */}
      {!loading && !error && courses.length === 0 ? (
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
        !loading &&
        !error && (
          <div className="space-y-4">
            {courses.map((c) => (
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

            {/* 分页组件 */}
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                itemName="门课程"
                onPageChange={handlePageChange}
              />
            )}
          </div>
        )
      )}
    </div>
  );
}
