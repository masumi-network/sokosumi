"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { TaskDueBadge } from "@/app/tasks/components/task-due-badge";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { Button } from "@/components/ui/button";

import { loadMoreMyDay } from "../actions";
import type { MyDayPage } from "./my-day";

interface MyDayListProps {
  /** The day the first page was read for, so later pages ask the same. */
  today: string;
  initial: MyDayPage;
}

/** My day's rows, and the next page of the same query in place. */
export function MyDayList({ today, initial }: MyDayListProps) {
  const t = useTranslations("App.Chat.Landing.MyDay");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const left = Math.max(initial.total - rows.length, 0);

  function handleShowMore() {
    if (!cursor || isPending) return;
    startTransition(async () => {
      const page = await loadMoreMyDay({ today, cursor });
      if (!page) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setRows((previous) => {
        const seen = new Set(previous.map((row) => row.id));
        return [...previous, ...page.rows.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    });
  }

  return (
    <>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} data-testid="home-my-day-row">
            <Link
              href={row.href}
              className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2"
            >
              <TaskStatusBadge
                status={row.status}
                label={tStatus(row.status)}
                showLabel={false}
                className="border-0 bg-transparent p-0"
              />
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                {row.name}
              </span>
              {row.dueOn ? (
                <TaskDueBadge
                  dueOn={row.dueOn}
                  status={row.status}
                  className="shrink-0 text-sm"
                />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {cursor && left > 0 ? (
        <div className="flex flex-wrap items-center gap-3 px-3 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={isPending}
            onClick={handleShowMore}
          >
            {t("more", { count: left })}
          </Button>
          {failed ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("error")}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
