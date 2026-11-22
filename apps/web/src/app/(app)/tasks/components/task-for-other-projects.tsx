"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { ArrowRight, ChevronDown, Copy } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createTask } from "@/lib/actions/task/action";
import { cn } from "@/lib/utils";
import type {
  TaskFormCreateHandler,
  TaskFormCreateInput,
} from "./task-form-types";

/** Most Projects one brief is copied to at once. */
const MAX_PROJECTS = 10;

/**
 * `failed`: Core refused the create, so nothing was saved and Retry is safe.
 * `unknown`: the answer never came back. Core may have saved the Draft, so
 * the row is never sent again; the reader checks the Project instead.
 */
type Outcome = { href: string } | "failed" | "unknown";

const LINK_CLASS =
  "text-foreground inline-flex shrink-0 items-center gap-1 text-xs underline-offset-4 hover:underline";

interface TaskForOtherProjectsProps {
  /** The brief as the first Task was created, without Project or status. */
  input: Omit<TaskFormCreateInput, "projectId" | "status">;
  projects: ReadonlyArray<{ id: string; name: string }>;
  onCreateTask?: TaskFormCreateHandler | undefined;
}

/**
 * After a Task is created, makes the same brief as a Draft in other Projects:
 * one create per Project, so each lands in its own Project. A Project that
 * got its Task, or whose answer was lost, is never sent again; Retry sends
 * only the ones Core refused.
 */
export function TaskForOtherProjects({
  input,
  projects,
  onCreateTask = createTask,
}: TaskForOtherProjectsProps) {
  const t = useTranslations("App.Tasks.NewTask.OtherProjects");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [sending, setSending] = useState<{ done: number; total: number }>();

  const isSettled = (id: string) =>
    outcomes[id] !== undefined && outcomes[id] !== "failed";
  const toSend = selected.filter((id) => !isSettled(id));
  const failed = toSend.filter((id) => outcomes[id] === "failed");
  const isRetry = failed.length > 0 && failed.length === toSend.length;
  const counts = Object.values(outcomes).reduce(
    (sum, outcome) => {
      if (outcome === "failed") sum.failed += 1;
      else if (outcome === "unknown") sum.unknown += 1;
      else sum.created += 1;
      return sum;
    },
    { created: 0, failed: 0, unknown: 0 },
  );

  async function send() {
    const total = toSend.length;
    // ponytail: one Project after another; parallel if 10 feels slow.
    for (const [index, projectId] of toSend.entries()) {
      setSending({ done: index, total });
      let outcome: Outcome;
      try {
        const result = await onCreateTask({
          ...input,
          projectId,
          status: TaskStatus.DRAFT,
        });
        outcome = result.ok
          ? {
              href: taskHref({
                id: result.value.taskId,
                identifier: result.value.identifier,
                name: result.value.name,
              }),
            }
          : "failed";
      } catch {
        outcome = "unknown";
      }
      setOutcomes((current) => ({ ...current, [projectId]: outcome }));
    }
    setSending(undefined);
  }

  return (
    <div className="grid w-full gap-2">
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Copy aria-hidden className="size-4" />
        {t("open")}
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-[rotate]", open && "rotate-180")}
        />
      </Button>
      <fieldset
        id={panelId}
        hidden={!open}
        aria-labelledby={`${panelId}-title`}
        aria-describedby={`${panelId}-hint`}
        className="border-border grid w-full gap-3 rounded-xl border p-3 text-left"
      >
        <div className="grid gap-0.5">
          <span id={`${panelId}-title`} className="text-sm font-medium">
            {t("title")}
          </span>
          <span
            id={`${panelId}-hint`}
            className="text-muted-foreground text-xs text-pretty"
          >
            {t("hint")}
          </span>
        </div>
        <ul className="app-scrollbar -mx-1 grid max-h-48 gap-0.5 overflow-y-auto overscroll-contain">
          {projects.map((project) => {
            const outcome = outcomes[project.id];
            const checked = selected.includes(project.id);
            const inputId = `${panelId}-${project.id}`;
            return (
              <li
                key={project.id}
                className="flex min-h-9 items-center gap-2 rounded-md px-1"
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={
                    sending !== undefined ||
                    isSettled(project.id) ||
                    (!checked && selected.length >= MAX_PROJECTS)
                  }
                  onCheckedChange={(next) =>
                    setSelected((current) =>
                      next === true
                        ? [...current, project.id]
                        : current.filter((id) => id !== project.id),
                    )
                  }
                />
                <label
                  htmlFor={inputId}
                  className="min-w-0 flex-1 truncate text-sm"
                >
                  {project.name}
                </label>
                {outcome === "failed" ? (
                  <span className="text-destructive shrink-0 text-xs">
                    {t("failed")}
                  </span>
                ) : outcome === "unknown" ? (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {t("unknown")}
                    </span>
                    <Link
                      href={`/tasks?projectId=${encodeURIComponent(project.id)}`}
                      className={LINK_CLASS}
                    >
                      {t("checkProject")}
                      <span className="sr-only">{project.name}</span>
                    </Link>
                  </span>
                ) : outcome ? (
                  <Link href={outcome.href} className={LINK_CLASS}>
                    {t("openTask")}
                    <span className="sr-only">{project.name}</span>
                    <ArrowRight aria-hidden className="size-3" />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p role="status" className="text-muted-foreground text-xs">
          {sending
            ? t("sending", { done: sending.done + 1, total: sending.total })
            : Object.keys(outcomes).length > 0
              ? t("summary", counts)
              : ""}
        </p>
        {toSend.length > 0 || Object.keys(outcomes).length === 0 ? (
          <Button
            type="button"
            disabled={sending !== undefined || toSend.length === 0}
            onClick={send}
          >
            {isRetry
              ? t("retry", { count: failed.length })
              : t("create", { count: toSend.length })}
          </Button>
        ) : null}
      </fieldset>
    </div>
  );
}
