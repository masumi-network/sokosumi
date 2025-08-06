"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";

import { getApiKeyColumns } from "./api-keys-columns";
import { ApiKeysListProps } from "./types";

/**
 * Component that renders the API keys table with loading and empty states
 * Wraps the DataTable component with proper configuration
 */
export function ApiKeysList({
  apiKeys,
  isInitialLoading,
  onToggleStatus,
  onDeleteClick,
}: ApiKeysListProps) {
  const t = useTranslations("App.Account.ApiKeys");

  // Memoize columns to prevent unnecessary re-renders
  const columns = useMemo(
    () => getApiKeyColumns(t, onToggleStatus, onDeleteClick),
    [t, onToggleStatus, onDeleteClick],
  );

  // Loading state - only show on initial load
  if (isInitialLoading) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("loading")}
      </div>
    );
  }

  // Empty state
  if (apiKeys.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("noKeysFound")}
      </div>
    );
  }

  // Data table
  return (
    <DataTable
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
