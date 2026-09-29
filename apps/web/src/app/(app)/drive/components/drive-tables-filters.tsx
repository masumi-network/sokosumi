"use client";

import { Archive } from "lucide-react";
import { useMemo } from "react";
import { DRIVE_HEADER_CONTROL_CLASS } from "@/app/drive/components/drive-view-layout";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";

/**
 * The Tables tab's archived filter.
 *
 * It used to be a ghost toggle button inside the list component, which both
 * owned the state and flipped its own label between "Show archived" and
 * "Show active" — so the control never told you which set you were looking
 * at, only what pressing it would do. This is the same `FilterDropdownMenu`
 * the Tasks view's filters use, so it sits in the page's filter row at the
 * same size and weight as its neighbours, carries the active-filter dot when
 * archived tables are showing, and gets the mobile sheet for free.
 */
export interface DriveTablesFilterLabels {
  title: string;
  searchPlaceholder: string;
  emptyResults: string;
  statusLabel: string;
  active: string;
  archived: string;
}

interface DriveTablesFiltersProps {
  archived: boolean;
  onArchivedChange: (archived: boolean) => void;
  labels: DriveTablesFilterLabels;
}

export function DriveTablesFilters({
  archived,
  onArchivedChange,
  labels,
}: DriveTablesFiltersProps) {
  const sections = useMemo<FilterDropdownMenuSection[]>(
    () => [
      {
        id: "status",
        label: labels.statusLabel,
        icon: Archive,
        // Both states are named options rather than one `allLabel` default:
        // "active" and "archived" are disjoint sets here, not a subset of an
        // "all" that this list can show.
        value: archived ? "archived" : "active",
        onChange: (value) => onArchivedChange(value === "archived"),
        options: [
          { value: "active", label: labels.active },
          { value: "archived", label: labels.archived },
        ],
      },
    ],
    [
      archived,
      onArchivedChange,
      labels.statusLabel,
      labels.active,
      labels.archived,
    ],
  );

  return (
    <FilterDropdownMenu
      buttonLabel={labels.title}
      searchPlaceholder={labels.searchPlaceholder}
      emptyResultsLabel={labels.emptyResults}
      sections={sections}
      showActiveIndicator={archived}
      // `size="sm"` is `h-8` at every width. This row's other control,
      // `New table`, is 40px while the row is stacked, so without this the
      // two sit side by side 8px apart in height and 4px out of alignment.
      triggerClassName={DRIVE_HEADER_CONTROL_CLASS}
    />
  );
}
