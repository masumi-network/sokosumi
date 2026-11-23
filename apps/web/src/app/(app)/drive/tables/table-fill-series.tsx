"use client";
import type {
  DataTable,
  TableColumn,
  TableRow,
  TableView,
} from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { type RefObject, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dataTableService } from "@/lib/services/data-table.client";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { createTableMutations, isTableRejection } from "./table-mutations";
import {
  parseTableInput,
  type SeriesUnit,
  seriesValue,
  tableError,
  tableValueText,
} from "./table-value";

/** One batch writes at most this many rows, and one batch is one undo. */
const LIMIT = 100;
const PREVIEW = 3;

type Patch = { id: string; version: number; values: TableRow["values"] };
type Planned = {
  patch: Patch[];
  preview: { position: number; label: string; value: number | string }[];
};

/** Fills a number or date column with a series, in the order the view shows its rows, as one undoable batch. */
export function TableFillSeries({
  table,
  column,
  definition,
  returnFocus,
  onClose,
  onDone,
}: {
  table: DataTable;
  column: TableColumn;
  definition: TableView["definition"];
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const isDate = column.type === "date";
  const [start, setStart] = useState("");
  const [step, setStep] = useState("1");
  const [unit, setUnit] = useState<SeriesUnit>("day");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [planned, setPlanned] = useState<Planned | "tooMany" | "unchanged">();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mutate] = useState(createTableMutations);
  const locked = mutate.hasPending();
  // Names each previewed row by the first other column, so the order is visible.
  const labelColumn = table.columns.find(
    (item) => item.id !== column.id && item.type !== "last_updated",
  );

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setPlanned(undefined);
      setError("");
    };
  }
  function show(value: number | string) {
    return typeof value === "number"
      ? // Every significant digit, so the preview shows the value that is saved.
        format.number(value, { maximumSignificantDigits: 21 })
      : format.dateTime(new Date(value), {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
  }
  async function handlePlan() {
    setError("");
    setPending(true);
    try {
      const first = parseTableInput(column, start);
      const by = Number(step);
      if (first == null) throw new Error("Invalid number");
      if (!Number.isFinite(by) || (isDate && !Number.isInteger(by)))
        throw new Error("Invalid number");
      // The rows as the view orders and filters them, read in one page so no
      // page boundary can move under the fill. More is refused below.
      const page = await dataTableService.query(table.id, {
        filters: definition.filters,
        sort: definition.sort,
        limit: LIMIT,
        archived: false,
      });
      if (page.nextCursor) {
        setPlanned("tooMany");
        return;
      }
      const next: Planned = { patch: [], preview: [] };
      page.rows.forEach((row, index) => {
        const current = row.values[column.id];
        // Position, not fill count, sets the value: a kept cell keeps its slot.
        const value = seriesValue(first as number | string, by, unit, index);
        if (onlyEmpty && current != null && current !== "") return;
        if (current === value) return;
        next.patch.push({
          id: row.id,
          version: row.version,
          values: { [column.id]: value },
        });
        if (next.preview.length < PREVIEW)
          next.preview.push({
            position: index + 1,
            label: labelColumn
              ? tableValueText(row.values[labelColumn.id] ?? null)
              : "",
            value,
          });
      });
      setPlanned(next.patch.length ? next : "unchanged");
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  async function handleApply(patch: Patch[]) {
    setPending(true);
    setError("");
    try {
      await mutate("fill-series", { patch }, (body) =>
        dataTableService.batch(table.id, body),
      );
      onDone(patch.length);
      onClose();
    } catch (error) {
      setError(tableError(error, t));
      // A refused write changed nothing: drop the plan so the next Preview
      // reads fresh row versions. An unclear failure keeps it, and its key, to retry.
      if (isTableRejection(error)) setPlanned(undefined);
    } finally {
      setPending(false);
    }
  }
  const ready = typeof planned === "object" ? planned : undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !locked) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t("fillSeries.title", { column: column.name })}
          </DialogTitle>
          <DialogDescription>{t("fillSeries.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void (ready ? handleApply(ready.patch) : handlePlan());
          }}
        >
          <fieldset disabled={locked} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="fill-series-start">{t("fillSeries.start")}</Label>
              <Input
                id="fill-series-start"
                type={isDate ? "date" : "number"}
                step="any"
                value={start}
                readOnly={pending}
                required
                autoComplete="off"
                onChange={(event) => edit(setStart)(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="fill-series-step">{t("fillSeries.step")}</Label>
                <Input
                  id="fill-series-step"
                  type="number"
                  step={isDate ? 1 : "any"}
                  value={step}
                  readOnly={pending}
                  required
                  autoComplete="off"
                  onChange={(event) => edit(setStep)(event.target.value)}
                />
              </div>
              {isDate && (
                <div className="grid gap-2">
                  <Label htmlFor="fill-series-unit">
                    {t("fillSeries.unit")}
                  </Label>
                  <select
                    id="fill-series-unit"
                    className={withEditableTextSize(
                      "bg-background h-10 rounded-md border px-3 py-2",
                    )}
                    value={unit}
                    disabled={pending}
                    onChange={(event) =>
                      edit(setUnit)(event.target.value as SeriesUnit)
                    }
                  >
                    {(["day", "week", "month"] as const).map((item) => (
                      <option key={item} value={item}>
                        {t(`fillSeries.units.${item}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="fill-series-empty"
                checked={onlyEmpty}
                disabled={pending}
                onCheckedChange={(checked) => edit(setOnlyEmpty)(!!checked)}
              />
              <Label htmlFor="fill-series-empty">
                {t("fillSeries.onlyEmpty")}
              </Label>
            </div>
          </fieldset>
          <div role="status" aria-live="polite" className="grid gap-2 text-sm">
            {planned === "tooMany" && t("fillSeries.tooMany", { limit: LIMIT })}
            {planned === "unchanged" && t("fillSeries.unchanged")}
            {ready && (
              <>
                <p>{t("fillSeries.changes", { count: ready.patch.length })}</p>
                <ol className="bg-muted grid gap-1 rounded-md p-3">
                  {ready.preview.map((item) => (
                    <li key={item.position} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {t("fillSeries.row", { position: item.position })}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="min-w-0 text-right font-medium break-all tabular-nums">
                        {show(item.value)}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" loading={pending} disabled={!start}>
              {ready
                ? t("fillSeries.apply", { count: ready.patch.length })
                : t("fillSeries.preview")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
