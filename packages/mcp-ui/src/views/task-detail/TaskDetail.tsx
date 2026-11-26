import { Bot, Building2, ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { z } from "zod";
import { Markdown } from "../../shell/Markdown.tsx";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatDateTime,
  formatDay,
  isMessageKey,
  type MessageKey,
  t,
} from "../../shell/text.ts";
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

/** The fields of a `tasks_get` item the view reads; the rest is ignored. */
const DetailTask = z.object({
  id: z.string(),
  identifier: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string(),
  priority: z.string().nullish(),
  dueOn: z.string().nullish(),
  assignee: Party,
  workspace: z
    .object({ organization: z.object({ name: z.string() }).nullish() })
    .partial()
    .nullish(),
  /** Every event and Job, which `tasks_get` embeds, oldest first. */
  events: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        comment: z.string().nullish(),
        actor: Party,
      }),
    )
    .nullish(),
  jobs: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        name: z.string().nullish(),
        status: z.string(),
      }),
    )
    .nullish(),
});
type DetailTask = z.infer<typeof DetailTask>;

/** `tasks_get`'s result, which `tasks_show` returns unchanged. */
export const TaskResult = z.object({ data: DetailTask });
export type TaskResult = z.infer<typeof TaskResult>;

/** Statuses where the Task waits on the person, who acts in Sokosumi (ADR 0077). */
const WAITS_ON_PERSON = new Set([
  "APPROVAL_REQUIRED",
  "INPUT_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
]);

type TimelineItem =
  | { kind: "comment"; id: string; at: string; who?: string; text: string }
  | { kind: "job"; id: string; at: string; name: string; status?: string };

/** Comments with their own text and every Job, oldest first. */
function timelineOf(task: DetailTask): TimelineItem[] {
  const items: TimelineItem[] = [
    ...(task.events ?? []).flatMap((event) =>
      event.comment?.trim()
        ? [
            {
              kind: "comment" as const,
              id: event.id,
              at: event.createdAt,
              who: partyName(event.actor),
              text: event.comment,
            },
          ]
        : [],
    ),
    ...(task.jobs ?? []).map((job) => {
      const key = `jobStatus.status.${job.status}`;
      return {
        kind: "job" as const,
        id: job.id,
        at: job.createdAt,
        name: job.name?.trim() || t("taskDetail.untitledJob"),
        status: isMessageKey(key) ? t(key) : undefined,
      };
    }),
  ];
  // Core's ISO times sort as strings, and a bad one cannot break the order.
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export function TaskDetail({
  data,
  context,
}: {
  data: TaskResult;
  context: ViewContext;
}) {
  const { app, refresh } = context;
  const task = data.data;
  const [refreshing, setRefreshing] = useState<"idle" | "busy" | "failed">(
    "idle",
  );
  const [timelineOpen, setTimelineOpen] = useState(false);

  const runRefresh = async () => {
    if (!refresh) return;
    setRefreshing("busy");
    setRefreshing((await refresh()) ? "idle" : "failed");
  };

  const url = taskWebUrl(task.id, context.webBaseUrl);
  const assignee = partyName(task.assignee);
  const workspace = task.workspace?.organization?.name;
  const priorityKey = `task.priority.${task.priority}`;
  const openLink = (link: string) =>
    app.openLink({ url: link }).catch((error: unknown) =>
      app.sendLog({
        level: "warning",
        data: `ui/open-link failed: ${String(error)}`,
      }),
    );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex min-h-5 items-center justify-between gap-4">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            {task.identifier && (
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {task.identifier}
              </span>
            )}
            <TaskStatus status={task.status} />
          </p>
          {refresh && (
            <QuietButton
              className="-my-3 -mr-3"
              onClick={runRefresh}
              disabled={refreshing === "busy"}
              aria-busy={refreshing === "busy"}
            >
              {refreshing === "busy" ? t("view.refreshing") : t("view.refresh")}
            </QuietButton>
          )}
        </div>
        <h1 className="text-xl leading-tight font-semibold tracking-tight break-words">
          {task.name}
        </h1>
        <p role="status" className="text-muted-foreground text-xs empty:hidden">
          {refreshing === "failed" ? t("view.refreshFailed") : ""}
        </p>
      </header>

      <Section title={t("taskDetail.description")}>
        {task.description?.trim() ? (
          <Markdown
            text={task.description}
            webBaseUrl={context.webBaseUrl}
            onOpenLink={openLink}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("taskDetail.noDescription")}
          </p>
        )}
      </Section>

      <Section title={t("taskDetail.properties")}>
        <div className="flex flex-col gap-1">
          {task.priority && isMessageKey(priorityKey) && (
            <Property
              label="taskDetail.priority"
              value={t(priorityKey)}
              icon={<PriorityIcon priority={task.priority} />}
            />
          )}
          <Property
            label="taskDetail.assignee"
            value={assignee ?? t("task.unassigned")}
            icon={<Avatar name={assignee} />}
          />
          {task.dueOn && (
            <Property
              label="taskDetail.due"
              value={formatDay(task.dueOn, context)}
            >
              <DueDate
                dueOn={task.dueOn}
                status={task.status}
                context={context}
                className="gap-2 text-sm [&>svg]:mx-0.5 [&>svg]:size-4"
              />
            </Property>
          )}
          {workspace && (
            <Property
              label="taskDetail.workspace"
              value={workspace}
              icon={
                <Building2
                  aria-hidden="true"
                  className="text-muted-foreground size-4"
                />
              }
            />
          )}
        </div>
      </Section>

      {url && (
        <div>
          <PrimaryButton onClick={() => openLink(url)}>
            {WAITS_ON_PERSON.has(task.status)
              ? t("task.review")
              : t("task.open")}
          </PrimaryButton>
        </div>
      )}

      <TimelineSection
        open={timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
        items={timelineOf(task)}
        context={context}
        onOpenLink={openLink}
      />
    </div>
  );
}

