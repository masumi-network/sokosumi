"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listDeveloperTasksAction } from "@/lib/actions/developer-tasks/action";
import type {
  DeveloperTaskListPage,
  DeveloperTaskListRow,
} from "@/lib/services/developer-task.service";

import { formatDeveloperTaskCoworkerNames } from "./format-coworker-names";

interface DeveloperTaskListProps {
  initialPage: DeveloperTaskListPage;
}

export function DeveloperTaskList({ initialPage }: DeveloperTaskListProps) {
  const t = useTranslations("App.Developer.Tasks.List");
  const formatter = useFormatter();

  const [tasks, setTasks] = useState<DeveloperTaskListRow[]>(initialPage.tasks);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    if (!nextCursor) {
      return;
    }

    startTransition(async () => {
      const result = await listDeveloperTasksAction({ cursor: nextCursor });
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadFailed"));
        return;
      }

      setTasks((current) => [...current, ...result.value.tasks]);
      setTotal(result.value.total);
      setNextCursor(result.value.nextCursor);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("totalCount", { count: total })}
      </p>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("task")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("coworkers")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead className="pr-4">{t("updated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const coworkerNames = formatDeveloperTaskCoworkerNames(
                  task.assignee,
                  task.creatorCoworker,
                );

                return (
                  <TableRow key={task.id}>
                    <TableCell className="pl-4">
                      <Link
                        href={`/developer/tasks/${task.id}`}
                        className="flex flex-col"
                      >
                        <span className="font-medium hover:underline">
                          {task.name}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {task.id}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={task.status} />
                    </TableCell>
                    <TableCell>
                      {coworkerNames ? (
                        coworkerNames
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col">
                        <span>{task.owner.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {task.owner.email}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {task.organization?.name ?? t("personalWorkspace")}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="pr-4">
                      {formatter.dateTime(task.updatedAt, {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
