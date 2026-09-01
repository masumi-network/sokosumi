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
      <HistoryViewFilters
        activeOrganizationId={activeOrganizationId}
        projectOptions={projectOptions}
        labels={labels.filters}
      />
    </div>
  );
}
