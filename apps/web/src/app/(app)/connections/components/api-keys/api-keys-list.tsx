"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";

import { getApiKeyColumns } from "./api-keys-columns";
import type { ApiKeysListProps } from "./types";

export function ApiKeysList({
  apiKeys,
  isInitialLoading,
  onToggleStatus,
  onDeleteClick,
}: ApiKeysListProps) {
  const t = useTranslations("App.Account.ApiKeys");

  const columns = useMemo(
    () => getApiKeyColumns(t, onToggleStatus, onDeleteClick),
    [t, onToggleStatus, onDeleteClick],
  );

  if (isInitialLoading) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("loading")}
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
