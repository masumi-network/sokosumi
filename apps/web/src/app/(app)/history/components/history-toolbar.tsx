"use client";

import { useState } from "react";

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
  // Removing the Search chip or Clear all remounts the search box, which drops
  // its pending debounced write so typing cannot bring the search back.
  const [searchResets, setSearchResets] = useState(0);

  return (
    <div data-history-toolbar className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <p
          className="text-muted-foreground shrink-0 text-sm md:hidden"
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
        <HistorySearch
          key={searchResets}
          activeOrganizationId={activeOrganizationId}
          projectOptions={projectOptions}
          labels={labels.search}
        />
      </div>
      <HistoryActiveFilters
        onSearchReset={() => setSearchResets((count) => count + 1)}
        activeOrganizationId={activeOrganizationId}
        projectOptions={projectOptions}
        labels={labels.filters}
      />
    </div>
  );
}
