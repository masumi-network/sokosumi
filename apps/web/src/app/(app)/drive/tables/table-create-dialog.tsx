"use client";
import {
  createDataTableSchema,
  parseTableCsv,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

import type { TableColumn } from "@/lib/clients/generated/core";
import { dataTableService } from "@/lib/services/data-table.client";
import { tableImportBatches } from "./table-import";
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
        <Button variant="outline">{t("newTable")}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
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
              className="bg-background rounded-md border px-3 py-2 text-sm"
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
            <Input
              id="table-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={pending || !!attempt}
              onChange={(event) => void handleCsv(event.target.files?.[0])}
            />
            <p className="text-muted-foreground text-sm">{t("csvLimit")}</p>
          </div>
          {columns.length > 0 && (
            <div className="grid gap-3">
              <h3 className="font-medium">{t("mapping")}</h3>
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
                    className="bg-background rounded-md border px-3 py-2 text-sm"
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
                    <Input
                      className="col-span-2"
                      disabled={pending || !!attempt}
                      aria-label={t("options")}
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
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th className="p-2 text-start" key={column.id}>
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
                            className="max-w-48 truncate border-t p-2"
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
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
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
