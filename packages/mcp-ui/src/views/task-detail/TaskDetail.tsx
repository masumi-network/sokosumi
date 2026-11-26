import { useId, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatDateTime,
  formatDay,
  isMessageKey,
  t,
} from "../../shell/text.ts";
import { PrimaryButton, QuietButton } from "../../shell/ui.tsx";
import {
  AssigneeBadge,
  Party,
  partyName,
  statusWord,
  taskWebUrl,
} from "../task.tsx";

/** The fields of a `tasks_get` item the view reads; the rest is ignored. */
const DetailTask = z.object({
  id: z.string(),
  identifier: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string(),
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
  const heading = [task.identifier, statusWord(task.status)]
    .filter(Boolean)
    .join(" · ");
  const meta = [
    task.dueOn && t("task.due", { date: formatDay(task.dueOn, context) }),
    task.workspace?.organization?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex min-h-5 items-center justify-between gap-4">
          <p className="text-muted-foreground text-xs">{heading}</p>
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
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-base font-semibold tracking-tight break-words">
            {task.name}
          </h1>
          {assignee && <AssigneeBadge name={assignee} />}
        </div>
        {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
      </header>
      <p role="status" className="text-muted-foreground text-xs empty:hidden">
        {refreshing === "failed" ? t("view.refreshFailed") : ""}
      </p>

      {task.description?.trim() ? (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
          {task.description.trim()}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("taskDetail.noDescription")}
        </p>
      )}

      {url && (
        <div>
          <PrimaryButton
            onClick={() =>
              app.openLink({ url }).catch((error: unknown) =>
                app.sendLog({
                  level: "warning",
                  data: `ui/open-link failed: ${String(error)}`,
                }),
              )
            }
          >
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
      />
    </article>
  );
}

function TimelineSection({
  open,
  onToggle,
  items,
  context,
}: {
  open: boolean;
  onToggle: () => void;
  items: TimelineItem[];
  context: ViewContext;
}) {
  const bodyId = useId();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="hover:bg-accent focus-visible:outline-ring -mx-3 flex min-h-11 w-[calc(100%+1.5rem)] items-center justify-between rounded-md px-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {t("taskDetail.timeline")}
          <span
            aria-hidden="true"
            className="text-muted-foreground text-xs font-normal"
          >
            {open ? t("taskDetail.hide") : t("taskDetail.show")}
          </span>
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
}: {
  item: TimelineItem;
  context: ViewContext;
}) {
  const when = formatDateTime(item.at, context);
  const meta = (
    item.kind === "comment" ? [item.who, when] : [t("taskDetail.job"), when]
  )
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{meta}</p>
      {item.kind === "comment" ? (
        <p className="text-sm break-words whitespace-pre-wrap">{item.text}</p>
      ) : (
        <p className="text-sm break-words">
          {item.name}
          {item.status && (
            <span className="text-muted-foreground">{` · ${item.status}`}</span>
          )}
        </p>
      )}
    </li>
  );
}
