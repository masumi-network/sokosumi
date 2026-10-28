"use client";
import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DataTable,
  TableColumn,
  TableRow,
  TableView,
} from "@sokosumi/core-client";
import { encodeTableCsv } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clock,
  GripVertical,
  MoreHorizontal,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { DRIVE_SURFACE_PANEL_CLASS } from "@/app/drive/components/drive-view-layout";
import { ColumnResizeHandle } from "@/components/data-grid/column-resize-handle";
import {
  GRID_HEAD_CHROME,
  GRID_ROW_BACKGROUND,
  GRID_ROW_CHROME,
  GRID_ROW_NUMBER,
  GRID_SCROLL_CONTAINER,
  GRID_STICKY_FIRST_COLUMN,
  GRID_STICKY_ROW_NUMBER,
} from "@/components/data-grid/grid-classes";
import {
  fitGridColumn,
  ROW_NUMBER_WIDTH,
} from "@/components/data-grid/grid-layout";
import { useGridFocus } from "@/components/data-grid/use-grid-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow as TableRowShell,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { moveIdToSlot } from "@/lib/utils/move-id";
import { TableCell, TableUpdatedCell } from "./table-cell";
import { TableColumnDialog } from "./table-column-dialog";
import { cellWrap, columnWidth } from "./table-layout";
import { createTableMutations, isTableRejection } from "./table-mutations";
import {
  parseTableInput,
  tableError,
  tableHistoryText,
  tableValueText,
} from "./table-value";
import { useColumnLayout } from "./use-column-layout";

/**
 * Toolbar controls: 40px where a finger lands, and the 32px the Files toolbar
 * uses once there is a pointer. `Button size="sm"` keeps the small padding and
 * gap at both widths; only the height responds.
 *
 * Viewport queries and not the Files header row's container query, because
 * this route has **no `@container` ancestor** — `@md`/`@xl` would never fire
 * here. These controls also have no tab strip to stay level with: nothing in
 * this toolbar sets the height of a row something else is centred in, which is
 * what forces `DRIVE_HEADER_CONTROL_CLASS` onto a container query. Kept local
 * and separately named so the two are not swapped for one another.
 */
const EDITOR_TOOLBAR_CONTROL = "h-10 md:h-8";
const TOOLBAR_ICON_CONTROL = "size-10 md:size-8";

interface ReorderItem {
  kind: "column" | "row";
  id: string;
}

/** A row drag only lands on rows, a column drag only on columns. */
const sameKindCollision: CollisionDetection = (args) =>
  closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) =>
        container.data.current?.kind === args.active.data.current?.kind,
    ),
  });

/** A drag source and drop slot in one element; the drag starts on its handle. */
function Reorderable({
  item,
  disabled,
  children,
}: {
  item: ReorderItem;
  disabled: boolean;
  children: (state: {
    ref: (node: HTMLElement | null) => void;
    listeners: DraggableSyntheticListeners;
    isDragging: boolean;
    isOver: boolean;
  }) => ReactNode;
}) {
  const id = `${item.kind}:${item.id}`;
  const draggable = useDraggable({ id, data: item, disabled });
  const droppable = useDroppable({ id, data: item, disabled });
  const { setNodeRef: setDragRef } = draggable;
  const { setNodeRef: setDropRef } = droppable;
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  return children({
    ref,
    listeners: draggable.listeners,
    isDragging: draggable.isDragging,
    isOver: droppable.isOver && !draggable.isDragging,
  });
}

/** Drag by pointer; the arrow keys along `axis` are the keyboard path. */
function ReorderHandle({
  label,
  listeners,
  axis,
  onMove,
  className,
}: {
  className?: string;
  label: string;
  listeners: DraggableSyntheticListeners;
  axis: "x" | "y";
  onMove: (step: -1 | 1) => void;
}) {
  function handleKeyDown(event: KeyboardEvent) {
    const step =
      event.key === (axis === "x" ? "ArrowLeft" : "ArrowUp")
        ? -1
        : event.key === (axis === "x" ? "ArrowRight" : "ArrowDown")
          ? 1
          : 0;
    if (!step) return;
    event.preventDefault();
    onMove(step);
  }
  return (
    <button
      type="button"
      {...listeners}
      onKeyDown={handleKeyDown}
      aria-label={label}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring hit-area flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  );
}

