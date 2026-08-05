import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/app/history/components/history-list";
import { HistoryToolbar } from "@/app/history/components/history-toolbar";
import { HISTORY_PAGE_LIMIT } from "@/app/history/constants";
import {
  applyHistoryProjectAllowlist,
  getHistoryFiltersResetKey,
  HISTORY_JOB_ONLY_STATUS_VALUES,
  parseHistoryFilters,
  resolveHistoryApiTypes,
} from "@/app/history/utils/history-filters";
import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { getSession } from "@/lib/auth/auth.server";
import { TaskStatus } from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { historyService } from "@/lib/services/history.service";

interface HistoryPageProps {
  searchParams: Promise<{
    q?: string | string[];
    scope?: string | string[];
    type?: string | string[];
    status?: string | string[];
    projectId?: string | string[];
  }>;
}

/**
 * Soft-nav: keep previous screen (no Instant shell / route spinner).
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.History.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  await connection();
  const [rawSearchParams, t, jobStatusT, session] = await Promise.all([
    searchParams,
    getTranslations("App.History"),
    getTranslations("Components.Jobs.StatusBadge"),
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
    status: filters.status ? [filters.status] : undefined,
    types: resolveHistoryApiTypes(filters.type),
  });
  const filterResetKey = getHistoryFiltersResetKey(
    filters,
    activeOrganizationId,
  );
  const jobStatusOptions = Object.fromEntries(
    HISTORY_JOB_ONLY_STATUS_VALUES.map((status) => [
      status,
      jobStatusT(getJobStatusBadgeLabelKey(status)),
    ]),
  ) as Record<(typeof HISTORY_JOB_ONLY_STATUS_VALUES)[number], string>;
  const taskStatusOptions: Record<TaskStatus, string> = {
    [TaskStatus.DRAFT]: t("Filters.statusOptions.DRAFT"),
    [TaskStatus.QUEUED]: t("Filters.statusOptions.QUEUED"),
    [TaskStatus.READY]: t("Filters.statusOptions.READY"),
    [TaskStatus.GRANT_PENDING]: t("Filters.statusOptions.GRANT_PENDING"),
    [TaskStatus.INPUT_REQUIRED]: t("Filters.statusOptions.INPUT_REQUIRED"),
    [TaskStatus.APPROVAL_REQUIRED]: t(
      "Filters.statusOptions.APPROVAL_REQUIRED",
    ),
    [TaskStatus.AUTHENTICATION_REQUIRED]: t(
      "Filters.statusOptions.AUTHENTICATION_REQUIRED",
    ),
    [TaskStatus.OUT_OF_CREDITS]: t("Filters.statusOptions.OUT_OF_CREDITS"),
    [TaskStatus.CREDITS_TOPPED_UP]: t(
      "Filters.statusOptions.CREDITS_TOPPED_UP",
    ),
    [TaskStatus.RUNNING]: t("Filters.statusOptions.RUNNING"),
    [TaskStatus.AWAITING_EXTERNAL]: t(
      "Filters.statusOptions.AWAITING_EXTERNAL",
    ),
    [TaskStatus.COMPLETED]: t("Filters.statusOptions.COMPLETED"),
    [TaskStatus.FAILED]: t("Filters.statusOptions.FAILED"),
    [TaskStatus.CANCELED]: t("Filters.statusOptions.CANCELED"),
  };

  return (
    <div className="w-full px-2">
      <div className="mx-auto flex w-full flex-col gap-6 pb-6">
        <HistoryToolbar
          activeOrganizationId={activeOrganizationId}
          projectOptions={projectOptions}
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
              statusLabel: t("Filters.statusLabel"),
              projectLabel: t("Filters.projectLabel"),
              typeOptions: {
                task: t("Filters.typeOptions.task"),
                job: t("Filters.typeOptions.job"),
              },
              statusOptions: {
                archived: t("Filters.statusOptions.archived"),
                ...taskStatusOptions,
                ...jobStatusOptions,
              },
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
              creditsUnavailable: t("Row.creditsUnavailable"),
              noDescription: t("Row.noDescription"),
              updated: t("Row.updated"),
              kind: {
                task: t("Row.kind.task"),
                job: t("Row.kind.job"),
              },
              taskStatus: taskStatusOptions,
            },
          }}
        />
      </div>
    </div>
  );
}
