"use server";

import {
  applyHistoryProjectAllowlist,
  type HistoryFilters,
  parseHistoryFilters,
} from "@/app/history/utils/history-filters";
import type { HistorySubtitleLookups } from "@/app/history/utils/history-row-subtitle";
import { buildHistorySubtitleLookups } from "@/app/history/utils/history-row-subtitle.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import {
  type HistoryItem,
  historyService,
} from "@/lib/services/history.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { HISTORY_PAGE_LIMIT } from "./constants";

interface LoadMoreHistoryParams extends AuthenticatedRequest {
  cursor: string | null;
  filters: HistoryFilters;
}

export const loadMoreHistory = withSession<
  LoadMoreHistoryParams,
  {
    history: HistoryItem[];
    nextCursor: string | null;
    subtitleLookups: HistorySubtitleLookups;
  }
>(async ({ cursor, filters, session }) => {
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const resolvedFilters = applyHistoryProjectAllowlist(
    parseHistoryFilters(
      {
        q: filters.q ?? undefined,
        scope: filters.scope,
        type: filters.type ?? undefined,
        status: filters.status ?? undefined,
        projectId: filters.projectId ?? undefined,
      },
      activeOrganizationId,
    ),
    await getProjectFilterOptions(filters.projectId),
  );
  const page = await historyService.listHistory({
    cursor,
    limit: HISTORY_PAGE_LIMIT,
    projectId: resolvedFilters.projectId ?? undefined,
    q: resolvedFilters.q ?? undefined,
    scope: resolvedFilters.scope,
    status: resolvedFilters.status ? [resolvedFilters.status] : undefined,
    types: resolvedFilters.type ? [resolvedFilters.type] : undefined,
  });
  const subtitleLookups = await buildHistorySubtitleLookups(page.history);

  return {
    history: page.history,
    nextCursor: page.pagination?.nextCursor ?? null,
    subtitleLookups,
  };
});
