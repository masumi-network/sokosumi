"use client";

import type { TaskListItem } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useDebounce } from "use-debounce";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  rankSimilarTasks,
  similarTaskSearchTerms,
} from "@/app/tasks/utils/similar-tasks";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { taskHref } from "@/app/tasks/utils/task-href";
import { getDefaultTasksScope } from "@/app/tasks/utils/tasks-filters";
import { coreClient } from "@/lib/clients/core.browser.client";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

const OPEN_TASK_STATUSES = [
  ...COLUMN_TASK_STATUSES.backlog,
  ...COLUMN_TASK_STATUSES.todo,
  ...COLUMN_TASK_STATUSES["in-progress"],
  ...COLUMN_TASK_STATUSES["input-required"],
];
const SEARCH_PAGE_SIZE = 20;
const DEBOUNCE_MS = 500;

/**
 * Open Tasks whose names share words with the brief being written, so the
 * writer can open one instead of filing a duplicate. Core's Task list decides
 * what the reader may see; this only reads it.
 */
export function SimilarTasksHint({
  brief,
  activeOrganizationId,
}: {
  brief: string;
  activeOrganizationId: string | null;
}) {
  const t = useTranslations("App.Tasks.SimilarTasks");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const titleId = useId();
  const [debouncedBrief] = useDebounce(brief, DEBOUNCE_MS);
  const terms = similarTaskSearchTerms(debouncedBrief);

  const { data: matches = [] } = useQuery({
    queryKey: ["similar-tasks", activeOrganizationId, terms],
    queryFn: async () => {
      const scope = getDefaultTasksScope(activeOrganizationId);
      const pages = await Promise.all(
        terms.map((q) =>
          coreClient.getTasks({
            q,
            scope,
            status: OPEN_TASK_STATUSES,
            limit: SEARCH_PAGE_SIZE,
          }),
        ),
      );
      return pages.flatMap((page) => page.data as TaskListItem[]);
    },
    enabled: terms.length > 0,
    select: (tasks) => rankSimilarTasks(debouncedBrief, tasks),
    placeholderData: (previous) => previous,
  });

  if (terms.length === 0 || matches.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-1.5 rounded-md border border-border p-3"
    >
      <h4 id={titleId} className="text-sm font-medium">
        {t("title")}
      </h4>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
      <ul className="flex flex-col">
        {matches.map((task) => (
          <li key={task.id}>
            <Link
              href={taskHref(task)}
              target="_blank"
              rel="noopener"
              className="hover:bg-quinary flex min-h-10 min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {task.identifier ? (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {task.identifier}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {stripInlineMarkdown(task.name)}
              </span>
              <TaskStatusBadge
                status={task.status}
                label={tStatus(task.status)}
                plain
                className="max-w-32"
              />
              <ExternalLink
                aria-hidden
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <span className="sr-only">{t("opensInNewTab")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
