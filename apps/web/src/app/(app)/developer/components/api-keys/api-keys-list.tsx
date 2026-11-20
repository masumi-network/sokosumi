"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { DeveloperSectionRowsSkeleton } from "@/app/developer/components/developer-loading-view";
import DataTable from "@/components/data-table/data-table";
import {
  usePageListSearch,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { Button } from "@/components/ui/button";

import { ApiKeyActions, ApiKeyStatus } from "./api-key-row-parts";
import { getApiKeyColumns } from "./api-keys-columns";
import type { ApiKeysListProps } from "./types";

export function ApiKeysList({
  apiKeys,
  isInitialLoading,
  error,
  onRetry,
  onToggleStatus,
  onDeleteClick,
}: ApiKeysListProps) {
  const t = useTranslations("App.Account.ApiKeys");
  const formatter = useFormatter();

  // Newest first, like the table's default sort.
  const newestFirst = [...apiKeys].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const visible = usePageListSearch(newestFirst, (key) => ({
    primary: [key.name, key.start],
    secondary: [t(key.enabled ? "Status.enabled" : "Status.disabled")],
  }));
  const searching = Boolean(usePageSearchQuery());

  const columns = useMemo(
    () => getApiKeyColumns(t, formatter, onToggleStatus, onDeleteClick),
    [t, formatter, onToggleStatus, onDeleteClick],
  );

  if (isInitialLoading) {
    return <DeveloperSectionRowsSkeleton />;
  }

  // Full error UI only when there is nothing useful to show. If a later
  // refresh fails but we still have keys, keep the list and rely on the toast.
  if (error && apiKeys.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-muted-foreground text-sm">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (apiKeys.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("noKeysFound")}
      </div>
    );
  }

  return (
    <>
      {/* Phones: one stacked row per key, so status and actions stay on screen. */}
      <ul className="divide-border divide-y rounded-lg border md:hidden">
        {visible.map((apiKey) => (
          <li key={apiKey.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-medium">{apiKey.name}</p>
                <ApiKeyStatus apiKey={apiKey} t={t} />
              </div>
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <code className="bg-muted rounded px-1 font-mono">
                  {apiKey.start ?? "••••••••"}
                </code>
                {formatter.dateTime(new Date(apiKey.createdAt), {
                  dateStyle: "medium",
                })}
              </p>
            </div>
            <ApiKeyActions
              apiKey={apiKey}
              t={t}
              onToggleStatus={onToggleStatus}
              onDeleteClick={onDeleteClick}
            />
          </li>
        ))}
      </ul>
      <DataTable
        columns={columns}
        key={searching ? "search" : "all"}
        data={[...visible]}
        showPagination={visible.length > 0}
        enableRowSelection={false}
        disableHover={true}
        showRowsPerPage={false}
        initialPageSize={5}
        defaultSort={
          searching
            ? []
            : [
                {
                  id: "createdAt",
                  desc: true,
                },
              ]
        }
        containerClassName="hidden rounded-lg md:flex"
      />
    </>
  );
}
