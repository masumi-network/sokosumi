"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEnvPublicConfig } from "@/config/env.public";
import { listAdminAgentsAction } from "@/lib/actions/admin-agents/action";
import { AgentStatus } from "@/lib/clients/generated/core";
import type {
  AdminAgentListPage,
  ListAdminAgentsParams,
} from "@/lib/services/admin-agent.service";

interface AgentListProps {
  initialPage: AdminAgentListPage;
}

type StatusFilter = "all" | AgentStatus;

interface FetchPageOptions {
  cursor?: string;
  status?: StatusFilter;
}

export function AgentList({ initialPage }: AgentListProps) {
  const t = useTranslations("App.Admin.Agents.AgentList");
  const [agents, setAgents] = useState(initialPage.agents);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeStatus, setActiveStatus] = useState<StatusFilter>("all");
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);

  function fetchPage(query: string, options: FetchPageOptions = {}) {
    const requestId = ++latestRequestId.current;
    const { cursor, status = statusFilter } = options;
    if (!cursor) {
      setActiveQuery(query);
      setActiveStatus(status);
    }
    startTransition(async () => {
      const result = await listAdminAgentsAction({
        q: query.trim() || undefined,
        cursor,
        status: status === "all" ? undefined : status,
      } satisfies ListAdminAgentsParams);
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setAgents((current) =>
        cursor ? [...current, ...result.data.agents] : result.data.agents,
      );
      setTotal(result.data.total);
      setNextCursor(result.data.nextCursor);
    });
  }

  const debouncedSearch = useDebouncedCallback(
    (value: string) => fetchPage(value, { status: statusFilter }),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    debouncedSearch(value);
  }

  function handleStatusChange(value: string) {
    const nextStatus = value as StatusFilter;
    setStatusFilter(nextStatus);
    debouncedSearch.cancel();
    fetchPage(search, { status: nextStatus });
  }

  function handleLoadMore() {
    if (!nextCursor) {
      return;
    }
    fetchPage(activeQuery, { cursor: nextCursor, status: activeStatus });
  }

  const hasActiveFilter =
    activeQuery.trim().length > 0 || activeStatus !== "all";

  const statusFilterLabel =
    activeStatus === "all"
      ? t("filterAll")
      : activeStatus === AgentStatus.ONLINE
        ? t("filterOnline")
        : activeStatus === AgentStatus.OFFLINE
          ? t("filterOffline")
          : activeStatus === AgentStatus.DEREGISTERED
            ? t("filterDeregistered")
            : t("filterInvalid");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Input
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full min-w-[16rem] sm:max-w-sm"
            aria-label={t("searchPlaceholder")}
          />
          <div className="space-y-2">
            <Label id="agent-status-filter-label">
              {t("statusFilterLabel")}
            </Label>
            <Tabs value={statusFilter} onValueChange={handleStatusChange}>
              <TabsList aria-labelledby="agent-status-filter-label">
                <TabsTrigger value="all">{t("filterAll")}</TabsTrigger>
                <TabsTrigger value={AgentStatus.ONLINE}>
                  {t("filterOnline")}
                </TabsTrigger>
                <TabsTrigger value={AgentStatus.OFFLINE}>
                  {t("filterOffline")}
                </TabsTrigger>
                <TabsTrigger value={AgentStatus.DEREGISTERED}>
                  {t("filterDeregistered")}
                </TabsTrigger>
                <TabsTrigger value={AgentStatus.INVALID}>
                  {t("filterInvalid")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums sm:pb-2">
          {hasActiveFilter
            ? t("filteredCount", {
                shown: agents.length,
                total,
              })
            : t("totalCount", { count: total })}
          {activeStatus !== "all" ? (
            <span className="sr-only">{statusFilterLabel}</span>
          ) : null}
        </p>
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {!hasActiveFilter ? t("empty") : t("emptyFilter")}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("displayName")}</TableHead>
                <TableHead>{t("registryName")}</TableHead>
                <TableHead>{t("override")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">
                    {agent.displayName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {agent.registryName}
                  </TableCell>
                  <TableCell>
                    {agent.hasOverride ? (
                      <Badge variant="secondary">{t("hasOverride")}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {t("noOverride")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{agent.status}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/agents/${agent.id}`}>
                        {t("manage")}
                      </Link>
                    </Button>
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
