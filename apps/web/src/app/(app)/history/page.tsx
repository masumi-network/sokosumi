import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/app/history/components/history-list";
import { HistorySpendChart } from "@/app/history/components/history-spend-chart";
import { HistoryToolbar } from "@/app/history/components/history-toolbar";
import { HISTORY_PAGE_LIMIT } from "@/app/history/constants";
import {
  applyHistoryProjectAllowlist,
  buildHistoryFiltersSearchParams,
  getHistoryFiltersResetKey,
  parseHistoryFilters,
  resolveHistoryApiTypes,
} from "@/app/history/utils/history-filters";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { historyService } from "@/lib/services/history.service";
import { taskService } from "@/lib/services/task.service";

interface HistoryPageProps {
  searchParams: Promise<{
    q?: string | string[];
    scope?: string | string[];
    type?: string | string[];
    projectId?: string | string[];
    taskId?: string | string[];
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
 * Transactions: every credit consumption on the account, newest first.
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
  const listParams = {
    projectId: filters.projectId ?? undefined,
    q: filters.q ?? undefined,
    scope: filters.scope,
    taskId: filters.taskId ?? undefined,
    types: resolveHistoryApiTypes(filters.type),
  };
  const [historyPage, dailySpend, filteredTask] = await Promise.all([
    historyService.listHistory({ limit: HISTORY_PAGE_LIMIT, ...listParams }),
    historyService.listDailySpend(listParams),
    filters.taskId
      ? taskService.getTaskById(filters.taskId).catch(() => null)
      : null,
  ]);
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
    contacts: t("Row.kind.contacts"),
    topUp: t("Row.kind.topUp"),
    unattributed: t("Row.kind.unattributed"),
  };

  return (
    <div className="content-in w-full">
      <div className="mx-auto flex w-full flex-col gap-6 pb-6">
        <HistoryToolbar
          activeOrganizationId={activeOrganizationId}
          filters={filters}
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

        {filters.taskId ? (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <p className="text-muted-foreground min-w-0 truncate">
              {t("TaskFilter.label", {
                task: filteredTask?.name ?? t("TaskFilter.unknownTask"),
              })}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/history?${buildHistoryFiltersSearchParams(
                  new URLSearchParams(),
                  { ...filters, taskId: null },
                  activeOrganizationId,
                ).toString()}`}
              >
                <X aria-hidden />
                {t("TaskFilter.clear")}
              </Link>
            </Button>
          </div>
        ) : null}

        <HistorySpendChart days={dailySpend} />

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
