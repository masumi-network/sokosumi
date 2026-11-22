"use client";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
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
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dataTableService } from "@/lib/services/data-table.client";
import { cn } from "@/lib/utils";
import {
  boardLanes,
  type BoardLane as Lane,
  type BoardValue as Value,
} from "./table-board-lanes";
import { tableValueText } from "./table-value";

/** Rows a board loads at most; past this it says so instead of hiding work. */
const BOARD_ROW_LIMIT = 500;
const PAGE_SIZE = 100;
/**
 * A full board is up to five page reads, so it polls far less often than the
 * grid's one page; a move refreshes it at once.
 */
const BOARD_POLL_MS = 15_000;

async function loadBoardRows(
  tableId: string,
  definition: TableView["definition"],
) {
  const rows: TableRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await dataTableService.query(tableId, {
      ...definition,
      limit: PAGE_SIZE,
      cursor,
      archived: false,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < BOARD_ROW_LIMIT);
  return { rows, truncated: !!cursor };
}

export function TableBoard({
  table,
  column,
  columns,
  definition,
  readOnly = false,
  onMove,
}: {
  table: Pick<DataTable, "id">;
  /** The single-select column the lanes come from. */
  column: TableColumn;
  /** Visible columns, in order: the first other one titles each card. */
  columns: TableColumn[];
  definition: TableView["definition"];
  readOnly?: boolean;
  onMove: (row: TableRow, value: Value) => Promise<void>;
}) {
  const t = useTranslations("App.Tables");
  const board = useQuery({
    // Under the grid's key, so the editor's refresh after a write reloads it.
    queryKey: ["table-rows", table.id, "board", definition],
    queryFn: () => loadBoardRows(table.id, definition),
    refetchInterval: BOARD_POLL_MS,
  });
  // A moved card shows in its new lane until the write and reload settle.
  const [moves, setMoves] = useState<Record<string, Value>>({});
  // One move at a time: the next write needs the row version this one returns.
  const moving = useRef(false);
  const [busy, setBusy] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );
  const fields = columns.filter(
    (item) => item.id !== column.id && item.type !== "last_updated",
  );
  const rows = (board.data?.rows ?? []).map((row) =>
    row.id in moves
      ? { ...row, values: { ...row.values, [column.id]: moves[row.id] } }
      : row,
  );
  const lanes = boardLanes(rows, column);
  // A value no option names any more shows, but nothing moves into it.
  const canTake = (value: Value) =>
    value === null || !!column.options?.includes(value);
  const laneName = (value: Value) =>
    value ?? t("board.noValue", { column: column.name });
  const cardTitle = (row: TableRow) =>
    (fields[0] && tableValueText(row.values[fields[0].id])) || t("row");

  /**
   * A move takes the card to another lane, which unmounts the Move button
   * that had focus. Put focus on the card's new button, or on the board when
   * the card left it, so the keyboard user keeps their place.
   */
  function keepFocus(rowId: string) {
    requestAnimationFrame(() => {
      const root = boardRef.current;
      const active = document.activeElement;
      if (!root || (active && active !== document.body && active.isConnected))
        return;
      (
        root.querySelector<HTMLElement>(`[data-move-row="${rowId}"]`) ?? root
      ).focus();
    });
  }
  async function move(row: TableRow, value: Value, fromMenu = false) {
    if (moving.current || (row.values[column.id] ?? null) === value) return;
    moving.current = true;
    setBusy(true);
    setMoves((current) => ({ ...current, [row.id]: value }));
    if (fromMenu) keepFocus(row.id);
    try {
      await onMove(row, value);
    } finally {
      moving.current = false;
      setBusy(false);
      setMoves(({ [row.id]: _, ...rest }) => rest);
      if (fromMenu) keepFocus(row.id);
    }
  }
  const cardName = (id: unknown) => {
    const row = rows.find((item) => item.id === id);
    return row ? cardTitle(row) : t("row");
  };
  const targetName = (data: unknown) =>
    laneName((data as Lane | undefined)?.value ?? null);
  function handleDragEnd({ active, over }: DragEndEvent) {
    const row = rows.find((item) => item.id === active.id);
    const value = (over?.data.current as Lane | undefined)?.value ?? null;
    if (row && over && canTake(value)) void move(row, value);
  }

  if (!board.data && board.isError)
    return (
      <div role="alert" className="space-y-3 p-6 text-sm">
        <p>{t("board.loadError")}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void board.refetch()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  if (!board.data)
    return (
      <p role="status" className="p-6 text-sm">
        {t("loading")}
      </p>
    );
  return (
    <div ref={boardRef} tabIndex={-1} className="min-w-0 outline-none">
      {board.data?.truncated && (
        <p role="status" className="text-muted-foreground px-3 pt-3 text-sm">
          {t("board.truncated", { count: BOARD_ROW_LIMIT })}
        </p>
      )}
      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable: t("board.dndInstructions"),
          },
          announcements: {
            onDragStart: ({ active }) =>
              t("dnd.pickedUp", { item: cardName(active.id) }),
            onDragOver: ({ active, over }) =>
              over
                ? t("dnd.over", {
                    item: cardName(active.id),
                    target: targetName(over.data.current),
                  })
                : undefined,
            onDragEnd: ({ active, over }) =>
              over
                ? t("board.dropped", {
                    item: cardName(active.id),
                    target: targetName(over.data.current),
                  })
                : t("dnd.cancelled", { item: cardName(active.id) }),
            onDragCancel: ({ active }) =>
              t("dnd.cancelled", { item: cardName(active.id) }),
          },
        }}
      >
        <div className="flex min-w-0 gap-3 overflow-x-auto overscroll-x-contain p-3">
          {lanes.map((lane) => (
            <BoardLane
              key={lane.value ?? ""}
              lane={lane}
              name={laneName(lane.value)}
            >
              {lane.rows.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  title={cardTitle(row)}
                  details={fields
                    .slice(1, 3)
                    .map((field) => ({
                      id: field.id,
                      text: tableValueText(row.values[field.id]),
                    }))
                    .filter((detail) => detail.text)}
                  disabled={readOnly || busy}
                >
                  {!readOnly && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="hit-area size-8 shrink-0"
                          data-move-row={row.id}
                          aria-label={t("board.moveCard", {
                            row: cardTitle(row),
                          })}
                        >
                          <ArrowRightLeft className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>
                          {t("board.moveTo")}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={lane.value ?? ""}
                          onValueChange={(value) =>
                            void move(row, value || null, true)
                          }
                        >
                          {lanes
                            .filter((target) => canTake(target.value))
                            .map((target) => (
                              <DropdownMenuRadioItem
                                key={target.value ?? ""}
                                value={target.value ?? ""}
                                disabled={busy}
                              >
                                {laneName(target.value)}
                              </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </BoardCard>
              ))}
            </BoardLane>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function BoardLane({
  lane,
  name,
  children,
}: {
  lane: Lane;
  name: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("App.Tables");
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${lane.value ?? ""}`,
    data: lane,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={name}
      className={cn(
        "bg-muted flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 transition-colors sm:w-72",
        isOver && "bg-quinary",
      )}
    >
      <h2 className="flex items-center justify-between gap-2 px-1 text-sm font-medium">
        <span className="truncate">{name}</span>
        <Badge variant="secondary" className="tabular-nums">
          {lane.rows.length}
        </Badge>
      </h2>
      {lane.rows.length ? (
        <ul className="flex flex-col gap-2">{children}</ul>
      ) : (
        <p className="text-muted-foreground px-1 py-3 text-sm">
          {t("board.emptyLane")}
        </p>
      )}
    </section>
  );
}

function BoardCard({
  row,
  title,
  details,
  disabled,
  children,
}: {
  row: TableRow;
  title: string;
  details: { id: string; text: string }[];
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: row.id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cn(
        "bg-background flex items-start gap-2 rounded-md border p-2 text-sm",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{title}</p>
        {details.map((detail) => (
          <p key={detail.id} className="text-muted-foreground truncate">
            {detail.text}
          </p>
        ))}
      </div>
      {children}
    </li>
  );
}
