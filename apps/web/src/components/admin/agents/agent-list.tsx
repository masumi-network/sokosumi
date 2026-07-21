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
import { getEnvPublicConfig } from "@/config/env.public";
import { listAdminAgentsAction } from "@/lib/actions/admin-agents/action";
import type {
  AdminAgentListPage,
  ListAdminAgentsParams,
} from "@/lib/services/admin-agent.service";

interface AgentListProps {
  initialPage: AdminAgentListPage;
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
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);
  const sortingRef = useRef(sorting);
  sortingRef.current = sorting;

  const columns = useMemo(
    () => getAgentListColumns(t, formatter),
    [formatter, t],
  );

  function fetchPage(
    query: string,
    cursor?: string,
    sortState: SortingState = sortingRef.current,
  ) {
    const requestId = ++latestRequestId.current;
    if (!cursor) {
      setActiveQuery(query);
    }

    const { sortBy, sortOrder } = sortingToParams(sortState);

    startTransition(async () => {
      const result = await listAdminAgentsAction({
        q: query.trim() || undefined,
        cursor,
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

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    setSorting(nextSorting);
    fetchPage(activeQuery, undefined, nextSorting);
  };

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

      {agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
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
