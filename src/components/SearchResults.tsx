import { useState, useEffect, type FormEvent } from "react";
import QuestionCard from "./QuestionCard";
import Pagination from "./Pagination";

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
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searched, setSearched] = useState(false);

  async function doSearch(q: string, targetPage: number = 1) {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setTotalPages(1);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(
        `/api/questions/search?q=${encodeURIComponent(q)}&page=${targetPage}&limit=10`,
      );
      const data = await res.json();
      setResults(data.results ?? []);
      setTotal(data.total ?? data.results?.length ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setPage(data.page ?? targetPage);
    } catch {
      setResults([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
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
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入题干关键词..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          搜索
        </button>
      </form>

      {loading && <p className="text-muted-foreground text-sm">搜索中...</p>}

      {!loading && searched && results.length === 0 && (
        <p className="text-muted-foreground text-sm">未找到匹配的题目</p>
      )}

      {!loading && results.length > 0 && (
        <div className="text-xs text-muted-foreground">
          找到 <strong className="text-foreground font-semibold">{total}</strong> 道相关题目
        </div>
      )}

      <div className="space-y-3">
        {results.map((q) => (
          <QuestionCard key={q.id} question={q} />
        ))}
      </div>

      {!loading && results.length > 0 && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          itemName="道题目"
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
