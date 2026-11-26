"use client";

import { createContext, type ReactNode, useContext } from "react";
import { usePageListSearchHits } from "@/hooks/effects/use-page-list-search-hits";
import { usePageSearchAutoLoadMore } from "@/hooks/effects/use-page-search-auto-load-more";
import { usePageSearchPartialMarker } from "@/hooks/effects/use-page-search-partial-marker";
import { rankPageItems } from "@/lib/utils/page-search";

export const PageListSearchContext = createContext<{
  query: string;
  /** A deep link can open the page with a search already filled in. */
  setQuery?: (value: string) => void;
  register: (hits: number, hasMore: boolean) => () => void;
} | null>(null);

export function usePageSearchQuery() {
  return useContext(PageListSearchContext)?.query.trim() ?? "";
}

/** Lists under one dashboard share its field. Outside the page they keep their normal contents. */
export function usePageListSearch<T>(
  items: readonly T[],
  fieldsFor: Parameters<typeof rankPageItems<T>>[2],
) {
  const context = useContext(PageListSearchContext);
  const query = context?.query.trim();
  const register = context?.register;
  const visible = query ? rankPageItems(items, query, fieldsFor) : items;
  usePageListSearchHits(register, visible.length);
  return visible;
}

// Server components supply rendered rows so their translations and actions stay on the server.
export function PageSearchRows({
  rows,
}: {
  rows: {
    primary: (string | null | undefined)[];
    secondary?: (string | null | undefined)[];
    content: ReactNode;
  }[];
}) {
  return usePageListSearch(rows, (row) => row).map((row) => row.content);
}

/** Reuse the list's existing pager while a query is active. Retry failures through its normal button. */
export function usePageSearchPagination(
  cursor: string | null | undefined,
  busy: boolean,
  loadMore: () => unknown,
) {
  const context = useContext(PageListSearchContext);
  const searching = Boolean(context?.query.trim());
  const register = context?.register;
  const partial = Boolean(cursor);
  usePageSearchPartialMarker(register, partial);
  usePageSearchAutoLoadMore(searching, cursor, busy, loadMore);
}
