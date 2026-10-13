import { useState, type FormEvent } from "react";

export default function SearchBar() {
  const [query, setQuery] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // If it looks like a tid (numeric), navigate to task page
    if (/^\d+$/.test(q)) {
      window.location.href = `/tasks/${q}`;
      return;
    }

    // Otherwise, search
    window.location.href = `/search?q=${encodeURIComponent(q)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="输入题干关键词、课程号(cid)或题组号(tid)..."
        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        搜索
      </button>
    </form>
  );
}
