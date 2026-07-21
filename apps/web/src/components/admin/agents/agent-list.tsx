"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { listAdminAgentsAction } from "@/lib/actions/admin-agents/action";
import type {
  AdminAgentListPage,
  ListAdminAgentsParams,
} from "@/lib/services/admin-agent.service";

interface AgentListProps {
  initialPage: AdminAgentListPage;
}

export function AgentList({ initialPage }: AgentListProps) {
  const t = useTranslations("App.Admin.Agents.AgentList");
  const [agents, setAgents] = useState(initialPage.agents);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);

  function fetchPage(query: string, cursor?: string) {
    const requestId = ++latestRequestId.current;
    if (!cursor) {
      setActiveQuery(query);
    }
    startTransition(async () => {
      const result = await listAdminAgentsAction({
        q: query.trim() || undefined,
        cursor,
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
