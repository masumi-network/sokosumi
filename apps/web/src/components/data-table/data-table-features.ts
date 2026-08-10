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
  sortFn_alphanumericCaseSensitive,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  sortFn_textCaseSensitive,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * Shared TanStack Table v9 features for app DataTables.
 * Bound via `createTableHook` in `create-data-table-hook.ts` —
 * use `createAppColumnHelper<TData>()` / `useAppTable` (not bare helpers).
 *
 * `sortFns` must include every built-in name that `sortFn: "auto"` can pick
 * (datetime / alphanumeric / text) plus basic. Case-sensitive variants are
 * registered so named column defs stay resolvable.
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
    alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
    textCaseSensitive: sortFn_textCaseSensitive,
  },
  filterFns: {
    includesString: filterFn_includesString,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;
