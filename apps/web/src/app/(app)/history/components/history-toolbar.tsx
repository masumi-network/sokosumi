"use client";

import type {
  HistoryStatus,
  HistoryType,
  ProjectFilterOption,
} from "@/app/history/utils/history-filters";

import { HistorySearch } from "./history-search";
import { HistoryViewFilters } from "./history-view-filters";

interface HistoryToolbarProps {
  activeOrganizationId: string | null;
  projectOptions: ProjectFilterOption[];
  resultsCountLabel: string;
  labels: {
    search: {
      placeholder: string;
      clear: string;
    };
    filters: {
      title: string;
      searchPlaceholder: string;
      emptyResults: string;
      all: string;
      scopeLabel: string;
      scopeOwned: string;
      scopeWorkspace: string;
      typeLabel: string;
      statusLabel: string;
      projectLabel: string;
      typeOptions: Record<HistoryType, string>;
      statusOptions: Record<HistoryStatus, string>;
    };
  };
}

export function HistoryToolbar({
  activeOrganizationId,
  projectOptions,
  resultsCountLabel,
  labels,
}: HistoryToolbarProps) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="hidden min-w-0 flex-1 md:block">
        <HistorySearch
          activeOrganizationId={activeOrganizationId}
          projectOptions={projectOptions}
          labels={labels.search}
        />
      </div>
      <p
        className="text-muted-foreground min-w-0 flex-1 truncate text-sm md:hidden"
        aria-live="polite"
      >
        {resultsCountLabel}
      </p>
      <div className="ml-auto shrink-0 md:ml-0">
        <HistoryViewFilters
          activeOrganizationId={activeOrganizationId}
          projectOptions={projectOptions}
          labels={labels.filters}
        />
      </div>
    </div>
  );
}
