"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { Badge } from "@/components/ui/badge";
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
import { listAdminUsersAction } from "@/lib/actions/admin-users/action";
import type {
  AdminUserOverviewItem,
  AdminUserOverviewPage,
} from "@/lib/services/admin-user.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface UserListProps {
  initialPage: AdminUserOverviewPage;
}

/**
 * Searchable admin list of all users. The page server-renders the first
 * (unfiltered) page as `initialPage`; the search input re-fetches through a
 * server action so the name/email filter runs against the full user table,
 * and "load more" appends the next cursor page for the active query.
 */
export function UserList({ initialPage }: UserListProps) {
  const t = useTranslations("App.Admin.Users.UserList");
  const formatter = useFormatter();

  const [users, setUsers] = useState<AdminUserOverviewItem[]>(
    initialPage.users,
  );
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
      const result = await listAdminUsersAction({
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
      setUsers((current) =>
        cursor ? [...current, ...result.value.users] : result.value.users,
      );
      setTotal(result.value.total);
      setNextCursor(result.value.nextCursor);
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

      {users.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("user")}</TableHead>
                <TableHead className="text-right">{t("credits")}</TableHead>
                <TableHead>{t("subscription")}</TableHead>
                <TableHead className="text-right">
                  {t("startedTasks")}
                </TableHead>
                <TableHead className="pr-4">{t("registered")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="pl-4">
                    <span className="flex flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {user.email}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatter.number(formatCreditsForDisplay(user.credits))}
                  </TableCell>
                  <TableCell>
                    {user.subscriptionPlan ? (
                      <span className="flex items-center gap-2">
                        <span>{user.subscriptionPlan}</span>
                        {user.subscriptionStatus ? (
                          <Badge
                            variant={
                              user.subscriptionStatus === "active"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {user.subscriptionStatus}
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatter.number(user.startedTaskCount)}
                  </TableCell>
                  <TableCell className="pr-4">
                    {formatter.dateTime(user.createdAt, {
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
