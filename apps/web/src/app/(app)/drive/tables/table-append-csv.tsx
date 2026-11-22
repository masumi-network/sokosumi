"use client";
import type { DataTable, TableRow } from "@sokosumi/core-client";
import { parseTableCsv } from "@sokosumi/utils";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { planCsvAppend, tableImportBatches } from "./table-import";
import { tableError } from "./table-value";

/** The most rows read to find the ones a CSV repeats, as Export CSV allows. */
const MAX_EXISTING = 10_000;

/** Adds the rows of a CSV to the end of a Table, matching headers to columns by name. */
export function TableAppendCsv({
  table,
  returnFocus,
  onClose,
  onDone,
}: {
  table: DataTable;
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("App.Tables");
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ReturnType<typeof planCsvAppend>>();
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  /** Set once rows start going out, so a retry resends the same batches. */
  const [key, setKey] = useState<string>();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError("");
    setPlan(undefined);
    try {
      if (file.size > 5_000_000) throw new Error(t("csvLimit"));
      const csv = parseTableCsv(await file.text());
      const existing: Pick<TableRow, "values">[] = [];
      let cursor: string | undefined;
      do {
        const page = await dataTableService.query(table.id, {
          limit: 100,
          cursor,
          archived: false,
        });
        existing.push(...page.rows);
        cursor = page.nextCursor ?? undefined;
        if (existing.length > MAX_EXISTING)
          throw new Error(t("appendCsv.tooManyRows"));
      } while (cursor);
      setPlan(
        planCsvAppend(
          table.columns,
          csv,
          existing,
          (row, error) => `${t("row")} ${row}: ${tableError(error, t)}`,
        ),
      );
      setFileName(file.name);
    } catch (error) {
      setFileName("");
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }

  const rows = !plan?.matched.length
    ? []
    : skipDuplicates
      ? plan.newRows
      : plan.rows;

  async function handleAdd() {
    const attempt = key ?? crypto.randomUUID();
    setKey(attempt);
    setPending(true);
    setError("");
    try {
      let added = 0;
      for (const batch of tableImportBatches(attempt, rows)) {
        await dataTableService.batch(table.id, batch);
        added += batch.insert.length;
        setProgress(added);
      }
      onDone(rows.length);
      onClose();
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="app-scrollbar max-h-[85dvh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("appendCsv.title")}</DialogTitle>
          <DialogDescription>{t("appendCsv.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="append-csv-file">{t("appendCsv.file")}</Label>
            {/* Same picker as New table: the native input stays the one real
            control, and the visible button and filename are presentational. */}
            <div className="ring-offset-background has-[:focus-visible]:ring-ring flex w-fit max-w-full items-center gap-3 rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
              <Button
                type="button"
                aria-hidden
                tabIndex={-1}
                size="sm"
                variant="outline"
                disabled={pending || !!key}
                onClick={() => input.current?.click()}
              >
                <Upload aria-hidden className="size-4" />
                {t("chooseCsv")}
              </Button>
              <span
                aria-hidden
                className="text-muted-foreground min-w-0 truncate text-sm"
              >
                {fileName || t("noFileChosen")}
              </span>
              <span className="sr-only">
                <Input
                  id="append-csv-file"
                  ref={input}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={pending || !!key}
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{t("csvLimit")}</p>
          </div>
          {plan && (
            <div className="grid gap-2 text-sm">
              {plan.matched.length ? (
                <p className="break-words">
                  {t("appendCsv.matched", {
                    columns: plan.matched.join(", "),
                  })}
                </p>
              ) : (
                <p>{t("appendCsv.noMatch")}</p>
              )}
              {plan.skipped.length > 0 && (
                <p className="text-muted-foreground break-words">
                  {t("appendCsv.skipped", {
                    columns: plan.skipped.join(", "),
                  })}
                </p>
              )}
              {plan.matched.length > 0 &&
                plan.newRows.length < plan.rows.length && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="append-csv-skip"
                      className="mt-0.5"
                      checked={skipDuplicates}
                      disabled={pending || !!key}
                      onCheckedChange={(value) =>
                        setSkipDuplicates(value === true)
                      }
                    />
                    <Label htmlFor="append-csv-skip" className="font-normal">
                      {t("appendCsv.skipDuplicates", {
                        count: plan.rows.length - plan.newRows.length,
                      })}
                    </Label>
                  </div>
                )}
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="min-w-0 break-words">{error}</span>
              </AlertDescription>
            </Alert>
          )}
          <p
            role="status"
            className="text-muted-foreground text-sm empty:hidden"
          >
            {pending && key ? t("importProgress", { count: progress }) : null}
          </p>
        </div>
        <DialogFooter>
          <Button
            loading={pending && !!key}
            disabled={!rows.length || pending}
            onClick={() => void handleAdd()}
          >
            {key && !pending && error
              ? t("retry")
              : t("appendCsv.add", { count: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
