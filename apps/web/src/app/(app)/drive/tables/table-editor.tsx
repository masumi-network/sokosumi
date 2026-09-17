"use client";
import { encodeTableCsv } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import type {
  DataTable,
  TableColumn,
  TableRow,
  TableView,
} from "@/lib/clients/generated/core";
import { dataTableService } from "@/lib/services/data-table.client";
import { TableCell } from "./table-cell";
import { TableColumnDialog } from "./table-column-dialog";
import {
  parseTableInput,
  tableError,
  tableHistoryText,
  tableValueText,
} from "./table-value";

export function TableEditor({ id }: { id: string }) {
  const t = useTranslations("App.Tables");
  const { data: session } = useSession();
  const workspaceId = session?.session.activeOrganizationId ?? null;
  const table = useQuery({
    enabled: !!session,
    queryKey: ["data-table", id, workspaceId],
    queryFn: () => dataTableService.get(id),
    refetchInterval: 5000,
  });
  const [viewId, setViewId] = useQueryState("view");
  if (!session || table.isPending)
    return (
      <p role="status" className="p-6 text-sm">
        {t("loading")}
      </p>
    );
  if (table.error || !table.data)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p>{tableError(table.error)}</p>
        <Button onClick={() => void table.refetch()}>{t("retry")}</Button>
      </div>
    );
  const view = table.data.views.find((view) => view.id === viewId);
  return (
    <TableWorkspace
      key={`${workspaceId}:${id}:${viewId ?? "default"}`}
      table={table.data}
      view={view}
      onViewChange={(id) => void setViewId(id)}
    />
  );
}
function TableWorkspace({
  table,
  view,
  onViewChange,
}: {
  table: DataTable;
  view?: TableView;
  onViewChange: (id: string | null) => void;
}) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const cache = useQueryClient();
  const [cursor, setCursor] = useQueryState("cursor");
  const [definition, setDefinition] = useState<TableView["definition"]>(
    view?.definition ?? { filters: [], sort: null, visibleColumnIds: [] },
  );
  const [archivedRows, setArchivedRows] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [column, setColumn] = useState<TableColumn | "new" | null>(null);
  const [dialog, setDialog] = useState<
    "views" | "history" | "enrich" | "rename" | "archive" | null
  >(null);
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [historyCell, setHistoryCell] = useState<{
    rowId?: string;
    columnId?: string;
  }>({});
  const [viewVersion, setViewVersion] = useState(view?.version);
  const [renameVersion, setRenameVersion] = useState(table.version);
  const [viewName, setViewName] = useState(view?.name ?? "");
  const [title, setTitle] = useState(table.title);
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState("");
  const [outputs, setOutputs] = useState<string[]>([]);
  const [enrichmentKey, setEnrichmentKey] = useState(() => crypto.randomUUID());
  const [enrichmentRequest, setEnrichmentRequest] =
    useState<Parameters<typeof dataTableService.enrich>[1]>();
  const [taskId, setTaskId] = useState<string | null>(null);
  const rows = useQuery({
    queryKey: ["table-rows", table.id, definition, cursor, archivedRows],
    queryFn: () =>
      dataTableService.query(table.id, {
        ...definition,
        cursor: cursor ?? undefined,
        limit: 50,
        archived: archivedRows,
      }),
    refetchInterval: 3000,
  });
  const history = useQuery({
    queryKey: ["table-history", table.id, historyCell, historyCursor],
    queryFn: () =>
      dataTableService.history(table.id, {
        ...historyCell,
        cursor: historyCursor,
      }),
    enabled: dialog === "history",
  });
  const agents = useQuery({
    queryKey: ["table-agent-options", table.workspaceId],
    queryFn: () => dataTableService.agents(),
    enabled: dialog === "enrich",
  });
  const columns = definition.visibleColumnIds?.length
    ? table.columns.filter((column) =>
        definition.visibleColumnIds?.includes(column.id),
      )
    : table.columns;
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["table-rows", table.id] }),
      cache.invalidateQueries({ queryKey: ["data-table", table.id] }),
      cache.invalidateQueries({ queryKey: ["table-history", table.id] }),
    ]);
  }
  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(tableError(error));
    } finally {
      setPending(false);
    }
  }
  async function handleCell(
    row: TableRow,
    column: TableColumn,
    version: number,
    value: TableRow["values"][string],
  ) {
    await dataTableService.batch(table.id, {
      key: crypto.randomUUID(),
      patch: [{ id: row.id, version, values: { [column.id]: value } }],
    });
    await refresh();
  }
  function handleFilterValue(text: string) {
    const filter = definition.filters?.[0];
    if (!filter) return;
    const column = table.columns.find(
      (column) => column.id === filter.columnId,
    );
    if (!column) return;
    try {
      const value =
        filter.operator === "equals" ? parseTableInput(column, text) : text;
      handleDefinition({ ...definition, filters: [{ ...filter, value }] });
      setError("");
    } catch (error) {
      setError(tableError(error));
    }
  }
  function handleDefinition(next: TableView["definition"]) {
    setDefinition(next);
    void setCursor(null);
    setSelected([]);
  }
  async function handleExport() {
    const output: unknown[][] = [columns.map((column) => column.name)];
    let next: string | undefined;
    do {
      const page = await dataTableService.query(table.id, {
        ...definition,
        limit: 100,
        cursor: next,
        archived: archivedRows,
      });
      output.push(
        ...page.rows.map((row) =>
          columns.map((column) => row.values[column.id]),
        ),
      );
      next = page.nextCursor ?? undefined;
      if (output.length > 10001) throw new Error(t("exportLimit"));
    } while (next);
    const url = URL.createObjectURL(
      new Blob([encodeTableCsv(output)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table.title}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function handleReorder(index: number, direction: number) {
    const next = [...table.columns];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    await run(() =>
      dataTableService.update(table.id, {
        key: crypto.randomUUID(),
        version: table.version,
        columns: next,
      }),
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/drive?view=tables" aria-label={t("backToFiles")}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{table.title}</h1>
            {table.description && (
              <p className="text-muted-foreground max-w-2xl text-sm">
                {table.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setHistoryCursor(undefined);
              setHistoryCell({});
              setDialog("history");
            }}
          >
            {t("history")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("tableMenu")}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setTitle(table.title);
                  setRenameVersion(table.version);
                  setDialog("rename");
                }}
              >
                {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void run(handleExport)}>
                {t("exportCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("archive")}>
                {table.archivedAt ? t("restore") : t("archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {table.archivedAt && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {t("archivedNotice")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="bg-background rounded-md border px-3 py-2 text-sm"
          aria-label={t("view")}
          value={view?.id ?? ""}
          onChange={(event) => {
            void setCursor(null);
            onViewChange(event.target.value || null);
          }}
        >
          <option value="">{t("allRows")}</option>
          {table.views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setDialog("views")}>
          {t("configureView")}
        </Button>
        <Button
          variant="outline"
          disabled={pending || !!table.archivedAt}
          onClick={() =>
            void run(() =>
              dataTableService.batch(table.id, {
                key: crypto.randomUUID(),
                insert: [{ values: {} }],
              }),
            )
          }
        >
          <Plus aria-hidden className="size-4" />
          {t("addRow")}
        </Button>
        <Button
          variant="outline"
          disabled={!!table.archivedAt}
          onClick={() => setColumn("new")}
        >
          {t("addColumn")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setArchivedRows(!archivedRows);
            setSelected([]);
            void setCursor(null);
          }}
        >
          {archivedRows ? t("showActive") : t("showArchived")}
        </Button>
        {selected.length > 0 && (
          <>
            <span className="text-muted-foreground text-sm">
              {t("selected", { count: selected.length })}
            </span>
            <Button
              disabled={!!table.archivedAt}
              onClick={() => {
                setEnrichmentKey(crypto.randomUUID());
                setEnrichmentRequest(undefined);
                setTaskId(null);
                setDialog("enrich");
              }}
            >
              <Sparkles aria-hidden className="size-4" />
              {t("askAgent")}
            </Button>
            <Button
              variant="outline"
              disabled={pending || !!table.archivedAt}
              onClick={() =>
                void run(async () => {
                  await dataTableService.batch(table.id, {
                    key: crypto.randomUUID(),
                    patch: (rows.data?.rows ?? [])
                      .filter((row) => selected.includes(row.id))
                      .map((row) => ({
                        id: row.id,
                        version: row.version,
                        archived: !archivedRows,
                      })),
                  });
                  setSelected([]);
                })
              }
            >
              {archivedRows ? t("restoreRows") : t("archiveRows")}
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {rows.error && (
        <p role="alert" className="text-destructive text-sm">
          {tableError(rows.error)}{" "}
          <Button onClick={() => void rows.refetch()}>{t("retry")}</Button>
        </p>
      )}
      <div className="max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{table.title}</caption>
          <thead className="bg-muted">
            <tr>
              <th className="w-12 p-3">
                <Checkbox
                  aria-label={t("selectAll")}
                  checked={
                    !!rows.data?.rows.length &&
                    selected.length === rows.data.rows.length
                  }
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? (rows.data?.rows.map((row) => row.id) ?? [])
                        : [],
                    )
                  }
                />
              </th>
              {columns.map((column) => (
                <th
                  scope="col"
                  className="min-w-48 border-s px-2 py-1 text-start font-medium"
                  key={column.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span title={column.description}>{column.name}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("columnMenu", { column: column.name })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setColumn(column)}>
                          {t("editColumn")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void handleReorder(
                              table.columns.findIndex(
                                (item) => item.id === column.id,
                              ),
                              -1,
                            )
                          }
                        >
                          {t("moveLeft")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void handleReorder(
                              table.columns.findIndex(
                                (item) => item.id === column.id,
                              ),
                              1,
                            )
                          }
                        >
                          {t("moveRight")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            handleDefinition({
                              ...definition,
                              sort: { columnId: column.id, direction: "asc" },
                            })
                          }
                        >
                          {t("sortAscending")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            handleDefinition({
                              ...definition,
                              sort: { columnId: column.id, direction: "desc" },
                            })
                          }
                        >
                          {t("sortDescending")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data?.rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  <Checkbox
                    aria-label={t("selectRow")}
                    checked={selected.includes(row.id)}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? [...selected, row.id]
                          : selected.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                {columns.map((column) => (
                  <td key={column.id} className="border-s p-1 align-top">
                    <TableCell
                      column={column}
                      row={row}
                      disabled={!!table.archivedAt || !!row.archivedAt}
                      onSave={(version, value) =>
                        handleCell(row, column, version, value)
                      }
                      onHistory={() => {
                        setHistoryCursor(undefined);
                        setHistoryCell({ rowId: row.id, columnId: column.id });
                        setDialog("history");
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.isPending ? (
          <p role="status" className="p-6 text-sm">
            {t("loading")}
          </p>
        ) : (
          !rows.data?.rows.length && (
            <p className="text-muted-foreground p-8 text-center text-sm">
              {t("noRows")}
            </p>
          )
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-muted-foreground text-xs">
          {t("liveUpdates")}
        </p>
        <div className="flex gap-2">
          {cursor && (
            <Button
              variant="outline"
              onClick={() => {
                void setCursor(null);
                setSelected([]);
              }}
            >
              {t("firstPage")}
            </Button>
          )}
          {rows.data?.nextCursor && (
            <Button
              variant="outline"
              onClick={() => {
                void setCursor(rows.data?.nextCursor ?? null);
                setSelected([]);
              }}
            >
              {t("nextPage")}
            </Button>
          )}
        </div>
      </div>
      {column && (
        <TableColumnDialog
          table={table}
          column={column === "new" ? undefined : column}
          onClose={() => setColumn(null)}
          onSaved={() => void refresh()}
        />
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {dialog === "views"
                ? t("configureView")
                : dialog === "history"
                  ? t("history")
                  : dialog === "enrich"
                    ? t("askAgent")
                    : dialog === "rename"
                      ? t("rename")
                      : table.archivedAt
                        ? t("restore")
                        : t("archive")}
            </DialogTitle>
            <DialogDescription>
              {dialog === "enrich"
                ? t("enrichDescription")
                : dialog === "history"
                  ? t("historyDescription")
                  : dialog === "archive"
                    ? t("archiveDescription")
                    : t("tableSettings")}
            </DialogDescription>
          </DialogHeader>
          {dialog === "rename" && (
            <div className="grid gap-2">
              <Label htmlFor="rename-table">{t("title")}</Label>
              <Input
                id="rename-table"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          )}
          {dialog === "views" && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="view-name">{t("viewName")}</Label>
                <Input
                  id="view-name"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                />
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">
                  {t("visibleColumns")}
                </legend>
                {table.columns.map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={columns.some((item) => item.id === column.id)}
                      disabled={
                        columns.length === 1 && columns[0].id === column.id
                      }
                      onCheckedChange={(checked) =>
                        handleDefinition({
                          ...definition,
                          visibleColumnIds: checked
                            ? [...columns.map((item) => item.id), column.id]
                            : columns
                                .filter((item) => item.id !== column.id)
                                .map((item) => item.id),
                        })
                      }
                    />
                    {column.name}
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor="filter-column">{t("filter")}</Label>
                <select
                  id="filter-column"
                  className="bg-background rounded-md border p-2 text-sm"
                  value={definition.filters?.[0]?.columnId ?? ""}
                  onChange={(event) =>
                    handleDefinition({
                      ...definition,
                      filters: event.target.value
                        ? [
                            {
                              columnId: event.target.value,
                              operator: "contains",
                              value: "",
                            },
                          ]
                        : [],
                    })
                  }
                >
                  <option value="">{t("noFilter")}</option>
                  {table.columns.map((column) => (
                    <option value={column.id} key={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
                {definition.filters?.[0] && (
                  <>
                    <select
                      aria-label={t("operator")}
                      className="bg-background rounded-md border p-2 text-sm"
                      value={definition.filters[0].operator}
                      onChange={(event) =>
                        handleDefinition({
                          ...definition,
                          filters: [
                            {
                              ...definition.filters![0],
                              operator: event.target.value as
                                | "contains"
                                | "equals"
                                | "empty",
                            },
                          ],
                        })
                      }
                    >
                      <option value="contains">{t("contains")}</option>
                      <option value="equals">{t("equals")}</option>
                      <option value="empty">{t("isEmpty")}</option>
                    </select>
                    <Input
                      aria-label={t("filterValue")}
                      value={tableValueText(
                        definition.filters[0].value ?? null,
                      )}
                      onChange={(event) =>
                        handleFilterValue(event.target.value)
                      }
                    />
                  </>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => handleDefinition({ ...definition, sort: null })}
              >
                {t("clearSort")}
              </Button>
            </div>
          )}
          {dialog === "history" && (
            <div className="space-y-4">
              {history.isPending && <p role="status">{t("loading")}</p>}
              {history.error && <p role="alert">{tableError(history.error)}</p>}
              {history.data?.items.length === 0 && <p>{t("noHistory")}</p>}
              {history.data?.items.map((change) => (
                <article
                  key={change.id}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {change.actorName ?? change.actorKind} ·{" "}
                      {format.dateTime(
                        new Date(change.createdAt),
                        "dateTimeShort",
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || !change.rowId}
                      onClick={() =>
                        void run(() =>
                          dataTableService.undo(
                            table.id,
                            change.batchId,
                            crypto.randomUUID(),
                          ),
                        )
                      }
                    >
                      {t("undoBatch")}
                    </Button>
                  </div>
                  <dl className="mt-2 grid gap-1">
                    <dt className="text-muted-foreground">{t("before")}</dt>
                    <dd className="break-words text-sm">
                      {tableHistoryText(change.before, {
                        archived: t("archived"),
                        active: t("active"),
                        row: t("row"),
                        unknown: t("unknown"),
                        yes: t("yes"),
                        no: t("no"),
                      })}
                    </dd>
                    <dt className="text-muted-foreground">{t("after")}</dt>
                    <dd className="break-words text-sm">
                      {tableHistoryText(change.after, {
                        archived: t("archived"),
                        active: t("active"),
                        row: t("row"),
                        unknown: t("unknown"),
                        yes: t("yes"),
                        no: t("no"),
                      })}
                    </dd>
                  </dl>
                  {Array.isArray(change.evidence) &&
                    change.evidence.map((source, index) =>
                      source &&
                      typeof source === "object" &&
                      "url" in source &&
                      typeof source.url === "string" &&
                      /^https?:\/\//.test(source.url) ? (
                        <a
                          key={index}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block break-all underline"
                        >
                          {source.url}
                        </a>
                      ) : null,
                    )}
                  {change.taskId && (
                    <Link
                      className="mt-2 block underline"
                      href={`/tasks/${change.taskId}`}
                    >
                      {t("openTask")}
                    </Link>
                  )}
                </article>
              ))}
              <div className="flex gap-2">
                {historyCursor && (
                  <Button
                    variant="outline"
                    onClick={() => setHistoryCursor(undefined)}
                  >
                    {t("firstPage")}
                  </Button>
                )}
                {history.data?.nextCursor && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setHistoryCursor(history.data?.nextCursor ?? undefined)
                    }
                  >
                    {t("nextPage")}
                  </Button>
                )}
              </div>
            </div>
          )}
          {dialog === "enrich" && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="table-prompt">{t("instruction")}</Label>
                <Textarea
                  id="table-prompt"
                  disabled={pending || !!enrichmentRequest}
                  value={prompt}
                  placeholder={t("promptExample")}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="table-agent">{t("agent")}</Label>
                <select
                  id="table-agent"
                  disabled={pending || !!enrichmentRequest}
                  className="bg-background rounded-md border p-2 text-sm"
                  value={agent}
                  onChange={(event) => setAgent(event.target.value)}
                >
                  <option value="">{t("chooseAgent")}</option>
                  {agents.data?.bot && (
                    <option value={`bot:${agents.data.bot.id}`}>
                      {agents.data.bot.name}
                    </option>
                  )}
                  {agents.data?.coworkers.map((coworker) => (
                    <option key={coworker.id} value={`coworker:${coworker.id}`}>
                      {coworker.name}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">
                  {t("outputColumns")}
                </legend>
                {table.columns.map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={outputs.includes(column.id)}
                      disabled={pending || !!enrichmentRequest}
                      onCheckedChange={(checked) =>
                        setOutputs(
                          checked
                            ? [...outputs, column.id]
                            : outputs.filter((id) => id !== column.id),
                        )
                      }
                    />
                    {column.name}
                  </label>
                ))}
              </fieldset>
              {taskId && (
                <Link className="underline" href={`/tasks/${taskId}`}>
                  {t("openTask")}
                </Link>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {dialog !== "history" && (
            <DialogFooter>
              <Button
                disabled={pending || (dialog === "enrich" && !!taskId)}
                onClick={() =>
                  void run(async () => {
                    if (dialog === "views") {
                      const saved = await dataTableService.view(table.id, {
                        key: crypto.randomUUID(),
                        id: view?.id,
                        version: viewVersion,
                        name: viewName,
                        definition,
                      });
                      setViewVersion(saved.version);
                      onViewChange(saved.id);
                    } else if (dialog === "rename")
                      await dataTableService.update(table.id, {
                        key: crypto.randomUUID(),
                        version: renameVersion,
                        title,
                      });
                    else if (dialog === "archive")
                      await dataTableService.update(table.id, {
                        key: crypto.randomUUID(),
                        version: table.version,
                        archived: !table.archivedAt,
                      });
                    else if (dialog === "enrich") {
                      const [kind, id] = agent.split(":");
                      const request = enrichmentRequest ?? {
                        key: enrichmentKey,
                        prompt,
                        rowIds: selected,
                        columnIds: outputs,
                        ...(kind === "bot"
                          ? { assigneeSokoBotId: id }
                          : { assigneeId: id }),
                      };
                      setEnrichmentRequest(request);
                      const result = await dataTableService.enrich(
                        table.id,
                        request,
                      );
                      setTaskId(result.taskId);
                      return;
                    }
                    setDialog(null);
                  })
                }
              >
                {pending
                  ? t("saving")
                  : dialog === "enrich"
                    ? t("createTask")
                    : t("save")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
