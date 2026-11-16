"use client";

import type {
  HistoryFilters,
  HistoryType,
  ProjectFilterOption,
} from "@/app/history/utils/history-filters";

import { HistoryExportMenu } from "./history-export-menu";
import { HistorySearch } from "./history-search";
import {
  HistoryActiveFilters,
  HistoryViewFilters,
} from "./history-view-filters";

interface HistoryToolbarProps {
  activeOrganizationId: string | null;
  filters: HistoryFilters;
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
      projectLabel: string;
      typeOptions: Record<HistoryType, string>;
    };
  };
}

export function HistoryToolbar({
  activeOrganizationId,
  filters,
  projectOptions,
  resultsCountLabel,
  labels,
}: HistoryToolbarProps) {
  return (
    <div data-history-toolbar className="flex flex-col gap-3">
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
        <div
          data-history-filters
          className="ml-auto flex shrink-0 items-center gap-2 md:ml-0"
        >
          <HistoryExportMenu filters={filters} />
          <HistoryViewFilters
            activeOrganizationId={activeOrganizationId}
            projectOptions={projectOptions}
            labels={labels.filters}
          />
        </div>
      </div>
      <HistoryActiveFilters
        activeOrganizationId={activeOrganizationId}
        projectOptions={projectOptions}
        labels={labels.filters}
      />
    </div>
  );
}
