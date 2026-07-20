"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";

import { getOAuthClientColumns } from "./oauth-clients-columns";
import type { OAuthClientsListProps } from "./types";

export function OAuthClientsList({
  clients,
  isInitialLoading,
  onEditClick,
  onDeleteClick,
}: OAuthClientsListProps) {
  const t = useTranslations("App.Developer.OAuthClients");

  const columns = useMemo(
    () => getOAuthClientColumns(t, onEditClick, onDeleteClick),
    [t, onEditClick, onDeleteClick],
  );

  if (isInitialLoading) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("loading")}
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        {t("noClientsFound")}
      </div>
    );
  }

  return (
    <DataTable
      tableClassName="[&>table]:flex! [&>table]:md:table!"
      columns={columns}
      data={clients}
      showPagination={clients.length > 0}
      enableRowSelection={false}
      disableHover={true}
      showRowsPerPage={false}
      initialPageSize={5}
      defaultSort={[
        {
          id: "name",
          desc: false,
        },
      ]}
      containerClassName="rounded-lg"
    />
  );
}
