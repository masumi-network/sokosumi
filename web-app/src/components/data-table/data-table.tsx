"use client";

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

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
  defaultSort?: { id: string; desc: boolean }[];
  onRowClick?: (row: TData) => () => void | Promise<void>;
  rowClassName?: (row: TData) => string | undefined;
}

export default function DataTable<TData, TValue>({
  columns,
  data,
  containerClassName,
  tableClassName,
  tableHeaderClassName,
  tableBodyClassName,
  showPagination,
  defaultSort,
  onRowClick,
  rowClassName,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations("Components.DataTable.Data");

  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [sorting, setSorting] = React.useState<SortingState>(defaultSort ?? []);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    enableRowSelection: true,
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
        <div
          className={cn(
            "bg-background sticky top-0 z-10",
            tableHeaderClassName,
          )}
        >
          <ScrollArea className="h-full">
            <Table className="table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
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
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
        <div className={cn("flex-1 overflow-hidden", tableBodyClassName)}>
          <ScrollArea className="h-full">
            <Table className="table-fixed">
              <TableBody>
                {rowModel.rows?.length ? (
                  rowModel.rows.map((row) => {
                    const onClick = onRowClick?.(row.original);
                    return (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className={cn(
                          rowClassName?.(row.original),
                          onClick != undefined && "cursor-pointer",
                        )}
                        onClick={onClick}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            style={{
                              width: cell.column.getSize(),
                            }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      {t("noResults")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </div>
      {showPagination && <DataTablePagination table={table} />}
    </div>
  );

  return tableElements;
}
