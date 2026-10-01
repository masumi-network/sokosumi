"use client";

import type {
  AdminSokoBotList,
  AdminSokoBotListItem,
} from "@sokosumi/core-client";
import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAdminSokoBotsAction } from "@/lib/actions/admin-soko-bots/action";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { attentionReasons } from "./fleet-health-summary";

interface SokoBotFleetTableProps {
  initialList: AdminSokoBotList;
  limit: number;
}

/** Never used, or switched off by its owner: rarely what an operator is after. */
function isDormant(item: AdminSokoBotListItem): boolean {
  return item.archivedAt !== null || item.turnCount === 0;
}

function lastActivityTime(item: AdminSokoBotListItem): number {
  return item.lastActivityAt ? new Date(item.lastActivityAt).getTime() : 0;
}

/**
 * Fleet table, most recently active first. Server-renders the first page; typing re-queries Core through
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
  const [showDormant, setShowDormant] = useState(false);
  const dormantSwitchId = useId();
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

  const dormantCount = list.items.filter(isDormant).length;
  // A search is a question about specific bots; answer it in full.
  const includeDormant = showDormant || search.trim().length > 0;
  const rows = useMemo(
    () =>
      list.items
        .filter((item) => includeDormant || !isDormant(item))
        .sort((a, b) => lastActivityTime(b) - lastActivityTime(a)),
    [list.items, includeDormant],
  );

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
        <div className="flex items-center gap-2">
          <Switch
            id={dormantSwitchId}
            checked={showDormant}
            onCheckedChange={setShowDormant}
            disabled={dormantCount === 0}
          />
          <Label
            htmlFor={dormantSwitchId}
            className="text-muted-foreground text-xs font-normal tabular-nums"
          >
            {t("showDormant", { count: dormantCount })}
          </Label>
        </div>
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
              <TableHead>{t("version")}</TableHead>
              <TableHead className="text-right">{t("turns")}</TableHead>
              <TableHead className="text-right">{t("lastActivity")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("chat")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      href={`${ADMIN_SOKO_BOTS_ROUTE}/${item.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.name ?? t("unnamed")}
                    </Link>
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
                      {attentionReasons(item).map((reason) =>
                        reason.kind === "failures" ||
                        reason.kind === "pending" ? (
                          <StatusBadge
                            key={reason.kind}
                            tone={
                              reason.kind === "failures" ? "danger" : "warning"
                            }
                          >
                            {t(reason.kind, { count: reason.count })}
                          </StatusBadge>
                        ) : null,
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.versionId ? (
                      <StatusBadge tone="neutral">{item.versionId}</StatusBadge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.turnCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                    {item.lastActivityAt
                      ? format.dateTime(item.lastActivityAt, "dateTimeShort")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`${ADMIN_SOKO_BOTS_ROUTE}/${item.id}/chat`}>
                        <MessageSquare aria-hidden className="size-3.5" />
                        {t("chat")}
                      </Link>
                    </Button>
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