/** Web's Task page section: a quiet `text-xs` title over its content. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Web's `PropertyRow` (task-metadata.tsx): an icon in a 20px slot and the
 * value; the label is the row's accessible name, as on Web.
 */
function Property({
  label,
  value,
  icon,
  children,
}: {
  label: MessageKey;
  value: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={`${t(label)}: ${value}`}
      className="flex h-8 min-w-0 items-center gap-2 text-sm"
    >
      {icon && (
        <span className="flex size-5 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      {children ?? <span className="truncate">{value}</span>}
    </div>
  );
}

function TimelineSection({
  open,
  onToggle,
  items,
  context,
  onOpenLink,
}: {
  open: boolean;
  onToggle: () => void;
  items: TimelineItem[];
  context: ViewContext;
  onOpenLink: (url: string) => void;
}) {
  const bodyId = useId();
  return (
    <section className="-mt-3 flex flex-col gap-1">
      <h2 className="text-muted-foreground text-xs font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="hover:text-foreground focus-visible:outline-ring -mx-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-left focus-visible:outline-2"
        >
          {t("taskDetail.timeline")}
          <ChevronDown
            aria-hidden="true"
            className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("taskDetail.timelineEmpty")}
          </p>
        ) : (
          <ol
            aria-label={t("taskDetail.timeline")}
            className="flex flex-col gap-4"
          >
            {items.map((item) => (
              <TimelineEntry
                key={`${item.kind}-${item.id}`}
                item={item}
                context={context}
                onOpenLink={onOpenLink}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function TimelineEntry({
  item,
  context,
  onOpenLink,
}: {
  item: TimelineItem;
  context: ViewContext;
  onOpenLink: (url: string) => void;
}) {
  const who = item.kind === "comment" ? item.who : t("taskDetail.job");
  return (
    <li className="flex gap-3">
      {item.kind === "comment" ? (
        <Avatar name={item.who} className="mt-0.5 size-6 text-2xs" />
      ) : (
        <span className="bg-muted mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
          <Bot aria-hidden="true" className="text-muted-foreground size-3.5" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs">
          {who && <span className="font-medium">{who}</span>}
          <span className="text-muted-foreground">
            {who ? " · " : ""}
            {formatDateTime(item.at, context)}
          </span>
        </p>
        {item.kind === "comment" ? (
          <Markdown
            text={item.text}
            webBaseUrl={context.webBaseUrl}
            onOpenLink={onOpenLink}
          />
        ) : (
          <p className="text-sm break-words">
            {item.name}
            {item.status && (
              <span className="text-muted-foreground">{` · ${item.status}`}</span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}
