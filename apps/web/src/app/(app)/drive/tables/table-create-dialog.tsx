"use client";

import type { TableColumn } from "@sokosumi/core-client";
import {
  createDataTableSchema,
  parseTableCsv,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, Table, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentProps, useRef, useState } from "react";
import { DRIVE_HEADER_CONTROL_CLASS } from "@/app/drive/components/drive-view-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAbortController } from "@/hooks/effects/use-abort-controller";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { isNumericCsvColumn, tableImportBatches } from "./table-import";
import { isTableRejection } from "./table-mutations";
import { parseTableInput, tableError } from "./table-value";

export const TABLE_TYPES: TableColumn["type"][] = [
  "text",
  "long_text",
  "number",
  "date",
  "checkbox",
  "url",
  "email",
  "single_select",
  "multiple_select",
  "last_updated",
];
const CSV_LIMIT = 5_000_000;

/** A Files CSV's bytes, refused as soon as they pass the import limit. */
async function readCsvFile(response: Response, name: string, tooLarge: string) {
  if (Number(response.headers.get("content-length")) > CSV_LIMIT) {
    await response.body?.cancel();
    throw new Error(tooLarge);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CSV_LIMIT) {
      await reader.cancel();
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  return new File(chunks as BlobPart[], name);
}

/** A CSV from Files, through its authorized content URL. */
async function fetchCsvFile(
  file: { url: string; name: string },
  signal: AbortSignal,
  copy: CsvFileCopy,
) {
  const response = await fetch(file.url, { signal });
  // A file, not a table or row, is what went missing.
  if (response.status === 404) throw new Error(copy.missing);
  if (!response.ok)
    throw Object.assign(new Error(response.statusText), {
      error: response.status === 403 ? "Forbidden" : "Request",
    });
  return readCsvFile(response, file.name, copy.tooLarge);
}

interface CsvFileCopy {
  tooLarge: string;
  missing: string;
}

/**
 * The file viewer's trigger, shaped like its other header buttons: icon on
 * phones, label from sm. Beside a chat attachment it is a quiet labelled
 * action instead: no border or fill until hovered, so the file stays the
 * subject. Radix passes the trigger's props and ref through.
 */
function OpenAsTableButton({
  label,
  attachment,
  ...props
}: ComponentProps<typeof Button> & { label: string; attachment?: boolean }) {
  if (attachment)
    return (
      <Button
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-10 gap-1.5 self-center px-2.5 md:h-8"
        {...props}
      >
        <Table className="size-4" aria-hidden />
        {label}
      </Button>
    );
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-10 sm:w-auto sm:gap-1.5 sm:px-3 md:h-8"
      aria-label={label}
      title={label}
      {...props}
    >
      <Table className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/**
 * The first three filled values of each CSV column, so its mapping shows what
 * it holds. Read once per file, stopping as soon as every column has three.
 */
function csvSamples(rows: string[][]) {
  const samples = rows[0].map((): string[] => []);
  let open = samples.length;
  for (let r = 1; r < rows.length && open > 0; r++)
    rows[r].forEach((cell, i) => {
      const value = cell.trim();
      if (!value || !samples[i] || samples[i].length === 3) return;
      samples[i].push(value);
      if (samples[i].length === 3) open--;
    });
  return samples;
}

/** One cancellable read of a Files CSV; `read` answers null once cancelled. */
function useCsvFileRead() {
  const active = useAbortController();
  const [reading, setReading] = useState<AbortController | null>(null);
  async function read(file: { url: string; name: string }, copy: CsvFileCopy) {
    const controller = active.start();
    setReading(controller);
    try {
      return await fetchCsvFile(file, controller.signal, copy);
    } catch (error) {
      if (controller.signal.aborted) return null;
      // The browser's own network wording is not ours and not translated.
      if (error instanceof TypeError || error instanceof DOMException)
        throw Object.assign(new Error(error.message), { error: "Request" });
      throw error;
    } finally {
      active.release(controller);
      setReading((current) => (current === controller ? null : current));
    }
  }
  return { loading: reading !== null, read, cancel: active.abort };
}

export function TableCreateDialog({
  workspaceId,
  csvFile,
  attachment,
}: {
  workspaceId: string | null;
  /** A CSV already in Files or chat: the trigger reads it into the import, ready to map. */
  csvFile?: { url: string; name: string };
  /** The trigger sits beside a chat attachment: quiet, and labelled on phones too. */
  attachment?: boolean;
}) {
  const t = useTranslations("App.Tables");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const projects = useQuery({
    queryKey: ["table-project-options", workspaceId],
    enabled: open,
    queryFn: () => dataTableService.projects(),
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [csv, setCsv] = useState<string[][]>([]);
  const [samples, setSamples] = useState<string[][]>([]);
  const [csvName, setCsvName] = useState("");
  const csvInput = useRef<HTMLInputElement>(null);
  const [columns, setColumns] = useState<
    Array<{
      id: string;
      name: string;
      type: TableColumn["type"];
      options: string[];
    }>
  >([]);
  /** Columns preset to Number from their values, until someone picks a type. */
  const [guessedIds, setGuessedIds] = useState<string[]>([]);
  const [blankColumnId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState<{
    key: string;
    tableId?: string;
  } | null>(null);
  async function handleCsv(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > CSV_LIMIT) throw new Error(t("csvLimit"));
      const rows = parseTableCsv(await file.text());
      setCsv(rows);
      setSamples(csvSamples(rows));
      setCsvName(file.name);
      const next = rows[0].map((name, i) => ({
        id: crypto.randomUUID(),
        name,
        type: isNumericCsvColumn(
          name,
          rows.slice(1).map((row) => row[i]),
        )
          ? ("number" as const)
          : ("text" as const),
        options: [],
      }));
      setColumns(next);
      setGuessedIds(
        next.filter((column) => column.type === "number").map((c) => c.id),
      );
      setAttempt(null);
      setError("");
    } catch (error) {
      setError(tableError(error, t));
    }
  }
  const fileRead = useCsvFileRead();
  async function handleOpenChange(value: boolean) {
    if (pending) return;
    setOpen(value);
    if (!value) fileRead.cancel();
    if (!value || !csvFile || csv.length) return;
    setError("");
    // Before the read, so a title typed while it loads is kept.
    setTitle((current) => current || csvFile.name.replace(/\.csv$/i, ""));
    // Names the file being read, and the one that failed, as a chosen CSV is named.
    setCsvName(csvFile.name);
    try {
      const file = await fileRead.read(csvFile, {
        tooLarge: t("csvLimit"),
        missing: t("fileMissing"),
      });
      if (!file) return;
      await handleCsv(file);
    } catch (error) {
      setError(tableError(error, t));
    }
  }
  async function handleCreate() {
    setPending(true);
    setError("");
    const current = attempt ?? { key: crypto.randomUUID() };
    try {
      const definitions = columns.length
        ? columns
        : [
            {
              id: blankColumnId,
              name: t("firstColumn"),
              type: "text" as const,
              options: [],
            },
          ];
      const rows = csv.slice(1).map((row, index) => {
        try {
          const parsed = tableInsertRowSchema.parse({
            // A Last updated column fills itself, so its CSV cells are dropped.
            values: Object.fromEntries(
              definitions.flatMap((column, i) =>
                column.type === "last_updated"
                  ? []
                  : [[column.id, parseTableInput(column, row[i])]],
              ),
            ),
          });
          validateTableValues(
            definitions.map((column) => ({ ...column, description: "" })),
            parsed.values,
            parsed.evidence,
          );
          return parsed;
        } catch (error) {
          throw new Error(`${t("row")} ${index + 2}: ${tableError(error, t)}`);
        }
      });
      const payload = createDataTableSchema.parse({
        key: current.key,
        title,
        description,
        projectId: projectId || null,
        columns: definitions,
      });
      const batches = tableImportBatches(current.key, rows);
      setAttempt(current);
      const table = current.tableId
        ? { id: current.tableId }
        : await dataTableService.create(payload);
      current.tableId = table.id;
      setAttempt({ ...current });
      let imported = 0;
      for (const batch of batches) {
        await dataTableService.batch(table.id, batch);
        imported += batch.insert.length;
        setProgress(imported);
      }
      setOpen(false);
      router.push(`/drive/tables/${table.id}`);
    } catch (error) {
      if (!current.tableId && isTableRejection(error)) setAttempt(null);
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => void handleOpenChange(value)}>
      <DialogTrigger asChild>
        {csvFile ? (
          <OpenAsTableButton label={t("openAsTable")} attachment={attachment} />
        ) : (
          /* The Files toolbar states the house rule for this row: 32px
        controls, and the view's own create action is the solid one. */
          /* This trigger sits inside the drive header row's `@container`, so it
        takes that row's shared height rather than open-coding one: a control
        here taller than the tab strip lifts the row and moves the strip. */
          <Button
            size="sm"
            className={cn("gap-1.5", DRIVE_HEADER_CONTROL_CLASS)}
          >
            <Plus aria-hidden className="size-4" />
            {t("newTable")}
          </Button>
        )}
      </DialogTrigger>
      {/* Only the form scrolls: header and actions stay outside its
      scrollport, so the one action stays in reach and a focused field is
      never behind it. `overscroll-contain` keeps that scroll off the chat. */}
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newTable")}</DialogTitle>
          <DialogDescription>
            {csvFile ? (
              <>
                <span className="text-foreground font-medium break-words">
                  {csvName}
                </span>
                {columns.length > 0 && (
                  <>
                    <span> · </span>
                    {t("rowCount", { count: csv.length - 1 })}
                    <span> · </span>
                    {t("columnCount", { count: columns.length })}
                  </>
                )}
              </>
            ) : (
              t("createDescription")
            )}
          </DialogDescription>
        </DialogHeader>
        {/* The inset keeps focus rings inside the scrollport's clip. */}
        <div
          className="app-scrollbar -m-1 grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-1 sm:grid-cols-2"
          // Radix wraps focus from Close back to Title with `preventScroll`,
          // and Close sits outside this scrollport, so bring a focused field
          // into view here rather than trusting the browser to.
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest" })}
        >
          <div className="grid gap-2">
            <Label htmlFor="table-title">{t("title")}</Label>
            <Input
              id="table-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              disabled={pending || !!attempt}
              maxLength={160}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="table-project">{t("projectOptional")}</Label>
            <select
              id="table-project"
              className={withEditableTextSize(
                "bg-background h-10 rounded-md border px-3 py-2",
              )}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={pending || !!attempt}
            >
              <option value="">{t("noProject")}</option>
              {projects.data?.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="table-description">{t("description")}</Label>
            <Textarea
              id="table-description"
              rows={2}
              className="min-h-16"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={pending || !!attempt}
            />
          </div>
          {/* A CSV opened from Files or chat is already chosen: the header
          names it, so the picker and its limits only show for a new table,
          or to choose another file when that one could not be read. */}
          {(!csvFile || (!!error && !csv.length && !fileRead.loading)) && (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="table-csv">{t("importCsv")}</Label>
              {/* The native control stays the one real control: it keeps the
            label, the tab stop and the value, and only its browser-supplied,
            unlocalized chrome is replaced. The visible trigger and the
            filename are therefore presentational — otherwise the picker
            appears twice in the accessibility tree and announces "No file
            chosen" twice. `has-[:focus-visible]:ring-ring` paints the ring the
            clipped input cannot paint for itself; put the colour on
            `focus-visible:` instead and the wrapper, which is never focusable,
            never matches, so the ring falls back to `currentColor`. */}
              <div className="ring-offset-background has-[:focus-visible]:ring-ring flex w-fit max-w-full min-w-0 items-center gap-3 rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
                <Button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  size="sm"
                  variant="outline"
                  disabled={pending || fileRead.loading || !!attempt}
                  onClick={() => csvInput.current?.click()}
                >
                  <Upload aria-hidden className="size-4" />
                  {t("chooseCsv")}
                </Button>
                <span
                  aria-hidden
                  className="text-muted-foreground min-w-0 truncate text-sm"
                >
                  {/* From a file the header names it; here it would say it twice. */}
                  {csvFile ? null : csvName || t("noFileChosen")}
                </span>
                <span className="sr-only">
                  <Input
                    id="table-csv"
                    ref={csvInput}
                    type="file"
                    accept=".csv,text/csv"
                    disabled={pending || fileRead.loading || !!attempt}
                    onChange={(event) =>
                      void handleCsv(event.target.files?.[0])
                    }
                  />
                </span>
              </div>
              {/* On recovery the error above already says what went wrong. */}
              {!csvFile && (
                <p className="text-muted-foreground text-sm">{t("csvLimit")}</p>
              )}
            </div>
          )}
          {columns.length > 0 && (
            // One row per column: its name and type, then a few of its
            // values, so the mapping and the preview read as one list.
            <section aria-labelledby="table-columns" className="sm:col-span-2">
              <h3 id="table-columns" className="text-sm font-medium">
                {t("columns")}
              </h3>
              <ul className="divide-border divide-y">
                {columns.map((column, index) => {
                  return (
                    <li
                      key={column.id}
                      className="grid grid-cols-2 gap-x-2 gap-y-1.5 py-3"
                    >
                      <Input
                        aria-label={t("columnName")}
                        value={column.name}
                        disabled={pending || !!attempt}
                        onChange={(event) =>
                          setColumns(
                            columns.map((item, i) =>
                              i === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <select
                        className={withEditableTextSize(
                          "bg-background h-10 rounded-md border px-3 py-2",
                        )}
                        aria-label={t("type")}
                        aria-describedby={
                          guessedIds.includes(column.id)
                            ? `${column.id}-guess`
                            : undefined
                        }
                        value={column.type}
                        disabled={pending || !!attempt}
                        onChange={(event) => {
                          setGuessedIds(
                            guessedIds.filter((id) => id !== column.id),
                          );
                          setColumns(
                            columns.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    type: event.target
                                      .value as TableColumn["type"],
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        {TABLE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`types.${type}`)}
                          </option>
                        ))}
                      </select>
                      {column.type.includes("select") && (
                        // Hangs under the type that asked for it, so the
                        // pair still reads as one mapping row.
                        <Input
                          className="col-start-2"
                          disabled={pending || !!attempt}
                          aria-label={t("optionsFor", { column: column.name })}
                          placeholder={t("options")}
                          onChange={(event) =>
                            setColumns(
                              columns.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      options: event.target.value
                                        .split(";")
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      )}
                      {samples[index]?.length > 0 && (
                        <p
                          className={cn(
                            "text-muted-foreground col-span-2 truncate text-xs",
                            column.type === "number" && "tabular-nums",
                          )}
                        >
                          <span className="sr-only">{t("examples")}: </span>
                          <span>{samples[index].join(" · ")}</span>
                        </p>
                      )}
                      {guessedIds.includes(column.id) && (
                        <p
                          id={`${column.id}-guess`}
                          className="text-muted-foreground col-span-2 text-xs"
                        >
                          {t("numberGuess")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {error && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>
                <span className="min-w-0 break-words">{error}</span>
              </AlertDescription>
            </Alert>
          )}
          <p
            role="status"
            className="text-muted-foreground text-sm sm:col-span-2"
          >
            {pending && csv.length
              ? t("importProgress", { count: progress })
              : fileRead.loading
                ? t("loadingCsv")
                : null}
          </p>
        </div>
        {/* An inset rule, like the column dividers: the dialog's padding is
        not the app gutter, so a bleed here would break the full-bleed rule. */}
        <DialogFooter className="border-t pt-4">
          {attempt?.tableId && (
            <Button
              variant="outline"
              onClick={() => router.push(`/drive/tables/${attempt.tableId}`)}
            >
              {t("openTable")}
            </Button>
          )}
          <Button
            variant="primary"
            loading={pending}
            // From Files the CSV is the point: no blank Table if it did not load.
            disabled={fileRead.loading || (!!csvFile && csv.length === 0)}
            onClick={() => void handleCreate()}
          >
            {attempt?.tableId ? t("retry") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
