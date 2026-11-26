import { type ReactNode, useEffect, useId, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import { isPlainReference, type MessageKey, t } from "../../shell/text.ts";
import { PrimaryButton, QuietButton } from "../../shell/ui.tsx";
import {
  Avatar,
  DueDate,
  Party,
  PriorityIcon,
  partyName,
  TaskStatus,
  taskWebUrl,
} from "../task.tsx";

const Named = z.object({ name: z.string() }).nullish();

/** The fields of a `tasks_list` item the board reads; the rest is ignored. */
const BoardTask = z.object({
  id: z.string(),
  identifier: z.string().nullish(),
  name: z.string(),
  status: z.string(),
  priority: z.string().nullish(),
  dueOn: z.string().nullish(),
  assignee: Party,
  workspace: z.object({ organization: Named }).partial().nullish(),
});
type BoardTask = z.infer<typeof BoardTask>;

/** `tasks_list`'s result, which `tasks_show_board` returns unchanged. */
export const TasksList = z.object({
  data: z.array(BoardTask),
  pagination: z.object({ total: z.number().nullish() }).partial().nullish(),
});
export type TasksList = z.infer<typeof TasksList>;

export const BOARD_EMPTY = {
  title: "tasksBoard.empty.title",
  body: "tasksBoard.empty.body",
} satisfies { title: MessageKey; body: MessageKey };

/**
 * Web's board columns, in order (apps/web/src/app/(app)/tasks/utils/task-column.ts).
 * `main` is the status the column title already names, so its Tasks show no
 * status word. An unknown status lands in Todo, as on Web.
 */
const COLUMNS = [
  {
    id: "backlog",
    statuses: ["DRAFT", "QUEUED"],
    main: "DRAFT",
    dot: "bg-status-done",
  },
  {
    id: "todo",
    statuses: ["READY", "CREDITS_TOPPED_UP"],
    main: "READY",
    dot: "bg-status-external",
  },
  {
    id: "inProgress",
    statuses: ["RUNNING", "AWAITING_EXTERNAL"],
    main: "RUNNING",
    dot: "bg-status-working",
  },
  {
    id: "inputRequired",
    dot: "bg-semantic-warning",
    statuses: [
      "GRANT_PENDING",
      "INPUT_REQUIRED",
      "APPROVAL_REQUIRED",
      "AUTHENTICATION_REQUIRED",
      "OUT_OF_CREDITS",
    ],
  },
  {
    id: "done",
    statuses: ["COMPLETED", "FAILED", "CANCELED"],
    main: "COMPLETED",
    dot: "bg-semantic-success",
  },
] as const satisfies {
  id: string;
  statuses: readonly string[];
  main?: string;
  /** Web's column dot (task-board.ts `COLUMN_STATUS_COLORS`). */
  dot: string;
}[];
type Column = (typeof COLUMNS)[number];

const INLINE_PER_COLUMN = 3;
const INLINE_IN_LIST = 5;

/**
 * Web shows a phone the list of cards and a wider screen the board
 * (tasks-view-mode.server.ts, task-list-view.tsx). A view knows only its
 * own width, so it switches at Tailwind's `sm`.
 */
const BOARD_MEDIA = "(min-width: 640px)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia?.(query).matches ?? true,
  );
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function columnOf(status: string): Column {
  return (
    COLUMNS.find(({ statuses }) =>
      (statuses as readonly string[]).includes(status),
    ) ?? COLUMNS[1]
  );
}

/** The column title already names its main status, so a card there shows only the marker. */
function isQuiet(task: BoardTask, column?: Column): boolean {
  return !!column && "main" in column && column.main === task.status;
}

/**
 * What the model may read about a selection: an identifier such as SOK-12,
 * else the id, and only if it is a plain reference, never record text (ADR 0083).
 */
function referenceOf(task: BoardTask): string | undefined {
  return [task.identifier, task.id].find(isPlainReference);
}

