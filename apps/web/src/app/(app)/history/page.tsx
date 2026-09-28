import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/app/history/components/history-list";
import { HistoryToolbar } from "@/app/history/components/history-toolbar";
import { HISTORY_PAGE_LIMIT } from "@/app/history/constants";
import {
  applyHistoryProjectAllowlist,
  getHistoryFiltersResetKey,
  parseHistoryFilters,
  resolveHistoryApiTypes,
} from "@/app/history/utils/history-filters";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { historyService } from "@/lib/services/history.service";

interface HistoryPageProps {
  searchParams: Promise<{
    q?: string | string[];
    scope?: string | string[];
    type?: string | string[];
    projectId?: string | string[];
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.TransactionHistory.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Transaction History: every credit consumption on the account, newest first.
 *
 * Instant Nav uses `history/loading.tsx` while this page streams after
 * `connection()`.
 */
export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  await connection();
  const [rawSearchParams, t, session] = await Promise.all([
    searchParams,
    getTranslations("App.TransactionHistory"),
    getSession(),
  ]);
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const parsedFilters = parseHistoryFilters(
    rawSearchParams,
    activeOrganizationId,
  );
  const projectOptions = await getProjectFilterOptions(parsedFilters.projectId);
  const filters = applyHistoryProjectAllowlist(parsedFilters, projectOptions);
  const historyPage = await historyService.listHistory({
    limit: HISTORY_PAGE_LIMIT,
    projectId: filters.projectId ?? undefined,
    q: filters.q ?? undefined,
    scope: filters.scope,
    types: resolveHistoryApiTypes(filters.type),
  });
  const filterResetKey = getHistoryFiltersResetKey(
    filters,
    activeOrganizationId,
  );

  const historyTotal =
    historyPage.pagination?.total ?? historyPage.history.length;
  const resultsCountLabel = t("ResultsCount.resultsCount", {
    count: historyTotal,
  });
  const kindLabels = {
    job: t("Row.kind.job"),
    image: t("Row.kind.image"),
    task: t("Row.kind.task"),
    coworker: t("Row.kind.coworker"),
    sokoBot: t("Row.kind.sokoBot"),
    topUp: t("Row.kind.topUp"),
    unattributed: t("Row.kind.unattributed"),
  };

  return (
    <div className="content-in w-full">
      <div className="mx-auto flex w-full flex-col gap-6 pb-6">
        <HistoryToolbar
          activeOrganizationId={activeOrganizationId}
          projectOptions={projectOptions}
          resultsCountLabel={resultsCountLabel}
          labels={{
            search: {
              placeholder: t("Search.placeholder"),
              clear: t("Search.clear"),
            },
            filters: {
              title: t("Filters.title"),
              searchPlaceholder: t("Filters.searchPlaceholder"),
              emptyResults: t("Filters.emptyResults"),
              all: t("Filters.all"),
              scopeLabel: t("Filters.scopeLabel"),
              scopeOwned: t("Filters.scopeOwned"),
              scopeWorkspace: t("Filters.scopeWorkspace"),
              typeLabel: t("Filters.typeLabel"),
              projectLabel: t("Filters.projectLabel"),
              typeOptions: kindLabels,
            },
          }}
        />

        <HistoryList
          key={filterResetKey}
          history={historyPage.history}
          nextCursor={historyPage.pagination?.nextCursor ?? null}
          filterResetKey={filterResetKey}
          filters={filters}
          activeOrganizationId={activeOrganizationId}
          labels={{
            empty: {
              title: t("Empty.title"),
              description: t("Empty.description"),
            },
            loadMore: t("List.loadMore"),
            loading: t("List.loading"),
            loadMoreError: t("List.loadMoreError"),
            row: {
              credit: t("Row.credit"),
              credits: t("Row.credits"),
              noDescription: t("Row.noDescription"),
              consumed: t("Row.consumed"),
              kind: kindLabels,
            },
          }}
        />
      </div>
    </div>
  );
}
