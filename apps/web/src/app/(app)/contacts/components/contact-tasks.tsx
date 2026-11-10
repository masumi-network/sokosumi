"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { TaskDueBadge } from "@/app/tasks/components/task-due-badge";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contactsService } from "@/lib/services/contacts.client";

export const contactTasksKey = (contactId: string) => [
  "contact-tasks",
  contactId,
];

/**
 * The Tasks linked to one contact, as far as the reader may see them, and a
 * New Task that links the next one. Core filters and pages the list; private
 * Tasks of other people never reach it.
 */
export function ContactTasks({
  contact,
}: {
  contact: { id: string; name: string };
}) {
  const t = useTranslations("App.Contacts.panel.tasks");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const cache = useQueryClient();
  const wizard = useOptionalNewTaskWizard();
  const tasks = useInfiniteQuery({
    queryKey: contactTasksKey(contact.id),
    queryFn: ({ pageParam }) =>
      contactsService.tasks(contact.id, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="grid gap-3">
      {tasks.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : tasks.isError ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("error")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("empty", { name: contact.name })}
        </p>
      ) : (
        <ul className="-mx-3 flex flex-col">
          {items.map((task) => (
            <li key={task.id}>
              <Link
                href={taskHref(task)}
                className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2"
              >
                <TaskStatusBadge
                  status={task.status}
                  label={tStatus(task.status)}
                  showLabel={false}
                  className="border-0 bg-transparent p-0"
                />
                <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                  {task.name}
                </span>
                {task.dueOn ? (
                  <TaskDueBadge
                    dueOn={task.dueOn}
                    status={task.status}
                    className="shrink-0 text-sm"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {wizard ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              wizard.openNewTaskWizard({
                contactId: contact.id,
                prompt: t("prompt", { name: contact.name }),
                onTaskCreated: () =>
                  void cache.invalidateQueries({
                    queryKey: contactTasksKey(contact.id),
                  }),
              })
            }
          >
            <Plus aria-hidden />
            {t("new")}
          </Button>
        ) : null}
        {tasks.hasNextPage ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            loading={tasks.isFetchingNextPage}
            onClick={() => void tasks.fetchNextPage()}
          >
            {t("showMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
