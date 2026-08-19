"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import {
  AutonomyBadge,
  SokoBotStatusBadge,
} from "@/components/soko-bot/soko-bot-badges";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAdminSokoBotsAction } from "@/lib/actions/admin-soko-bots/action";
import type { AdminSokoBotList } from "@/lib/clients/generated/core";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface SokoBotFleetTableProps {
  initialList: AdminSokoBotList;
  limit: number;
}

/**
 * Fleet table. Server-renders the first page; typing re-queries Core through
 * a server action (owner name/email/bot name) so the filter runs over the
 * whole fleet, not the loaded page.
 */
export function SokoBotFleetTable({
  initialList,
  limit,
}: SokoBotFleetTableProps) {
  const t = useTranslations("App.Admin.SokoBots.Fleet");
  const format = useFormatter();
  const [list, setList] = useState(initialList);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);

  const runSearch = useDebouncedCallback((query: string) => {
    const requestId = ++latestRequestId.current;
    startTransition(async () => {
      const result = await listAdminSokoBotsAction({
        query: query.trim() || undefined,
        limit,
      });
      if (requestId !== latestRequestId.current) return;
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setList(result.value);
    });
  }, 300);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            runSearch(event.target.value);
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="max-w-sm"
        />
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("totalCount", { count: list.total })}
        </p>
      </div>

      <div
        className={cn("rounded-md border", isPending && "opacity-70")}
        aria-busy={isPending}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("bot")}</TableHead>
              <TableHead>{t("owner")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("autonomy")}</TableHead>
              <TableHead className="text-right">{t("turns")}</TableHead>
              <TableHead className="text-right">{t("pending")}</TableHead>
              <TableHead className="text-right">{t("schedules")}</TableHead>
              <TableHead className="text-right">{t("failures")}</TableHead>
              <TableHead>{t("runtime")}</TableHead>
              <TableHead>{t("lastActivity")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      href={`${ADMIN_SOKO_BOTS_ROUTE}/${item.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.name ?? t("unnamed")}
                    </Link>
                    <span className="text-muted-foreground block font-mono text-xs">
                      {item.id.slice(0, 8)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate">
                      {item.owner.name ?? "—"}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {item.owner.email}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SokoBotStatusBadge status={item.status} />
                      {item.archivedAt ? (
                        <StatusBadge tone="neutral">
                          {t("archived")}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <AutonomyBadge level={item.autonomyLevel} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.turnCount}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      item.pendingDecisionCount > 0 && "text-semantic-warning",
                    )}
                  >
                    {item.pendingDecisionCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.scheduleCount}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      item.consecutiveTurnFailures > 0 &&
                        "text-semantic-destructive",
                    )}
                  >
                    {item.consecutiveTurnFailures}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {item.runtimeVersion ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">
                    {item.lastActivityAt
                      ? format.dateTime(item.lastActivityAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
