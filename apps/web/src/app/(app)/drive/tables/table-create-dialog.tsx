"use client";

import type { TableColumn } from "@sokosumi/core-client";
import {
  createDataTableSchema,
  parseTableCsv,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
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
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { tableImportBatches } from "./table-import";
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
];
export function TableCreateDialog({
  workspaceId,
}: {
  workspaceId: string | null;
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
      if (file.size > 5000000) throw new Error(t("csvLimit"));
      const rows = parseTableCsv(await file.text());
      setCsv(rows);
      setCsvName(file.name);
      setColumns(
        rows[0].map((name) => ({
          id: crypto.randomUUID(),
          name,
          type: "text",
          options: [],
        })),
      );
      setAttempt(null);
      setError("");
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
            values: Object.fromEntries(
              definitions.map((column, i) => [
                column.id,
                parseTableInput(column, row[i]),
              ]),
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
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        {/* The Files toolbar states the house rule for this row: 32px
        controls, and the view's own create action is the solid one. */}
        {/* This trigger sits inside the drive header row's `@container`, so it
        takes that row's shared height rather than open-coding one: a control
        here taller than the tab strip lifts the row and moves the strip. */}
        <Button size="sm" className={cn("gap-1.5", DRIVE_HEADER_CONTROL_CLASS)}>
          <Plus aria-hidden className="size-4" />
          {t("newTable")}
        </Button>
      </DialogTrigger>
      <DialogContent className="app-scrollbar max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newTable")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
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
            <Label htmlFor="table-description">{t("description")}</Label>
            <Textarea
              id="table-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={pending || !!attempt}
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
          <div className="grid gap-2">
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
            <div className="ring-offset-background has-[:focus-visible]:ring-ring flex w-fit items-center gap-3 rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
              <Button
                type="button"
                aria-hidden
                tabIndex={-1}
                size="sm"
                variant="outline"
                disabled={pending || !!attempt}
                onClick={() => csvInput.current?.click()}
              >
                <Upload aria-hidden className="size-4" />
                {t("chooseCsv")}
              </Button>
              <span
                aria-hidden
                className="text-muted-foreground min-w-0 truncate text-sm"
              >
                {csvName || t("noFileChosen")}
              </span>
              <span className="sr-only">
                <Input
                  id="table-csv"
                  ref={csvInput}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={pending || !!attempt}
                  onChange={(event) => void handleCsv(event.target.files?.[0])}
                />
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{t("csvLimit")}</p>
          </div>
          {columns.length > 0 && (
            <div className="grid gap-3">
              <h3 className="font-medium">{t("mapping")}</h3>
              <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs font-medium">
                <span>{t("columnName")}</span>
                <span>{t("type")}</span>
              </div>
              {columns.map((column, index) => (
                <div key={column.id} className="grid grid-cols-2 gap-2">
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
                    value={column.type}
                    disabled={pending || !!attempt}
                    onChange={(event) =>
                      setColumns(
                        columns.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                type: event.target.value as TableColumn["type"],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {TABLE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`types.${type}`)}
                      </option>
                    ))}
                  </select>
                  {column.type.includes("select") && (
                    // Hangs under the type that asked for it, in the same
                    // column, so the pair still reads as one mapping row now
                    // that the grid has headers.
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
                </div>
              ))}
              <div className="app-scrollbar bg-card overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-card-background">
                    <tr className="border-b">
                      {columns.map((column) => (
                        <th
                          className="h-10 px-2 text-start font-medium whitespace-nowrap"
                          key={column.id}
                        >
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csv.slice(1, 6).map((row, index) => (
                      <tr key={index}>
                        {row.map((value, i) => (
                          <td
                            className="max-w-48 truncate border-b p-2"
                            key={columns[i].id}
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("preview", { count: csv.length - 1 })}
              </p>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="min-w-0 break-words">{error}</span>
              </AlertDescription>
            </Alert>
          )}
          <p role="status" className="text-muted-foreground text-sm">
            {pending && csv.length
              ? t("importProgress", { count: progress })
              : null}
          </p>
        </div>
        <DialogFooter>
          {attempt?.tableId && (
            <Button
              variant="outline"
              onClick={() => router.push(`/drive/tables/${attempt.tableId}`)}
            >
              {t("openTable")}
            </Button>
          )}
          <Button disabled={pending} onClick={() => void handleCreate()}>
            {pending
              ? t("saving")
              : attempt?.tableId
                ? t("retry")
                : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
