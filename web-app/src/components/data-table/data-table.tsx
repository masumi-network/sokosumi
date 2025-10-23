"use client";
"use no memo";

import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import * as React from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import DataTablePagination from "./data-table-pagination";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
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
  onRowClick?: (row: TData) => () => void | Promise<void>;
  rowClassName?: (row: TData) => string | undefined;
  // Optional grouping support: render headers inside tbody before first row of each group
  getGroupKey?: (row: TData) => string | null | undefined;
  renderGroupHeader?: (groupKey: string) => React.ReactNode;
}

export default function DataTable<TData, TValue>({
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
  onRowClick,
  rowClassName,
  getGroupKey,
  renderGroupHeader,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations("Components.DataTable.Data");

  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [sorting, setSorting] = React.useState<SortingState>(defaultSort ?? []);

  // TanStack Table's useReactTable returns functions that can't be memoized.
  // The "use no memo" directive above tells React Compiler to skip this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
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
        pageSize: initialPageSize ?? 10,
      },
    },
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: showPagination ? getPaginationRowModel() : undefined,
  });

  const rowModel = table.getRowModel();

  const visibleLeafColumnsCount = table.getVisibleLeafColumns().length;

  let lastGroupKey: string | null = null;
  const colSpan = visibleLeafColumnsCount;

  const renderedRows = rowModel.rows.map((row) => {
    const onClick = onRowClick?.(row.original);
    const currentKey = getGroupKey?.(row.original) ?? null;
    const needsHeader = currentKey !== null && currentKey !== lastGroupKey;
    if (currentKey !== null) lastGroupKey = currentKey;

    return (
      <React.Fragment key={row.id}>
        {needsHeader ? (
          <TableRow className="border-b-0">
            <TableCell
              aria-label={`Group header for ${currentKey}`}
              colSpan={colSpan}
              className="text-muted-foreground p-2 text-xs font-medium tracking-wide uppercase"
            >
              {renderGroupHeader
                ? renderGroupHeader(currentKey as string)
                : (currentKey as string)}
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
    <div
      className={cn(
        "flex flex-col space-y-4 overflow-hidden",
        containerClassName,
      )}
    >
      <div
        className={cn("flex flex-1 flex-col overflow-hidden", tableClassName)}
      >
        <ScrollArea className="h-full">
          <Table>
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
          </Table>
        </ScrollArea>
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
