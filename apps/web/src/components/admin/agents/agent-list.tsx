"use client";

import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { getAgentListColumns } from "@/components/admin/agents/agent-list-columns";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  sortState?: SortingState;
}

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMN_TO_API = {
  displayName: "displayName",
  registryName: "registryName",
  hasOverride: "hasOverride",
  status: "status",
  createdAt: "createdAt",
} as const satisfies Record<
  string,
  NonNullable<ListAdminAgentsParams["sortBy"]>
>;

function sortingToParams(
  sorting: SortingState,
): Pick<ListAdminAgentsParams, "sortBy" | "sortOrder"> {
  const activeSort = sorting[0];
  if (!activeSort) {
    return { sortBy: "createdAt", sortOrder: "desc" };
  }

  const sortBy =
    SORT_COLUMN_TO_API[activeSort.id as keyof typeof SORT_COLUMN_TO_API] ??
    "createdAt";

  return {
    sortBy,
    sortOrder: activeSort.desc ? "desc" : "asc",
  };
}

export function AgentList({ initialPage }: AgentListProps) {
  const t = useTranslations("App.Admin.Agents.AgentList");
  const formatter = useFormatter();
  const [agents, setAgents] = useState(initialPage.agents);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeStatus, setActiveStatus] = useState<StatusFilter>("all");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);
  const sortingRef = useRef(sorting);
  sortingRef.current = sorting;

  const columns = useMemo(
    () => getAgentListColumns(t, formatter),
    [formatter, t],
  );

  function fetchPage(query: string, options: FetchPageOptions = {}) {
    const requestId = ++latestRequestId.current;
    const {
      cursor,
      status = statusFilter,
      sortState = sortingRef.current,
    } = options;
    if (!cursor) {
      setActiveQuery(query);
      setActiveStatus(status);
    }

    const { sortBy, sortOrder } = sortingToParams(sortState);

    startTransition(async () => {
      const result = await listAdminAgentsAction({
        q: query.trim() || undefined,
        cursor,
        status: status === "all" ? undefined : status,
        sortBy,
        sortOrder,
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

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    setSorting(nextSorting);
    fetchPage(activeQuery, {
      status: activeStatus,
      sortState: nextSorting,
    });
  };

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
          <DataTable
            columns={columns}
            data={agents}
            containerClassName="space-y-0"
            tableHeaderClassName="bg-muted/50"
            showPagination={false}
            enableRowSelection={false}
            disableHover
            manualSorting
            sorting={sorting}
            onSortingChange={handleSortingChange}
          />
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
