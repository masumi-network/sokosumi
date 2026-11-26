import { useEffect, useId, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatDay,
  isPlainReference,
  type MessageKey,
  t,
} from "../../shell/text.ts";
import { PrimaryButton, QuietButton } from "../../shell/ui.tsx";
import {
  AssigneeBadge,
  Party,
  partyName,
  statusWord as taskStatusWord,
  taskWebUrl,
} from "../task.tsx";

const Named = z.object({ name: z.string() }).nullish();

/** The fields of a `tasks_list` item the board reads; the rest is ignored. */
const BoardTask = z.object({
  id: z.string(),
  identifier: z.string().nullish(),
  name: z.string(),
  status: z.string(),
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
  { id: "backlog", statuses: ["DRAFT", "QUEUED"], main: "DRAFT" },
  { id: "todo", statuses: ["READY", "CREDITS_TOPPED_UP"], main: "READY" },
  {
    id: "inProgress",
    statuses: ["RUNNING", "AWAITING_EXTERNAL"],
    main: "RUNNING",
  },
  {
    id: "inputRequired",
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
  },
] as const satisfies {
  id: string;
  statuses: readonly string[];
  main?: string;
}[];
type Column = (typeof COLUMNS)[number];

const INLINE_PER_COLUMN = 3;

function columnOf(status: string): Column {
  return (
    COLUMNS.find(({ statuses }) =>
      (statuses as readonly string[]).includes(status),
    ) ?? COLUMNS[1]
  );
}

function statusWord(task: BoardTask, column: Column): string | undefined {
  if ("main" in column && column.main === task.status) return undefined;
  return taskStatusWord(task.status);
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

  return (
    <article className="flex flex-col gap-5">
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

      <div
        className={
          fullscreen
            ? "-mx-4 flex gap-6 overflow-x-auto px-4 pb-2"
            : "flex flex-col gap-5"
        }
      >
        {COLUMNS.map((column) => {
          const inColumn = tasks.filter(
            (task) => columnOf(task.status) === column,
          );
          const shown = fullscreen
            ? inColumn
            : inColumn.slice(0, INLINE_PER_COLUMN);
          return (
            <ColumnSection
              key={column.id}
              title={t(`tasksBoard.column.${column.id}`)}
              count={inColumn.length}
              more={inColumn.length - shown.length}
              className={fullscreen ? "flex-[1_0_14rem]" : ""}
            >
              {shown.map((task) => {
                const selected = task.id === selectedId;
                const url = selected
                  ? taskWebUrl(task.id, context.webBaseUrl)
                  : undefined;
                return (
                  <li key={task.id} className="flex flex-col gap-2">
                    <TaskRow
                      task={task}
                      status={statusWord(task, column)}
                      selected={selected}
                      context={context}
                      onSelect={() => select(task)}
                    />
                    {url && (
                      <div className="px-3 pb-1">
                        <PrimaryButton
                          onClick={() =>
                            app.openLink({ url }).catch(warn("ui/open-link"))
                          }
                        >
                          {t("task.open")}
                        </PrimaryButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ColumnSection>
          );
        })}
      </div>
    </article>
  );
}

function ColumnSection({
  title,
  count,
  more,
  className,
  children,
}: {
  title: string;
  count: number;
  more: number;
  className: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-1 ${className}`}
    >
      <h2
        id={headingId}
        className="text-muted-foreground flex items-baseline gap-2 text-xs font-medium"
      >
        {title}
        <span className="tabular-nums">{count}</span>
      </h2>
      {count > 0 && <ul className="-mx-3 flex flex-col">{children}</ul>}
      {more > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("tasksBoard.more", { count: more })}
        </p>
      )}
    </section>
  );
}

function TaskRow({
  task,
  status,
  selected,
  context,
  onSelect,
}: {
  task: BoardTask;
  status?: string;
  selected: boolean;
  context: ViewContext;
  onSelect: () => void;
}) {
  const assignee = partyName(task.assignee);
  const meta = [
    task.identifier,
    status,
    task.dueOn && t("task.due", { date: formatDay(task.dueOn, context) }),
  ].filter(Boolean);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`hover:bg-accent focus-visible:outline-ring flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 ${selected ? "bg-accent" : ""}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 font-medium">{task.name}</span>
        {meta.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {meta.join(" · ")}
          </span>
        )}
      </span>
      {assignee && <AssigneeBadge name={assignee} />}
    </button>
  );
}
