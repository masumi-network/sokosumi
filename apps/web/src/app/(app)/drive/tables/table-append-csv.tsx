"use client";
import type { TableColumn, TableRow } from "@sokosumi/core-client";
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

/** Core's cap on a Table's rows, archived ones included. */
const MAX_ROWS = 10_000;

type AppendTable = {
  id: string;
  columns: Pick<TableColumn, "id" | "name" | "type" | "options">[];
};

/** Every live row, to spot repeats, and how many more rows Core still takes. */
async function readTable(id: string) {
  const archived = await dataTableService.query(id, {
    limit: 1,
    archived: true,
  });
  const rows: Pick<TableRow, "values">[] = [];
  let cursor: string | undefined;
  let live = 0;
  do {
    const page = await dataTableService.query(id, {
      limit: 100,
      cursor,
      archived: false,
    });
    rows.push(...page.rows);
    live = page.total;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { rows, room: Math.max(0, MAX_ROWS - live - archived.total) };
}

/** Adds the rows of a CSV to the end of a Table, matching headers to Text columns by name. */
export function TableAppendCsv({
  table,
  returnFocus,
  onChanged,
  onClose,
  onDone,
}: {
  table: AppendTable;
  returnFocus?: RefObject<HTMLElement | null>;
  /** Rows were written, possibly not all of them: refresh the Table. */
  onChanged: () => void;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("App.Tables");
  const [file, setFile] = useState<{
    name: string;
    room: number;
    plan: ReturnType<typeof planCsvAppend>;
  }>();
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState<"reading" | "adding">();
  const [added, setAdded] = useState(0);
  const [error, setError] = useState("");
  /** Set once rows start going out, so a retry resends the same batches. */
  const [key, setKey] = useState<string>();

  async function handleFile(picked: File | undefined) {
    // The picker stays enabled while reading so it keeps focus; ignore a
    // second pick until the first is read.
    if (!picked || busy) return;
    setBusy("reading");
    setError("");
    setFile(undefined);
    try {
      if (picked.size > 5_000_000) throw new Error(t("csvLimit"));
      const csv = parseTableCsv(await picked.text());
      const plan = (existing: Pick<TableRow, "values">[]) =>
        planCsvAppend(
          table.columns,
          csv,
          existing,
          (row, error) => `${t("row")} ${row}: ${tableError(error, t)}`,
        );
      // Headers that fill nothing are refused before scanning the Table.
      const local = plan([]);
      if (!local.rows.length) {
        setFile({ name: picked.name, room: Infinity, plan: local });
        return;
      }
      const { rows, room } = await readTable(table.id);
      setFile({ name: picked.name, room, plan: plan(rows) });
    } catch (error) {
      setError(tableError(error, t));
    } finally {
      setBusy(undefined);
    }
  }

  const plan = file?.plan;
  const { rows, room } = rowsToAdd(file, skipDuplicates);
  const full = rows.length > room;

  async function handleAdd() {
    const attempt = key ?? crypto.randomUUID();
    setKey(attempt);
    setBusy("adding");
    setError("");
    let written = 0;
    try {
      // One batch at a time, in order: rows land in CSV order and the first
      // failure stops the rest.
      for (const batch of tableImportBatches(attempt, rows)) {
        await dataTableService.batch(table.id, batch);
        written += batch.insert.length;
        setAdded(written);
      }
      onChanged();
      onDone(rows.length);
      onClose();
    } catch (error) {
      // A batch can commit even when its answer is lost: always reload.
      onChanged();
      setError(tableError(error, t));
    } finally {
      setBusy(undefined);
    }
  }

  const locked = busy === "adding" || !!key;
  const status = appendStatus(
    t,
    busy,
    added,
    key && error ? rows.length : null,
  );
  const problem =
    error || (full ? t("appendCsv.full", { room, count: rows.length }) : "");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
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
          <CsvPicker
            name={file?.name}
            disabled={locked}
            onPick={(picked) => void handleFile(picked)}
          />
          {plan && (
            <AppendPlan
              plan={plan}
              skip={skipDuplicates}
              locked={locked}
              onSkip={setSkipDuplicates}
            />
          )}
          {problem && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="min-w-0 break-words">{problem}</span>
              </AlertDescription>
            </Alert>
          )}
          <p
            role="status"
            className={status ? "text-muted-foreground text-sm" : "sr-only"}
          >
            {status}
          </p>
        </div>
        <DialogFooter>
          <Button
            loading={busy === "adding"}
            disabled={!rows.length || full || !!busy}
            onClick={() => void handleAdd()}
          >
            {key && error
              ? t("retry")
              : t("appendCsv.add", { count: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The rows Add sends, and how many more the Table takes. */
function rowsToAdd(
  file: { room: number; plan: ReturnType<typeof planCsvAppend> } | undefined,
  skipDuplicates: boolean,
) {
  if (!file?.plan.matched.length) return { rows: [], room: Infinity };
  const rows = skipDuplicates ? file.plan.newRows : file.plan.rows;
  return { rows, room: file.room };
}

/** The live line: reading, adding, or how far a stopped add got. */
function appendStatus(
  t: ReturnType<typeof useTranslations<"App.Tables">>,
  busy: "reading" | "adding" | undefined,
  added: number,
  stoppedOf: number | null,
) {
  if (busy === "reading") return t("appendCsv.reading");
  if (busy === "adding") return t("importProgress", { count: added });
  if (stoppedOf !== null)
    return t("appendCsv.stopped", { added, count: stoppedOf });
  return null;
}

/** Same picker as New table: the native input stays the one real control,
 * and the visible button and filename are presentational. */
function CsvPicker({
  name,
  disabled,
  onPick,
}: {
  name: string | undefined;
  disabled: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const t = useTranslations("App.Tables");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-2">
      <Label htmlFor="append-csv-file">{t("appendCsv.file")}</Label>
      <div className="ring-offset-background has-[:focus-visible]:ring-ring flex w-fit max-w-full items-center gap-3 rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
        <Button
          type="button"
          aria-hidden
          tabIndex={-1}
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden className="size-4" />
          {t("chooseCsv")}
        </Button>
        <span
          aria-hidden
          className="text-muted-foreground min-w-0 truncate text-sm"
        >
          {name || t("noFileChosen")}
        </span>
        <span className="sr-only">
          <Input
            id="append-csv-file"
            ref={input}
            type="file"
            accept=".csv,text/csv"
            disabled={disabled}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              // Clear, so choosing the same file again (after fixing its
              // headers) still fires change.
              event.target.value = "";
              onPick(picked);
            }}
          />
        </span>
      </div>
      <p className="text-muted-foreground text-sm">{t("csvLimit")}</p>
    </div>
  );
}

/** What the CSV fills, what it leaves out, and the offer to skip repeats. */
function AppendPlan({
  plan,
  skip,
  locked,
  onSkip,
}: {
  plan: ReturnType<typeof planCsvAppend>;
  skip: boolean;
  locked: boolean;
  onSkip: (skip: boolean) => void;
}) {
  const t = useTranslations("App.Tables");
  const repeats = plan.rows.length - plan.newRows.length;
  return (
    <div className="grid gap-2 text-sm">
      {plan.ambiguous.length > 0 ? (
        <p className="break-words">
          {t("appendCsv.ambiguous", { columns: plan.ambiguous.join(", ") })}
        </p>
      ) : plan.matched.length ? (
        <p className="break-words">
          {t("appendCsv.matched", { columns: plan.matched.join(", ") })}
        </p>
      ) : (
        <p>{t("appendCsv.noMatch")}</p>
      )}
      {plan.skipped.length > 0 && (
        <p className="text-muted-foreground break-words">
          {t("appendCsv.skipped", { columns: plan.skipped.join(", ") })}
        </p>
      )}
      {plan.matched.length > 0 && repeats > 0 && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="append-csv-skip"
            className="mt-0.5"
            checked={skip}
            disabled={locked}
            onCheckedChange={(value) => onSkip(value === true)}
          />
          <Label htmlFor="append-csv-skip" className="font-normal">
            {t("appendCsv.skipDuplicates", { count: repeats })}
          </Label>
        </div>
      )}
    </div>
  );
}
