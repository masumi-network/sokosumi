"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { ArrowRight, Copy } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createTask } from "@/lib/actions/task/action";
import type {
  TaskFormCreateHandler,
  TaskFormCreateInput,
} from "./task-form-types";

/** Most Projects one brief is copied to at once. */
const MAX_PROJECTS = 10;

type Outcome = { href: string } | "failed";

interface TaskForOtherProjectsProps {
  /** The brief as the first Task was created, without Project or status. */
  input: Omit<TaskFormCreateInput, "projectId" | "status">;
  projects: ReadonlyArray<{ id: string; name: string }>;
  onCreateTask?: TaskFormCreateHandler | undefined;
}

/**
 * After a Task is created, makes the same brief as a Draft in other Projects:
 * one create per Project, so each lands in its own Project. A Project that
 * got its Task is never sent again; Retry sends only the ones that failed.
 */
export function TaskForOtherProjects({
  input,
  projects,
  onCreateTask = createTask,
}: TaskForOtherProjectsProps) {
  const t = useTranslations("App.Tasks.NewTask.OtherProjects");
  const legendId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [isSending, setIsSending] = useState(false);

  const isCreated = (id: string) => typeof outcomes[id] === "object";
  const toSend = selected.filter((id) => !isCreated(id));
  const failed = toSend.filter((id) => outcomes[id] === "failed");
  const isRetry = failed.length > 0 && failed.length === toSend.length;
  const createdCount = selected.length - toSend.length;

  async function send() {
    setIsSending(true);
    // ponytail: one Project after another; parallel if 10 feels slow.
    for (const projectId of toSend) {
      let outcome: Outcome = "failed";
      try {
        const result = await onCreateTask({
          ...input,
          projectId,
          status: TaskStatus.DRAFT,
        });
        if (result.ok) {
          outcome = {
            href: taskHref({
              id: result.value.taskId,
              identifier: result.value.identifier,
              name: result.value.name,
            }),
          };
        }
      } catch {}
      setOutcomes((current) => ({ ...current, [projectId]: outcome }));
    }
    setIsSending(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        <Copy aria-hidden className="size-4" />
        {t("open")}
      </Button>
    );
  }

  return (
    <fieldset
      aria-labelledby={legendId}
      className="border-border grid w-full gap-3 rounded-xl border p-3 text-left"
    >
      <div className="grid gap-0.5">
        <span id={legendId} className="text-sm font-medium">
          {t("title")}
        </span>
        <span className="text-muted-foreground text-xs text-pretty">
          {t("hint")}
        </span>
      </div>
      <ul className="app-scrollbar -mx-1 grid max-h-48 gap-0.5 overflow-y-auto overscroll-contain">
        {projects.map((project) => {
          const outcome = outcomes[project.id];
          const checked = selected.includes(project.id);
          const inputId = `${legendId}-${project.id}`;
          return (
            <li
              key={project.id}
              className="flex min-h-9 items-center gap-2 rounded-md px-1"
            >
              <Checkbox
                id={inputId}
                checked={checked}
                disabled={
                  isSending ||
                  isCreated(project.id) ||
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
              ) : outcome ? (
                <Link
                  href={outcome.href}
                  className="text-foreground inline-flex shrink-0 items-center gap-1 text-xs underline-offset-4 hover:underline"
                >
                  {t("openTask")}
                  <span className="sr-only">{project.name}</span>
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p role="status" className="text-muted-foreground text-xs empty:hidden">
        {Object.keys(outcomes).length > 0
          ? t("summary", { created: createdCount, failed: failed.length })
          : ""}
      </p>
      <Button
        type="button"
        disabled={isSending || toSend.length === 0}
        onClick={send}
      >
        {isRetry
          ? t("retry", { count: failed.length })
          : t("create", { count: toSend.length })}
      </Button>
    </fieldset>
  );
}
