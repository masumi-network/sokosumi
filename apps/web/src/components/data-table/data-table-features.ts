import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * Shared TanStack Table v9 features for app DataTables.
 * Column helpers must use `createColumnHelper<DataTableFeatures, TData>()`.
 */
export const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  columnVisibilityFeature,
  columnFilteringFeature,
  rowSortingFeature,
  rowSelectionFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  filterFns: {
    includesString: filterFn_includesString,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;
