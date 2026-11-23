"use client";
import type { DataTable, TableColumn } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { type RefObject, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { tableRows } from "./table-csv";
import {
  SUMMARY_GROUP_TYPES,
  summarizeTableRows,
  type TableSummaryGroup,
} from "./table-summary";
import { tableError } from "./table-value";

/** Counts every live row of a Table by one column's values and totals its number columns. */
export function TableSummaryDialog({
  table,
  returnFocus,
  onClose,
  onPick,
}: {
  table: DataTable;
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Shows only the rows holding this value. */
  onPick: (column: TableColumn, value: TableSummaryGroup["value"]) => void;
}) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const columns = table.columns.filter((column) =>
    SUMMARY_GROUP_TYPES.has(column.type),
  );
  const numbers = table.columns.filter((column) => column.type === "number");
  const [columnId, setColumnId] = useState(
    () =>
      (columns.find((column) => column.type === "single_select") ?? columns[0])
        ?.id ?? "",
  );
  const column = columns.find((item) => item.id === columnId);
  // Every live row, not the page on screen, so the counts are the Table's own.
  const rows = useQuery({
    queryKey: ["table-summary-rows", table.id],
    queryFn: () => tableRows(table.id, { archived: false }),
    staleTime: 0,
    gcTime: 0,
  });
  const summary =
    column && rows.data ? summarizeTableRows(rows.data, column, numbers) : null;
  // Significant digits, not the default three decimals, so 0.0004 never reads
  // as 0, while a float sum's noise (0.30000000000000004) still reads 0.3.
  const number = (value: number) =>
    format.number(value, { maximumSignificantDigits: 15 });
  const sum = (value: number | null) => (value === null ? "–" : number(value));
  function label(value: TableSummaryGroup["value"]) {
    if (value === null) return t("summary.empty");
    if (Array.isArray(value)) return t("summary.noOptions");
    if (value === "") return t("summary.blank");
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    return typeof value === "number" ? number(value) : value;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("summary.title")}</DialogTitle>
          <DialogDescription>{t("summary.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="table-summary-column">{t("summary.groupBy")}</Label>
          <select
            id="table-summary-column"
            className={withEditableTextSize(
              "bg-background h-10 rounded-md border px-3 py-2",
            )}
            value={columnId}
            onChange={(event) => setColumnId(event.target.value)}
          >
            {columns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <p role="status" aria-live="polite" className="text-sm">
          {!column
            ? t("summary.noColumns")
            : rows.isPending
              ? t("summary.reading")
              : rows.data === null
                ? t("summary.tooMany")
                : summary &&
                  t("summary.scope", {
                    count: summary.total.count,
                    values: summary.groups.length,
                  })}
        </p>
        {rows.error && (
          <p role="alert" className="text-destructive text-sm">
            {tableError(rows.error, t)}
          </p>
        )}
        {column && summary && summary.total.count > 0 && (
          <Table containerClassName="max-h-[50dvh] overscroll-contain rounded-md border">
            <TableHeader className="bg-card-background sticky top-0">
              <TableRow>
                <TableHead>{column.name}</TableHead>
                <TableHead className="text-end">{t("summary.rows")}</TableHead>
                {numbers.map((number) => (
                  <TableHead key={number.id} className="text-end">
                    {t("summary.sumOf", { column: number.name })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.groups.map((group) => (
                <TableRow key={JSON.stringify(group.value)}>
                  <TableCell className="max-w-64">
                    <button
                      type="button"
                      className="min-h-6 max-w-full truncate text-start underline underline-offset-4"
                      title={t("summary.show", { value: label(group.value) })}
                      onClick={() => onPick(column, group.value)}
                    >
                      {label(group.value)}
                    </button>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {format.number(group.count)}
                  </TableCell>
                  {group.sums.map((value, index) => (
                    <TableCell
                      key={numbers[index]!.id}
                      className="text-end tabular-nums"
                    >
                      {sum(value)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>{t("summary.total")}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {format.number(summary.total.count)}
                </TableCell>
                {summary.total.sums.map((value, index) => (
                  <TableCell
                    key={numbers[index]!.id}
                    className="text-end tabular-nums"
                  >
                    {sum(value)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        )}
        {summary && summary.total.count > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("summary.pickHint")}
          </p>
        )}
        {column?.type === "multiple_select" && (
          <p className="text-muted-foreground text-sm">
            {t("summary.multipleNote")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
