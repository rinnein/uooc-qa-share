import React from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  total?: number;
  itemName?: string;
  className?: string;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  itemName = "项",
  className = "",
}: PaginationProps) {
  if (totalPages <= 1 && (!total || total === 0)) {
    return null;
  }

  function getPageNumbers(): (number | string)[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (page <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }

    if (page >= totalPages - 3) {
      return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "...", page - 1, page, page + 1, "...", totalPages];
  }

  const pageNumbers = getPageNumbers();

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 py-4 text-xs sm:text-sm text-muted-foreground border-t ${className}`}
    >
      <div>
        {total != null && (
          <span>
            共 <strong className="text-foreground font-semibold">{total}</strong> {itemName}，
          </span>
        )}
        <span>
          第 <strong className="text-foreground font-semibold">{page}</strong> / {totalPages} 页
        </span>
      </div>

      <nav aria-label="分页导航" className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
          aria-label="上一页"
        >
          ‹ 上一页
        </button>

        {pageNumbers.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground select-none">
                …
              </span>
            );
          }

          const pageNum = p as number;
          const isActive = pageNum === page;

          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => onPageChange(pageNum)}
              aria-current={isActive ? "page" : undefined}
              className={`min-w-7 h-7 sm:min-w-8 sm:h-8 rounded-md border text-xs font-medium transition-colors flex items-center justify-center ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground hover:bg-accent"
              }`}
            >
              {pageNum}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
          aria-label="下一页"
        >
          下一页 ›
        </button>
      </nav>
    </div>
  );
}