export function TasksBoard({
  data,
  context,
}: {
  data: TasksList;
  context: ViewContext;
}) {
  const { app, refresh, availableDisplayModes = [] } = context;
  const [mode, setMode] = useState(context.displayMode ?? "inline");
  useEffect(
    () => setMode(context.displayMode ?? "inline"),
    [context.displayMode],
  );
  const fullscreen = mode === "fullscreen";
  const board = useMedia(BOARD_MEDIA);
  const otherMode = fullscreen ? "inline" : "fullscreen";
  const [selectedId, setSelectedId] = useState<string>();
  const [refreshing, setRefreshing] = useState<"idle" | "busy" | "failed">(
    "idle",
  );

  const tasks = data.data;
  const workspaceName = tasks[0]?.workspace?.organization?.name;
  const total = data.pagination?.total;
  const warn = (what: string) => (error: unknown) =>
    app.sendLog({ level: "warning", data: `${what} failed: ${String(error)}` });

  const select = (task: BoardTask) => {
    setSelectedId(task.id);
    const ref = referenceOf(task);
    if (!ref) return;
    app
      .updateModelContext({
        content: [{ type: "text", text: t("tasksBoard.context", { ref }) }],
      })
      .catch(warn("ui/update-model-context"));
  };

  const switchMode = () =>
    app
      .requestDisplayMode({ mode: otherMode })
      .then(({ mode: granted }) => setMode(granted))
      .catch(warn("ui/request-display-mode"));

  const runRefresh = async () => {
    if (!refresh) return;
    setRefreshing("busy");
    setRefreshing((await refresh()) ? "idle" : "failed");
  };

  const card = (task: BoardTask, column?: Column) => {
    const selected = task.id === selectedId;
    const url = selected ? taskWebUrl(task.id, context.webBaseUrl) : undefined;
    return (
      <TaskCard
        key={task.id}
        task={task}
        quiet={isQuiet(task, column)}
        selected={selected}
        context={context}
        onSelect={() => select(task)}
      >
        {url && (
          <PrimaryButton
            onClick={() => app.openLink({ url }).catch(warn("ui/open-link"))}
          >
            {t("task.open")}
          </PrimaryButton>
        )}
      </TaskCard>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-base font-semibold tracking-tight">
            {t("tasksBoard.title")}
          </h1>
          {workspaceName && (
            <p className="text-muted-foreground truncate text-xs">
              {workspaceName}
            </p>
          )}
          {total != null && total > tasks.length && (
            <p className="text-muted-foreground text-xs">
              {t("tasksBoard.showing", { shown: tasks.length, total })}
            </p>
          )}
        </div>
        <div className="-mx-3 flex items-center">
          {refresh && (
            <QuietButton
              onClick={runRefresh}
              disabled={refreshing === "busy"}
              aria-busy={refreshing === "busy"}
            >
              {refreshing === "busy" ? t("view.refreshing") : t("view.refresh")}
            </QuietButton>
          )}
          {availableDisplayModes.includes(otherMode) && (
            <QuietButton onClick={switchMode}>
              {fullscreen
                ? t("tasksBoard.exitFullscreen")
                : t("tasksBoard.fullscreen")}
            </QuietButton>
          )}
        </div>
      </header>
      <p role="status" className="text-muted-foreground text-xs empty:hidden">
        {refreshing === "failed" ? t("view.refreshFailed") : ""}
      </p>

      {board ? (
        <div className="-mx-4 flex items-stretch gap-3 overflow-x-auto px-4 pb-2">
          {COLUMNS.map((column) => {
            const inColumn = tasks.filter(
              (task) => columnOf(task.status) === column,
            );
            const shown = fullscreen
              ? inColumn
              : inColumn.slice(0, INLINE_PER_COLUMN);
            return (
              <BoardColumn
                key={column.id}
                title={t(`tasksBoard.column.${column.id}`)}
                dot={column.dot}
                count={inColumn.length}
                more={inColumn.length - shown.length}
              >
                {shown.map((task) => card(task, column))}
              </BoardColumn>
            );
          })}
        </div>
      ) : (
        <div className="bg-card-background flex flex-col gap-2 rounded-xl p-2">
          {(fullscreen ? tasks : tasks.slice(0, INLINE_IN_LIST)).map((task) =>
            card(task),
          )}
          {!fullscreen && tasks.length > INLINE_IN_LIST && (
            <More count={tasks.length - INLINE_IN_LIST} />
          )}
        </div>
      )}
    </div>
  );
}

function More({ count }: { count: number }) {
  return (
    <p className="text-muted-foreground px-1 pb-1 text-xs">
      {t("tasksBoard.more", { count })}
    </p>
  );
}

/** Web's kanban-column.tsx and column-header.tsx. */
function BoardColumn({
  title,
  dot,
  count,
  more,
  children,
}: {
  title: string;
  dot: string;
  count: number;
  more: number;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="bg-card-background flex min-w-[260px] flex-1 shrink-0 flex-col rounded-xl sm:min-w-[280px]"
    >
      <header className="flex items-center justify-between gap-2 px-[21px] pt-3 pb-2">
        <h2
          id={headingId}
          className="flex min-w-0 items-center gap-2 text-sm font-medium"
        >
          <span
            aria-hidden="true"
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            <span className={`size-2 rounded-full ${dot}`} />
          </span>
          <span className="truncate">{title}</span>
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {children}
        {more > 0 && <More count={more} />}
        {count === 0 && (
          <p className="text-muted-foreground flex flex-1 items-center justify-center py-8 text-sm">
            {t("tasksBoard.column.empty")}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Web's task-card.tsx: the status and identifier, the title, then the due day
 * and the assignee. The title is the button that selects the Task; it covers
 * the card, as Web's title link does.
 */
function TaskCard({
  task,
  quiet,
  selected,
  context,
  onSelect,
  children,
}: {
  task: BoardTask;
  quiet: boolean;
  selected: boolean;
  context: ViewContext;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const assignee = partyName(task.assignee);
  return (
    <article
      className={`bg-background hover:border-control-border relative isolate flex flex-col gap-2 rounded-lg border p-3 transition-[border-color,box-shadow] hover:shadow-sm ${selected ? "border-control-border shadow-sm" : "border-border"}`}
    >
      <div className="flex h-4 items-center gap-2 text-xs">
        <TaskStatus status={task.status} quiet={quiet} />
        {task.identifier && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {task.identifier}
          </span>
        )}
        {task.priority && (
          <PriorityIcon priority={task.priority} className="size-3.5" />
        )}
      </div>
      <h3 className="line-clamp-2 text-sm leading-5 font-medium">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="press text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {task.name}
        </button>
      </h3>
      <div className="flex h-5 items-center gap-2">
        {task.dueOn && (
          <DueDate dueOn={task.dueOn} status={task.status} context={context} />
        )}
        <span className="ms-auto">
          <Avatar
            name={assignee}
            label={
              assignee
                ? t("task.assignee", { name: assignee })
                : t("task.unassigned")
            }
          />
        </span>
      </div>
      {children && <div className="relative z-10 grid">{children}</div>}
    </article>
  );
}
