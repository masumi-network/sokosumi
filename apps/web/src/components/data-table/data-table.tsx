"use client";
"use no memo";

import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  flexRender,
  type OnChangeFn,
  type ReactTable,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useAppTable } from "./create-data-table-hook";
import type { DataTableFeatures } from "./data-table-features";
import DataTablePagination from "./data-table-pagination";

function getMinTableWidth<TData extends RowData>(
  table: ReactTable<DataTableFeatures, TData>,
) {
  return table.getVisibleLeafColumns().reduce((total, column) => {
    const minSize = column.columnDef.minSize ?? 0;
    return total + Math.max(column.getSize(), minSize);
  }, 0);
}

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData, unknown>[];
  data: TData[];
  containerClassName?: string | undefined;
  tableClassName?: string | undefined;
  tableHeaderClassName?: string | undefined;
  tableBodyClassName?: string | undefined;
  showPagination?: boolean | undefined;
  enableRowSelection?: boolean | undefined;
  disableHover?: boolean | undefined;
  showRowsPerPage?: boolean | undefined;
  initialPageSize?: number | undefined;
  defaultSort?: { id: string; desc: boolean }[];
  manualSorting?: boolean | undefined;
  sorting?: SortingState | undefined;
  onSortingChange?: OnChangeFn<SortingState> | undefined;
  onRowClick?: (row: TData) => () => void | Promise<void>;
  rowClassName?: (row: TData) => string | undefined;
  // Optional grouping support: render headers inside tbody before first row of each group
  getGroupKey?: (row: TData) => string | null | undefined;
  renderGroupHeader?: (groupKey: string) => React.ReactNode;
}

export default function DataTable<TData extends RowData>({
  columns,
  data,
  containerClassName,
  tableClassName,
  tableHeaderClassName,
  tableBodyClassName,
  showPagination,
  enableRowSelection = true,
  disableHover = false,
  showRowsPerPage = true,
  initialPageSize,
  defaultSort,
  manualSorting = false,
  sorting: controlledSorting,
  onSortingChange,
  onRowClick,
  rowClassName,
  getGroupKey,
  renderGroupHeader,
}: DataTableProps<TData>) {
  const t = useTranslations("Components.DataTable.Data");

  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(
    defaultSort ?? [],
  );
  const sorting = controlledSorting ?? internalSorting;
  const setSorting = onSortingChange ?? setInternalSorting;

  // TanStack Table's useAppTable returns functions that can't be memoized.
  // The "use no memo" directive above tells React Compiler to skip this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useAppTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: initialPageSize ?? 10,
      },
    },
    enableRowSelection,
    // Disable Shift range selection on row toggles.
    enableRowRangeSelection: false,
    onRowSelectionChange: setRowSelection,
    // When pagination UI is off, skip client page slicing (show all rows).
    manualPagination: !showPagination,
    manualSorting,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
  });

  const rowModel = table.getRowModel();
  const minTableWidth = getMinTableWidth(table);

  const visibleLeafColumnsCount = table.getVisibleLeafColumns().length;

  let lastGroupKey: string | null = null;
  const colSpan = visibleLeafColumnsCount;

  const renderedRows = rowModel.rows.map((row) => {
    const onClick = onRowClick?.(row.original);
    const currentKey = getGroupKey?.(row.original) ?? null;
    const needsHeader = !!currentKey && currentKey !== lastGroupKey;
    if (currentKey) lastGroupKey = currentKey;

    return (
      <React.Fragment key={row.id}>
        {needsHeader ? (
          <TableRow className="border-b-0">
            <TableCell
              aria-label={`Group header for ${currentKey}`}
              colSpan={colSpan}
              className="text-muted-foreground p-2 text-xs font-medium tracking-wide uppercase"
            >
              {renderGroupHeader ? renderGroupHeader(currentKey) : currentKey}
            </TableCell>
          </TableRow>
        ) : null}
        <TableRow
          data-state={row.getIsSelected() && "selected"}
          className={cn(
            rowClassName?.(row.original),
            onClick != undefined && "cursor-pointer",
            disableHover && "hover:bg-transparent",
          )}
          onClick={onClick}
        >
          {row.getVisibleCells().map((cell) => (
            <TableCell
              key={cell.id}
              className="p-2"
              style={{
                width: cell.column.getSize(),
                minWidth: cell.column.columnDef.minSize,
              }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
      </React.Fragment>
    );
  });

  const tableElements = (
    <div className={cn("flex min-w-0 flex-col space-y-4", containerClassName)}>
      <div className={cn("min-w-0 overflow-x-auto", tableClassName)}>
        <table
          className="w-full caption-bottom text-sm"
          style={{ minWidth: minTableWidth }}
        >
          <TableHeader
            className={cn("sticky top-0 z-10", tableHeaderClassName)}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className="p-2"
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            className={cn(tableBodyClassName)}
            key={`table-body-${rowModel.rows?.length ?? 0}`}
          >
            {rowModel.rows?.length ? (
              renderedRows
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 p-2 text-center"
                >
                  {t("noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
      {showPagination && (
        <DataTablePagination
          table={table}
          enableRowSelection={enableRowSelection}
          showRowsPerPage={showRowsPerPage}
        />
      )}
    </div>
  );

  return tableElements;
}