/** One line, with a toggle only when the text is longer than that. */
function TableDescription({ text }: { text: string }) {
  const t = useTranslations("App.Tables");
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () =>
      setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);
  return (
    <div className="mt-1 max-w-2xl text-sm">
      <p
        ref={ref}
        id={id}
        className={cn("text-muted-foreground", !expanded && "line-clamp-1")}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="text-foreground hover:text-muted-foreground focus-visible:ring-ring mt-1 rounded-sm font-medium transition-colors outline-none focus-visible:ring-2"
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      )}
    </div>
  );
}

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
  if (!table.data)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p>{tableError(table.error, t)}</p>
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
  const [mutate] = useState(createTableMutations);
  const [editingRows, setEditingRows] = useState<
    Record<string, { row: TableRow; columns: string[] }>
  >({});
  const hasDrafts = Object.keys(editingRows).length > 0;
  function allowNavigation(
    ignoreCurrentMutation = false,
    completedSlot?: string,
  ) {
    if (
      (pending && !ignoreCurrentMutation) ||
      (retryAction && retrySlot !== completedSlot) ||
      mutate.hasPending() ||
      (enrichmentRequest && !taskId)
    ) {
      setError(t("errors.unresolved"));
      return false;
    }
    return !hasDrafts || window.confirm(t("discardDrafts"));
  }
  const [cursor, setCursor] = useQueryState("cursor");
  const [definition, setDefinition] = useState<TableView["definition"]>(
    view?.definition ?? { filters: [], sort: null, visibleColumnIds: [] },
  );
  const [filterDraft, setFilterDraft] = useState(
    tableValueText(view?.definition.filters?.[0]?.value ?? null),
  );
  const [archivedRows, setArchivedRows] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState<
    (() => Promise<unknown>) | null
  >(null);
  const [retrySlot, setRetrySlot] = useState<string>();
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
  useEffect(() => {
    // Read the pending state when a handler runs, not when the effect does.
    // `mutate.hasPending()` is not React state, so a request that goes
    // unresolved after the listeners are installed re-renders nothing, and a
    // captured boolean would let a link navigate away from a write that may
    // have committed. `allowNavigation` reads it live for the same reason.
    const isUnresolved = () =>
      pending ||
      !!retryAction ||
      mutate.hasPending() ||
      (!!enrichmentRequest && !taskId);
    if (!hasDrafts && !isUnresolved()) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function navigate(event: MouseEvent) {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      if (isUnresolved()) {
        event.preventDefault();
        event.stopPropagation();
        setError(t("errors.unresolved"));
      } else if (!window.confirm(t("discardDrafts"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigate, true);
    };
  }, [enrichmentRequest, hasDrafts, mutate, pending, retryAction, t, taskId]);
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
  const displayedRows = [...(rows.data?.rows ?? [])];
  for (const { row } of Object.values(editingRows))
    if (!displayedRows.some((item) => item.id === row.id))
      displayedRows.push(row);
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
  // A Last updated column holds no stored value: nothing to filter or fill.
  const writableColumns = table.columns.filter(
    (column) => column.type !== "last_updated",
  );
  const columnLayout = useColumnLayout(table);
  const columns = (
    definition.visibleColumnIds?.length
      ? table.columns.filter((column) =>
          definition.visibleColumnIds?.includes(column.id),
        )
      : table.columns
  ).map(columnLayout.withLayout);
  const gridWidth = columns.reduce(
    (total, column) => total + columnWidth(column),
    ROW_NUMBER_WIDTH,
  );
  const grid = useRef<HTMLTableElement>(null);
  const { gridId, cellProps } = useGridFocus(
    displayedRows.map((row) => row.id),
    columns.map((column) => column.id),
  );
  function handleFit(columnId: string) {
    const width = fitGridColumn(grid.current, columnId);
    if (width !== null) columnLayout.setWidth(columnId, width);
  }
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["table-rows", table.id] }),
      cache.invalidateQueries({ queryKey: ["data-table", table.id] }),
      cache.invalidateQueries({ queryKey: ["table-history", table.id] }),
    ]);
  }
  async function run(action: () => Promise<unknown>, slot?: string) {
    if (retryAction && action !== retryAction && slot !== retrySlot) {
      setError(t("errors.unresolved"));
      return;
    }
    setPending(true);
    setError("");
    try {
      await action();
      setRetryAction(null);
      setRetrySlot(undefined);
      await refresh();
    } catch (error) {
      // Capture the original action and render snapshot, never rebuild from polled props.
      const unresolved = slot ? mutate.isPending(slot) : false;
      setRetryAction((previous) => (unresolved ? (previous ?? action) : null));
      setRetrySlot((previous) => (unresolved ? (previous ?? slot) : undefined));
      setError(tableError(error, t));
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
    await mutate(
      `cell:${row.id}:${column.id}`,
      {
        patch: [{ id: row.id, version, values: { [column.id]: value } }],
      },
      (body) => dataTableService.batch(table.id, body),
    );
    await refresh();
  }
  const filterColumn = table.columns.find(
    (column) => column.id === definition.filters?.[0]?.columnId,
  );
  function filterDefinition(text: string): TableView["definition"] {
    const filter = definition.filters?.[0];
    if (!filter) return definition;
    const column = table.columns.find(
      (column) => column.id === filter.columnId,
    );
    if (!column) return definition;
    const value =
      filter.operator === "equals" ? parseTableInput(column, text) : text;
    return { ...definition, filters: [{ ...filter, value }] };
  }
  function handleFilterValue(text: string) {
    try {
      handleDefinition(filterDefinition(text));
      setError("");
    } catch (error) {
      setError(tableError(error, t));
    }
  }
  function handleDefinition(next: TableView["definition"]) {
    // Edited rows stay pinned; view changes must not hide their cells.
    if (
      hasDrafts &&
      next.visibleColumnIds?.length &&
      Object.values(editingRows).some((item) =>
        item.columns.some((id) => !next.visibleColumnIds?.includes(id)),
      )
    ) {
      setError(t("resolveDrafts"));
      return;
    }
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
          columns.map((column) =>
            column.type === "last_updated"
              ? new Date(row.updatedAt).toISOString()
              : row.values[column.id],
          ),
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
  // A sort or filter defines the order; archived rows have none to change.
  const canMoveRows =
    !definition.sort &&
    !definition.filters?.length &&
    !archivedRows &&
    !table.archivedAt;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const moveInFlight = useRef(false);
  /**
   * One move at a time: the next one needs the versions this one returns, so
   * it waits for the refresh. A failed move refreshes, undoing its preview.
   */
  async function runMove(
    slot: string,
    preview: () => void,
    send: () => Promise<unknown>,
  ) {
    if (moveInFlight.current || pending) return;
    if (retryAction) {
      setError(t("errors.unresolved"));
      return;
    }
    moveInFlight.current = true;
    preview();
    try {
      await run(async () => {
        try {
          await send();
        } catch (error) {
          await refresh();
          throw error;
        }
      }, slot);
    } finally {
      moveInFlight.current = false;
    }
  }
  async function handleColumnMove(columnId: string, overId: string) {
    const ids = table.columns.map((column) => column.id);
    const order = moveIdToSlot(ids, columnId, overId);
    if (order === ids) return;
    const next = order.flatMap(
      (id) => table.columns.find((column) => column.id === id) ?? [],
    );
    await runMove(
      "reorder",
      () =>
        cache.setQueriesData<DataTable>(
          { queryKey: ["data-table", table.id] },
          (previous) => previous && { ...previous, columns: next },
        ),
      () =>
        mutate("reorder", { version: table.version, columns: next }, (body) =>
          dataTableService.update(table.id, body),
        ),
    );
  }
  /** Steps among the visible columns, so a hidden one never absorbs a move. */
  function handleColumnStep(columnId: string, step: -1 | 1) {
    const index = columns.findIndex((column) => column.id === columnId);
    const neighbour = columns[index + step];
    if (neighbour) void handleColumnMove(columnId, neighbour.id);
  }
  async function handleRowMove(rowId: string, overId: string) {
    const page = rows.data?.rows ?? [];
    const row = page.find((item) => item.id === rowId);
    const ids = page.map((item) => item.id);
    const order = moveIdToSlot(ids, rowId, overId);
    if (!row || order === ids) return;
    const index = order.indexOf(rowId);
    // The page cursor is the last row of the page before, so a row dropped
    // first on a later page lands right after it, not at the top of the table.
    const afterRowId = index > 0 ? order[index - 1] : (cursor ?? null);
    await runMove(
      "move-row",
      () =>
        cache.setQueryData<typeof rows.data>(
          ["table-rows", table.id, definition, cursor, archivedRows],
          (previous) =>
            previous && {
              ...previous,
              rows: order.flatMap(
                (id) => previous.rows.find((item) => item.id === id) ?? [],
              ),
            },
        ),
      () =>
        mutate(
          "move-row",
          { patch: [{ id: row.id, version: row.version, afterRowId }] },
          (body) => dataTableService.batch(table.id, body),
        ),
    );
  }
  function handleRowStep(rowId: string, step: -1 | 1) {
    const page = rows.data?.rows ?? [];
    const neighbour = page[page.findIndex((row) => row.id === rowId) + step];
    if (neighbour) void handleRowMove(rowId, neighbour.id);
  }
  /** What a person calls the item: a column name or the row's first value. */
  function reorderLabel(data: unknown): string {
    const item = data as ReorderItem | undefined;
    if (item?.kind === "column")
      return (
        table.columns.find((column) => column.id === item.id)?.name ??
        t("unknown")
      );
    const row = displayedRows.find((row) => row.id === item?.id);
    const first = columns[0];
    return (row && first && tableValueText(row.values[first.id])) || t("row");
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("dnd.pickedUp", { item: reorderLabel(active.data.current) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dnd.over", {
            item: reorderLabel(active.data.current),
            target: reorderLabel(over.data.current),
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("dnd.dropped", {
            item: reorderLabel(active.data.current),
            target: reorderLabel(over.data.current),
          })
        : t("dnd.cancelled", { item: reorderLabel(active.data.current) }),
    onDragCancel: ({ active }) =>
      t("dnd.cancelled", { item: reorderLabel(active.data.current) }),
  };
  function handleDragStart({ active }: DragStartEvent) {
    setDragLabel(reorderLabel(active.data.current));
  }
  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragLabel(null);
    const from = active.data.current as ReorderItem | undefined;
    const to = over?.data.current as ReorderItem | undefined;
    if (!from || !to || from.kind !== to.kind || from.id === to.id) return;
    if (from.kind === "column") void handleColumnMove(from.id, to.id);
    else void handleRowMove(from.id, to.id);
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* The same labelled back affordance the project and task detail pages
      use. It stays at every width: the app chrome's chevron and the sidebar's
      Files row both go to `/drive`, which lands on Recents, so this link is the only
      route back to the Tables tab — and `display: none` would have taken it
      out of the accessibility tree on phones too. */}
      <Link
        href="/drive?view=tables"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden />
        <span>{t("backToFiles")}</span>
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-xl leading-tight font-semibold tracking-tight">
              {table.title}
            </h1>
            {/* Archived rows are a mode, not a filter chip you can miss. The
            only other cues are a shorter list and disabled inputs, which read
            as "this table is empty". */}
            {archivedRows && (
              <Badge variant="secondary">{t("archivedRowsBadge")}</Badge>
            )}
          </div>
          {table.description && <TableDescription text={table.description} />}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={EDITOR_TOOLBAR_CONTROL}
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
              <Button
                size="icon"
                variant="ghost"
                className={TOOLBAR_ICON_CONTROL}
                aria-label={t("tableMenu")}
              >
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
              <DropdownMenuSeparator />
              {/* A checkbox item, so assistive technology gets the mode too,
              and separated from the destructive table-level action below. */}
              <DropdownMenuCheckboxItem
                checked={archivedRows}
                onCheckedChange={() => {
                  setArchivedRows(!archivedRows);
                  setSelected([]);
                  void setCursor(null);
                }}
              >
                {t("showArchivedRows")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
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
          className={withEditableTextSize(
            "bg-background rounded-md border px-2",
            EDITOR_TOOLBAR_CONTROL,
          )}
          aria-label={t("view")}
          value={view?.id ?? ""}
          onChange={(event) => {
            if (!allowNavigation()) return;
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
        <Button
          size="sm"
          variant="outline"
          className={EDITOR_TOOLBAR_CONTROL}
          onClick={() => setDialog("views")}
        >
          {t("configureView")}
        </Button>
        <Button
          size="sm"
          className={EDITOR_TOOLBAR_CONTROL}
          disabled={pending || !!table.archivedAt}
          onClick={() =>
            void run(
              () =>
                mutate("add-row", { insert: [{ values: {} }] }, (body) =>
                  dataTableService.batch(table.id, body),
                ),
              "add-row",
            )
          }
        >
          <Plus aria-hidden className="size-4" />
          {t("addRow")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={EDITOR_TOOLBAR_CONTROL}
          disabled={!!table.archivedAt}
          onClick={() => setColumn("new")}
        >
          <Plus aria-hidden className="size-4" />
          {t("addColumn")}
        </Button>
        {/* Selection actions sit in their own trailing group so selecting a
        row cannot reflow the controls the pointer just left. */}
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 md:ms-auto">
            <span className="text-muted-foreground text-sm">
              {t("selected", { count: selected.length })}
            </span>
            <Button
              size="sm"
              className={EDITOR_TOOLBAR_CONTROL}
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
              size="sm"
              variant="outline"
              className={EDITOR_TOOLBAR_CONTROL}
              disabled={pending || !!table.archivedAt}
              onClick={() =>
                void run(async () => {
                  await mutate(
                    "archive-rows",
                    {
                      patch: (rows.data?.rows ?? [])
                        .filter((row) => selected.includes(row.id))
                        .map((row) => ({
                          id: row.id,
                          version: row.version,
                          archived: !archivedRows,
                        })),
                    },
                    (body) => dataTableService.batch(table.id, body),
                  );
                  setSelected([]);
                }, "archive-rows")
              }
            >
              {archivedRows ? t("restoreRows") : t("archiveRows")}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{error}</span>
            {retryAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void run(retryAction, retrySlot)}
              >
                {t("retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {rows.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">
              {tableError(rows.error, t)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void rows.refetch()}
            >
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div
        className={cn(DRIVE_SURFACE_PANEL_CLASS, "min-w-0")}
        style={
          {
            "--sheet-sticky": `${ROW_NUMBER_WIDTH + (columns[0] ? columnWidth(columns[0]) : 0)}px`,
          } as CSSProperties
        }
      >
        <DndContext
          sensors={sensors}
          collisionDetection={sameKindCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragLabel(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t("dnd.instructions") },
          }}
        >
          {/* Bounded to the viewport on both axes, so the horizontal scrollbar
          and the sticky header stay in reach on a tall table. Fixed layout:
          every column is exactly its saved width, whatever its content. The
          scroll padding keeps a focused cell clear of the sticky header and
          the sticky first columns. */}
          <Table
            ref={grid}
            role="grid"
            aria-describedby={`${gridId}-keys`}
            className="table-fixed border-separate border-spacing-0"
            style={{ width: gridWidth }}
            containerClassName={cn("max-h-[80dvh]", GRID_SCROLL_CONTAINER)}
          >
            <caption className="sr-only">{table.title}</caption>
            <colgroup>
              <col style={{ width: ROW_NUMBER_WIDTH }} />
              {columns.map((column) => (
                <col key={column.id} style={{ width: columnWidth(column) }} />
              ))}
            </colgroup>
            <TableHeader className="bg-card-background sticky top-0 z-20">
              <TableRowShell className="hover:bg-transparent">
                <TableHead className="bg-card-background sticky start-0 z-10 border-e border-b px-0">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      aria-label={t("selectAll")}
                      checked={
                        !rows.data?.rows.length || !selected.length
                          ? false
                          : selected.length === rows.data.rows.length
                            ? true
                            : "indeterminate"
                      }
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? (rows.data?.rows.map((row) => row.id) ?? [])
                            : [],
                        )
                      }
                    />
                  </div>
                </TableHead>
                {columns.map((column, columnIndex) => (
                  <Reorderable
                    key={column.id}
                    item={{ kind: "column", id: column.id }}
                    disabled={!!table.archivedAt || pending}
                  >
                    {({ ref, listeners, isDragging, isOver }) => (
                      <TableHead
                        ref={ref}
                        scope="col"
                        data-column={column.id}
                        className={cn(
                          "group/head bg-card-background relative border-e border-b ps-2 pe-3",
                          columnIndex === 0 && GRID_STICKY_FIRST_COLUMN,
                          isDragging && "opacity-50",
                          isOver && "bg-muted",
                        )}
                      >
                        <div className="relative flex min-w-0 items-center gap-1">
                          {column.type === "last_updated" && (
                            <Clock
                              aria-hidden
                              className="text-muted-foreground size-3.5 shrink-0"
                            />
                          )}
                          <span
                            data-fit
                            className="text-muted-foreground min-w-0 flex-1 truncate"
                            title={column.description || column.name}
                          >
                            {column.name}
                          </span>
                          {/* Over the end of the name with a pointer, where it
                          shows only on hover; beside it on touch, where it
                          always shows. */}
                          <div
                            className={cn(
                              "bg-card-background flex shrink-0 items-center pointer-fine:absolute pointer-fine:inset-y-0 pointer-fine:end-0",
                              GRID_HEAD_CHROME,
                            )}
                          >
                            {!table.archivedAt && (
                              <ReorderHandle
                                label={t("reorderColumn", {
                                  column: column.name,
                                })}
                                listeners={listeners}
                                axis="x"
                                onMove={(step) =>
                                  handleColumnStep(column.id, step)
                                }
                              />
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground size-10 shrink-0 md:size-8"
                                  aria-label={t("columnMenu", {
                                    column: column.name,
                                  })}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem
                                  onClick={() => setColumn(column)}
                                >
                                  {t("editColumn")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleColumnStep(column.id, -1)
                                  }
                                >
                                  {t("moveLeft")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleColumnStep(column.id, 1)}
                                >
                                  {t("moveRight")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleDefinition({
                                      ...definition,
                                      sort: {
                                        columnId: column.id,
                                        direction: "asc",
                                      },
                                    })
                                  }
                                >
                                  {t("sortAscending")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleDefinition({
                                      ...definition,
                                      sort: {
                                        columnId: column.id,
                                        direction: "desc",
                                      },
                                    })
                                  }
                                >
                                  {t("sortDescending")}
                                </DropdownMenuItem>
                                {!table.archivedAt && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuCheckboxItem
                                      checked={cellWrap(column) !== "clip"}
                                      onCheckedChange={(checked) =>
                                        columnLayout.setWrap(column.id, checked)
                                      }
                                    >
                                      {t("wrapText")}
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuItem
                                      onClick={() => handleFit(column.id)}
                                    >
                                      {t("fitColumn")}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {!table.archivedAt && (
                          <ColumnResizeHandle
                            label={t("resizeColumn", { column: column.name })}
                            width={columnWidth(column)}
                            onPreview={(width) =>
                              columnLayout.preview(column.id, width)
                            }
                            onResize={(width) =>
                              columnLayout.setWidth(column.id, width)
                            }
                            onFit={() => handleFit(column.id)}
                          />
                        )}
                      </TableHead>
                    )}
                  </Reorderable>
                ))}
              </TableRowShell>
            </TableHeader>
            <TableBody>
              {displayedRows.map((row, rowIndex) => (
                <Reorderable
                  key={row.id}
                  item={{ kind: "row", id: row.id }}
                  disabled={!canMoveRows || pending}
                >
                  {({ ref, listeners, isDragging, isOver }) => (
                    <TableRowShell
                      ref={ref}
                      className={cn(
                        "group/row hover:bg-card-background-hover",
                        isDragging && "opacity-50",
                        isOver && "bg-muted",
                      )}
                      data-state={
                        selected.includes(row.id) ? "selected" : undefined
                      }
                    >
                      <th
                        scope="row"
                        className={cn(
                          GRID_ROW_BACKGROUND,
                          GRID_STICKY_ROW_NUMBER,
                          "border-e border-b p-0 align-top font-normal",
                        )}
                      >
                        <div className="relative h-8">
                          <span
                            className={cn(
                              "text-muted-foreground absolute inset-0 flex items-center justify-center text-xs tabular-nums",
                              selected.length ? "opacity-0" : GRID_ROW_NUMBER,
                            )}
                          >
                            {rowIndex + 1}
                          </span>
                          <div
                            className={cn(
                              "absolute inset-0 flex items-center justify-center gap-1",
                              !selected.length && GRID_ROW_CHROME,
                            )}
                          >
                            {canMoveRows ? (
                              <ReorderHandle
                                label={t("reorderRow")}
                                listeners={listeners}
                                axis="y"
                                onMove={(step) => handleRowStep(row.id, step)}
                              />
                            ) : (
                              <span aria-hidden className="size-7 shrink-0" />
                            )}
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
                          </div>
                        </div>
                      </th>
                      {columns.map((column, columnIndex) => {
                        const grid = {
                          ...cellProps(rowIndex, columnIndex),
                          className:
                            columnIndex === 0
                              ? cn(
                                  GRID_ROW_BACKGROUND,
                                  GRID_STICKY_FIRST_COLUMN,
                                )
                              : undefined,
                        };
                        return column.type === "last_updated" ? (
                          <TableUpdatedCell
                            key={column.id}
                            {...grid}
                            row={row}
                            columnId={column.id}
                          />
                        ) : (
                          <TableCell
                            key={column.id}
                            {...grid}
                            column={column}
                            row={row}
                            onEditingChange={(editing) =>
                              setEditingRows((previous) => {
                                const next = { ...previous };
                                const columns = new Set(
                                  next[row.id]?.columns ?? [],
                                );
                                if (editing) columns.add(column.id);
                                else columns.delete(column.id);
                                if (columns.size)
                                  next[row.id] = {
                                    row: next[row.id]?.row ?? row,
                                    columns: [...columns],
                                  };
                                else delete next[row.id];
                                return next;
                              })
                            }
                            disabled={!!table.archivedAt || !!row.archivedAt}
                            onSave={(version, value) =>
                              handleCell(row, column, version, value)
                            }
                            onHistory={() => {
                              setHistoryCursor(undefined);
                              setHistoryCell({
                                rowId: row.id,
                                columnId: column.id,
                              });
                              setDialog("history");
                            }}
                          />
                        );
                      })}
                    </TableRowShell>
                  )}
                </Reorderable>
              ))}
            </TableBody>
          </Table>
          <p id={`${gridId}-keys`} hidden>
            {t("gridKeys")}
          </p>
          <DragOverlay dropAnimation={null}>
            {dragLabel !== null && (
              <div className="bg-background max-w-64 cursor-grabbing truncate rounded-md border px-3 py-1.5 text-sm shadow-md">
                {dragLabel}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {rows.isPending ? (
          <p role="status" className="p-6 text-sm">
            {t("loading")}
          </p>
        ) : (
          !displayedRows.length && (
            <p className="text-muted-foreground p-8 text-center text-sm">
              {t("noRows")}
            </p>
          )
        )}
        {/* Pagination and the live-update note belong to the grid, so they
        ride inside its surface the way every other table in the app does. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
          <p role="status" className="text-muted-foreground text-xs">
            {t("liveUpdates")}
          </p>
          <div className="flex gap-2">
            {cursor && (
              <Button
                size="sm"
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
                size="sm"
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
        <DialogContent className="app-scrollbar max-h-[85dvh] overflow-y-auto sm:max-w-xl">
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
                  className={withEditableTextSize(
                    "bg-background h-10 rounded-md border px-3",
                  )}
                  value={definition.filters?.[0]?.columnId ?? ""}
                  onChange={(event) => {
                    setFilterDraft("");
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
                    });
                  }}
                >
                  <option value="">{t("noFilter")}</option>
                  {writableColumns.map((column) => (
                    <option value={column.id} key={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
                {definition.filters?.[0] && (
                  <>
                    <select
                      aria-label={t("operator")}
                      className={withEditableTextSize(
                        "bg-background h-10 rounded-md border px-3",
                      )}
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
                    {filterColumn?.type === "single_select" ||
                    filterColumn?.type === "multiple_select" ? (
                      // Options are a closed set, so pick one rather than type
                      // text that may match nothing.
                      <select
                        aria-label={t("filterValue")}
                        className={withEditableTextSize(
                          "bg-background h-10 rounded-md border px-3",
                        )}
                        value={filterDraft}
                        onChange={(event) => {
                          setFilterDraft(event.target.value);
                          handleFilterValue(event.target.value);
                        }}
                      >
                        <option value="">{t("anyOption")}</option>
                        {filterColumn.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        aria-label={t("filterValue")}
                        value={filterDraft}
                        onChange={(event) => setFilterDraft(event.target.value)}
                        onBlur={() => handleFilterValue(filterDraft)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter")
                            handleFilterValue(filterDraft);
                        }}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">{t("sort")}</span>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground min-w-0 text-sm">
                    {definition.sort
                      ? t("sortedBy", {
                          column:
                            table.columns.find(
                              (column) =>
                                column.id === definition.sort?.columnId,
                            )?.name ?? t("unknown"),
                          direction:
                            definition.sort.direction === "asc"
                              ? t("ascending")
                              : t("descending"),
                        })
                      : t("noSort")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!definition.sort}
                    onClick={() =>
                      handleDefinition({ ...definition, sort: null })
                    }
                  >
                    {t("clearSort")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {dialog === "history" && (
            <div className="space-y-4">
              {history.isPending && <p role="status">{t("loading")}</p>}
              {history.error && (
                <p role="alert">{tableError(history.error, t)}</p>
              )}
              {history.data?.items.length === 0 && <p>{t("noHistory")}</p>}
              {history.data?.items.map((change) => (
                <article
                  key={change.id}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground min-w-0 truncate">
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
                        void run(
                          () =>
                            mutate(
                              `undo:${change.batchId}`,
                              { batchId: change.batchId },
                              (body) =>
                                dataTableService.undo(
                                  table.id,
                                  body.batchId,
                                  body.key,
                                ),
                            ),
                          `undo:${change.batchId}`,
                        )
                      }
                    >
                      {t("undoBatch")}
                    </Button>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">{t("before")}</dt>
                    <dd className="min-w-0 break-words text-sm">
                      {tableHistoryText(change.before, {
                        archived: t("archived"),
                        active: t("active"),
                        row: t("row"),
                        unknown: t("unknown"),
                        yes: t("yes"),
                        no: t("no"),
                        position: t("previousPosition"),
                      })}
                    </dd>
                    <dt className="text-muted-foreground">{t("after")}</dt>
                    <dd className="min-w-0 break-words text-sm">
                      {tableHistoryText(change.after, {
                        archived: t("archived"),
                        active: t("active"),
                        row: t("row"),
                        unknown: t("unknown"),
                        yes: t("yes"),
                        no: t("no"),
                        position: t("newPosition"),
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
                  className={withEditableTextSize(
                    "bg-background h-10 rounded-md border px-3",
                  )}
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
                {writableColumns.map((column) => (
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
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words">{error}</span>
                {retryAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void run(retryAction, retrySlot)}
                  >
                    {t("retry")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {dialog !== "history" && (
            <DialogFooter>
              <Button
                disabled={dialog === "enrich" && !!taskId}
                loading={pending}
                onClick={() =>
                  void run(
                    async () => {
                      if (dialog === "views") {
                        const saved = await mutate(
                          "save-view",
                          {
                            id: view?.id,
                            version: viewVersion,
                            name: viewName,
                            definition: filterDefinition(filterDraft),
                          },
                          (body) => dataTableService.view(table.id, body),
                        );
                        setViewVersion(saved.version);
                        // Selecting the view remounts this workspace keyed on
                        // the view ID, and the remount seeds its definition
                        // from the table query. Refresh that query first, or a
                        // just-saved view reopens with the default definition
                        // and silently drops its filters and hidden columns.
                        await refresh();
                        if (allowNavigation(true, "save-view"))
                          onViewChange(saved.id);
                      } else if (dialog === "rename")
                        await mutate(
                          "rename",
                          { version: renameVersion, title },
                          (body) => dataTableService.update(table.id, body),
                        );
                      else if (dialog === "archive")
                        await mutate(
                          "archive",
                          {
                            version: table.version,
                            archived: !table.archivedAt,
                          },
                          (body) => dataTableService.update(table.id, body),
                        );
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
                        if (
                          !request.prompt.trim() ||
                          request.prompt.trim().length > 4000 ||
                          !request.columnIds.length ||
                          !request.rowIds.length ||
                          !(request.assigneeId || request.assigneeSokoBotId)
                        )
                          throw new Error(t("enrichmentRequired"));
                        setEnrichmentRequest(request);
                        const result = await mutate(
                          enrichmentKey,
                          request,
                          (body) => dataTableService.enrich(table.id, body),
                        ).catch((error: unknown) => {
                          if (isTableRejection(error)) {
                            setEnrichmentRequest(undefined);
                            setEnrichmentKey(crypto.randomUUID());
                          }
                          throw error;
                        });
                        setTaskId(result.taskId);
                        return;
                      }
                      setDialog(null);
                    },
                    dialog === "views"
                      ? "save-view"
                      : dialog === "rename"
                        ? "rename"
                        : dialog === "archive"
                          ? "archive"
                          : dialog === "enrich"
                            ? enrichmentKey
                            : undefined,
                  )
                }
              >
                {dialog === "enrich" ? t("createTask") : t("save")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
