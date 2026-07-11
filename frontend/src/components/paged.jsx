import { useMemo, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export function usePagedSearch(items, keys, perPage = 10) {
  const [query, setQueryRaw] = useState("");
  const [page, setPage] = useState(1);
  const keyStr = keys.join("|");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => keyStr.split("|").some((k) => String(it[k] || "").toLowerCase().includes(q)));
  }, [items, query, keyStr]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const setQuery = (v) => { setQueryRaw(v); setPage(1); };
  return { query, setQuery, page: safePage, setPage, pageItems, totalPages, total: filtered.length };
}

export const SearchBox = ({ value, onChange, placeholder, testId }) => (
  <div className="relative">
    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "Cari..."}
      className="pl-10 h-10 rounded-xl bg-white w-48 sm:w-56"
      data-testid={testId}
    />
  </div>
);

export const Pager = ({ page, totalPages, setPage, total, testId }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100" data-testid={testId}>
      <span className="text-xs text-slate-400 font-semibold">{total} data — Hal. {page} dari {totalPages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="rounded-lg h-8 w-8 p-0" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid={testId ? `${testId}-prev` : undefined}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setPage(page + 1)} data-testid={testId ? `${testId}-next` : undefined}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
