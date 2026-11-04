import { useState, useEffect, type FormEvent } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import QuestionCard from "./QuestionCard";
import Pagination from "./Pagination";
import EnhancedSearchModal from "./EnhancedSearchModal";
import {
  getEnhancedSearchEnabled,
  computeTextEmbedding,
  checkModelCached,
} from "@/lib/client-embedding";

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

type Answer = {
  id: number;
  values: string[];
  isCorrect: boolean;
  source: string;
  confidence: number;
};

interface SearchResultsProps {
  initialQuery: string;
  initialPage?: number;
}

export default function SearchResults({ initialQuery, initialPage = 1 }: SearchResultsProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string>("搜索中...");
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<"all" | "correct" | "excluded" | "unanswered">("all");

  // Enhanced search modal and state
  const [modalOpen, setModalOpen] = useState(false);
  const [enhancedEnabled, setEnhancedEnabled] = useState(false);
  const [usedVectorSearch, setUsedVectorSearch] = useState(false);

  useEffect(() => {
    const enabled = getEnhancedSearchEnabled();
    setEnhancedEnabled(enabled);

    // If enabled, verify cache availability
    if (enabled) {
      void checkModelCached();
    }
  }, []);

  async function doSearch(q: string, targetPage: number = 1) {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setTotalPages(1);
      setSearched(false);
      setUsedVectorSearch(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    let isVector = false;

    try {
      let embedding: number[] | undefined;

      if (enhancedEnabled) {
        try {
          setStatusText("正在提取语义特征 (ONNX 本地向量计算)...");
          const vec = await computeTextEmbedding(q);
          if (vec && vec.length === 512) {
            embedding = vec;
            isVector = true;
          }
        } catch (embErr) {
          console.warn("客户端向量计算失败，降级为普通关键词搜索:", embErr);
        }
      }

      setStatusText("正在检索匹配题目...");

      let data: any;
      if (embedding && embedding.length === 512) {
        const res = await fetch("/api/questions/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q,
            embedding,
            page: targetPage,
            limit: 10,
          }),
        });
        data = await res.json();
      } else {
        const res = await fetch(
          `/api/questions/search?q=${encodeURIComponent(q)}&page=${targetPage}&limit=10`,
        );
        data = await res.json();
      }

      setResults(data.results ?? []);
      setTotal(data.total ?? data.results?.length ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setPage(data.page ?? targetPage);
      setUsedVectorSearch(isVector);
    } catch (err) {
      console.error("Search request error:", err);
      setResults([]);
      setTotal(0);
      setTotalPages(1);
      setUsedVectorSearch(false);
    } finally {
      setLoading(false);
      setStatusText("搜索中...");
    }
  }

  useEffect(() => {
    if (initialQuery) {
      void doSearch(initialQuery, initialPage);
    }
  }, []);

  function updateUrl(q: string, p: number) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");

    if (p > 1) url.searchParams.set("page", String(p));
    else url.searchParams.delete("page");

    window.history.pushState(null, "", url.toString());
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateUrl(query, 1);
    void doSearch(query, 1);
  }

  function handlePageChange(newPage: number) {
    updateUrl(query, newPage);
    void doSearch(query, newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-4">
      {/* Search Input & Controls */}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              enhancedEnabled ? "输入题目描述或语义关键词 (增强模式开启)..." : "输入题干关键词..."
            }
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
          >
            {loading ? "搜索中" : "搜索"}
          </button>
        </div>

        {/* Enhanced Search Button */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border transition-all shrink-0 ${
            enhancedEnabled
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 shadow-xs"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          title={
            enhancedEnabled
              ? "增强向量搜索已开启，点击进行管理或停用"
              : "点击下载本地模型并开启增强向量搜索"
          }
        >
          <Sparkles className="w-4 h-4 shrink-0 text-amber-500" />
          <span>增强搜索</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold transition-colors ${
              enhancedEnabled
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {enhancedEnabled ? "已开启" : "未开启"}
          </span>
        </button>
      </form>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{statusText}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && searched && results.length === 0 && (
        <p className="text-muted-foreground text-sm">未找到匹配的题目</p>
      )}

      {/* Results Header & Filters */}
      {!loading && results.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>
              找到 <strong className="text-foreground font-semibold">{total}</strong> 道相关题目
            </span>
            {usedVectorSearch && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-[11px]">
                <Sparkles className="w-3 h-3 text-amber-500" />
                向量语义检索
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-muted/40 text-muted-foreground hover:bg-accent"
              }`}
            >
              全部 ({results.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("correct")}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                filter === "correct"
                  ? "bg-green-600 text-white"
                  : "border border-green-200 text-green-700 bg-green-50/50 dark:border-green-800 dark:text-green-300 dark:bg-green-950/40 hover:bg-green-100"
              }`}
            >
              ✓ 有正确答案 ({results.filter((q) => q.answers?.some((a) => a.isCorrect)).length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("excluded")}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                filter === "excluded"
                  ? "bg-amber-600 text-white"
                  : "border border-amber-200 text-amber-700 bg-amber-50/50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40 hover:bg-amber-100"
              }`}
            >
              ✗ 含已排除错误 ({results.filter((q) => q.answers?.some((a) => !a.isCorrect)).length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("unanswered")}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                filter === "unanswered"
                  ? "bg-foreground text-background"
                  : "border bg-muted/40 text-muted-foreground hover:bg-accent"
              }`}
            >
              未录入 ({results.filter((q) => !q.answers || q.answers.length === 0).length})
            </button>
          </div>
        </div>
      )}

      {/* Question Cards List */}
      <div className="space-y-3">
        {results
          .filter((q) => {
            if (filter === "correct") return q.answers?.some((a) => a.isCorrect);
            if (filter === "excluded") return q.answers?.some((a) => !a.isCorrect);
            if (filter === "unanswered") return !q.answers || q.answers.length === 0;
            return true;
          })
          .map((q) => (
            <QuestionCard key={q.id} question={q} />
          ))}
      </div>

      {/* Pagination */}
      {!loading && results.length > 0 && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          itemName="道题目"
          onPageChange={handlePageChange}
        />
      )}

      {/* Enhanced Search Management Modal */}
      <EnhancedSearchModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        enabled={enhancedEnabled}
        onEnabledChange={setEnhancedEnabled}
      />
    </div>
  );
}
