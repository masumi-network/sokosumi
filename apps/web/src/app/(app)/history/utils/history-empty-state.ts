import type { getTranslations } from "next-intl/server";

import {
  buildHistoryFiltersSearchParams,
  type HistoryFilters,
} from "@/app/history/utils/history-filters";

type HistoryTranslator = Awaited<
  ReturnType<typeof getTranslations<"App.TransactionHistory">>
>;

/**
 * A search or filter that matches nothing is not an empty ledger: say so, and
 * link back to the full list (scope kept) instead of offering a new Task. A
 * search is named in the title, because on phones the search box is collapsed
 * and the query is otherwise invisible.
 */
export function getHistoryEmptyState(
  t: HistoryTranslator,
  filters: HistoryFilters,
  activeOrganizationId: string | null,
) {
  if (!(filters.q || filters.type || filters.projectId || filters.taskId)) {
    return {
      labels: { title: t("Empty.title"), description: t("Empty.description") },
      clearFilters: null,
    };
  }
  const query = buildHistoryFiltersSearchParams(
    new URLSearchParams(),
    { ...filters, q: null, type: null, projectId: null, taskId: null },
    activeOrganizationId,
  ).toString();
  return {
    labels: filters.q
      ? {
          title: t("EmptyFiltered.searchTitle", { query: filters.q }),
          description: t("EmptyFiltered.searchDescription"),
        }
      : {
          title: t("EmptyFiltered.title"),
          description: t("EmptyFiltered.description"),
        },
    clearFilters: {
      href: query ? `/history?${query}` : "/history",
      label: t("EmptyFiltered.clear"),
    },
  };
}
