"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import type { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";

import type { OAuthClientRecord } from "./types";
import { formatRedirectUrisSummary } from "./utils";

const columnHelper = createColumnHelper<OAuthClientRecord>();

export function getOAuthClientColumns(
  t: ReturnType<typeof useTranslations>,
  onEditClick: (client: OAuthClientRecord) => void,
  onDeleteClick: (client: OAuthClientRecord) => void,
) {
  return [
    columnHelper.accessor("client_name", {
      id: "name",
      minSize: 120,
      size: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.name")} />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.client_name || row.original.client_id}
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<OAuthClientRecord>,

    columnHelper.accessor("client_id", {
      id: "clientId",
      minSize: 160,
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.clientId")} />
      ),
      cell: ({ row }) => (
        <code className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm">
          {row.original.client_id}
        </code>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<OAuthClientRecord>,

    columnHelper.accessor("redirect_uris", {
      id: "redirectUris",
      minSize: 200,
      size: 200,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("Table.redirectUris")}
        />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-sm">
          {formatRedirectUrisSummary(row.original.redirect_uris, (count) =>
            t("Table.redirectUrisMore", { count }),
          )}
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<OAuthClientRecord>,

    columnHelper.display({
      id: "actions",
      minSize: 80,
      size: 80,
      maxSize: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.actions")} />
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-end space-x-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onEditClick(row.original);
            }}
            title={t("Actions.editTooltip")}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteClick(row.original);
            }}
            title={t("Actions.deleteTooltip")}
          >
            <Trash2 className="text-destructive size-4" />
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<OAuthClientRecord>,
  ];
}
