"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DeveloperSectionRowsSkeleton } from "@/app/developer/components/developer-loading-view";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";

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

  const columns = useMemo(
    () => getApiKeyColumns(t, onToggleStatus, onDeleteClick),
    [t, onToggleStatus, onDeleteClick],
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
    <DataTable
      tableClassName="[&>table]:flex! [&>table]:md:table!"
      columns={columns}
      data={apiKeys}
      showPagination={apiKeys.length > 0}
      enableRowSelection={false}
      disableHover={true}
      showRowsPerPage={false}
      initialPageSize={5}
      defaultSort={[
        {
          id: "createdAt",
          desc: true,
        },
      ]}
      containerClassName="rounded-lg"
    />
  );
}
