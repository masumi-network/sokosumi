"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEnvPublicConfig } from "@/config/env.public";
import { listAdminTasksAction } from "@/lib/actions/admin-tasks/action";
import type {
  AdminTaskListItem,
  AdminTaskListPage,
} from "@/lib/services/admin-task.service";

interface TaskListProps {
  initialPage: AdminTaskListPage;
}

/**
 * Searchable admin list of all tasks. The page server-renders the first
 * (unfiltered) page as `initialPage`; the search input re-fetches through a
 * server action so the task/user/organization filter runs against the full
 * task table, and "load more" appends the next cursor page for the active
 * query.
 */
export function TaskList({ initialPage }: TaskListProps) {
  const t = useTranslations("App.Admin.Tasks.TaskList");
  const formatter = useFormatter();

  const [tasks, setTasks] = useState<AdminTaskListItem[]>(initialPage.tasks);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  // The query the current list was fetched with. "Load more" must use this,
  // not the live input value: between a keystroke and the debounce firing the
  // input no longer matches the list, and mixing the new text with the old
  // query's cursor would splice two different result sets.
  const [activeQuery, setActiveQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // Monotonic id so out-of-order responses from rapid typing are ignored —
  // only the latest request is allowed to update the list.
  const latestRequestId = useRef(0);

  // Without a cursor the result replaces the list (new search); with a cursor
  // it appends the next page for the active query.
  function fetchPage(query: string, cursor?: string) {
    const requestId = ++latestRequestId.current;
    if (!cursor) {
      setActiveQuery(query);
    }
    startTransition(async () => {
      const result = await listAdminTasksAction({
        query: query.trim() || undefined,
        cursor,
      });
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setTasks((current) =>
        cursor ? [...current, ...result.data.tasks] : result.data.tasks,
      );
      setTotal(result.data.total);
      setNextCursor(result.data.nextCursor);
    });
  }

  const debouncedSearch = useDebouncedCallback(
    (value: string) => fetchPage(value),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    debouncedSearch(value);
  }

  function handleLoadMore() {
    if (!nextCursor) {
      return;
    }
    fetchPage(activeQuery, nextCursor);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-sm"
          aria-label={t("searchPlaceholder")}
        />
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("totalCount", { count: total })}
        </p>
      </div>

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
                <TableHead>{t("user")}</TableHead>
                <TableHead>{t("organization")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="pr-4">{t("created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="pl-4">
                    <Link
                      href={`/admin/tasks/${task.id}`}
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
                    <span className="flex flex-col">
                      <span>{task.owner.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {task.owner.email}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {task.organization ? (
                      task.organization.name
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <TaskStatusBadge status={task.status} />
                  </TableCell>
                  <TableCell className="pr-4">
                    {formatter.dateTime(task.createdAt, {
                      dateStyle: "medium",
                    })}
                  </TableCell>
                </TableRow>
              ))}
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
