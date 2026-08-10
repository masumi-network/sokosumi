"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import Link from "next/link";
import type { useFormatter, useTranslations } from "next-intl";

import {
  DataTableColumnHeader,
  type DataTableFeatures,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminAgentListItem } from "@/lib/clients/generated/core/types.gen";

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

const columnHelper = createColumnHelper<
  DataTableFeatures,
  AdminAgentListItem
>();

export function getAgentListColumns(
  t: ReturnType<typeof useTranslations<"App.Admin.Agents.AgentList">>,
  formatter: ReturnType<typeof useFormatter>,
): ColumnDef<DataTableFeatures, AdminAgentListItem>[] {
  return [
    columnHelper.accessor("displayName", {
      id: "displayName",
      minSize: 140,
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("displayName")} />
      ),
      cell: ({ row }) => (
        <div className="font-medium">{row.original.displayName}</div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,

    columnHelper.accessor("registryName", {
      id: "registryName",
      minSize: 140,
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("registryName")} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.registryName}
        </span>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,

    columnHelper.accessor("hasOverride", {
      id: "hasOverride",
      minSize: 120,
      size: 130,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("override")} />
      ),
      cell: ({ row }) =>
        row.original.hasOverride ? (
          <Badge variant="secondary">{t("hasOverride")}</Badge>
        ) : (
          <span className="text-muted-foreground text-sm">
            {t("noOverride")}
          </span>
        ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,

    columnHelper.accessor("status", {
      id: "status",
      minSize: 100,
      size: 110,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("status")} />
      ),
      cell: ({ row }) => row.original.status,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,

    columnHelper.accessor("createdAt", {
      id: "createdAt",
      minSize: 140,
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("created")} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatter.dateTime(row.original.createdAt, dateTimeOptions)}
        </span>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,

    columnHelper.display({
      id: "actions",
      minSize: 88,
      size: 88,
      maxSize: 88,
      header: () => (
        <div className="p-2 text-right text-sm font-medium">{t("actions")}</div>
      ),
      cell: ({ row }) => (
        <div className="text-right">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/agents/${row.original.id}`}>{t("manage")}</Link>
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<DataTableFeatures, AdminAgentListItem>,
  ];
}
