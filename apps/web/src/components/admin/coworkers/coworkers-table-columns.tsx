"use client";

import Link from "next/link";
import type { useFormatter, useTranslations } from "next-intl";

import {
  createAppColumnHelper,
  DataTableColumnHeader,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

const columnHelper = createAppColumnHelper<Coworker>();

function isArchived(coworker: Coworker): boolean {
  return coworker.archivedAt != null;
}

export function getCoworkersTableColumns(
  t: ReturnType<typeof useTranslations<"App.Admin.Coworkers.Table">>,
  formatter: ReturnType<typeof useFormatter>,
) {
  return columnHelper.columns([
    columnHelper.accessor("name", {
      id: "name",
      minSize: 120,
      size: 140,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("name")} />
      ),
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
      enableSorting: true,
      enableHiding: false,
    }),

    columnHelper.accessor("slug", {
      id: "slug",
      minSize: 100,
      size: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("slug")} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.slug}</span>
      ),
      enableSorting: true,
      enableHiding: false,
    }),

    columnHelper.accessor((row) => isArchived(row), {
      id: "status",
      minSize: 100,
      size: 110,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("status")} />
      ),
      cell: ({ row }) =>
        isArchived(row.original) ? (
          <Badge variant="secondary">{t("archived")}</Badge>
        ) : (
          <Badge variant="outline">{t("active")}</Badge>
        ),
      enableSorting: true,
      enableHiding: false,
    }),

    columnHelper.accessor("isWhitelisted", {
      id: "isWhitelisted",
      minSize: 120,
      size: 130,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("whitelist")} />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.isWhitelisted ? "default" : "secondary"}>
          {row.original.isWhitelisted ? t("whitelisted") : t("notWhitelisted")}
        </Badge>
      ),
      enableSorting: true,
      enableHiding: false,
    }),

    columnHelper.accessor("priority", {
      id: "priority",
      minSize: 80,
      size: 88,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("priority")}
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{row.original.priority}</div>
      ),
      enableSorting: true,
      enableHiding: false,
    }),

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
    }),

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
            <Link href={`/admin/coworkers/${row.original.id}`}>
              {t("edit")}
            </Link>
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
  ]);
}
