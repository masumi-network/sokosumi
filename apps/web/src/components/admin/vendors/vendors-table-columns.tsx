"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import Link from "next/link";
import type { useFormatter, useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import type { Vendor } from "@/lib/clients/generated/core";

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

const columnHelper = createColumnHelper<Vendor>();

export function getVendorsTableColumns(
  t: ReturnType<typeof useTranslations<"App.Admin.Vendors.Table">>,
  formatter: ReturnType<typeof useFormatter>,
): ColumnDef<Vendor>[] {
  return [
    columnHelper.accessor("name", {
      id: "name",
      minSize: 140,
      size: 180,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("name")} />
      ),
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<Vendor>,

    columnHelper.accessor("slug", {
      id: "slug",
      minSize: 120,
      size: 140,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("slug")} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.slug}</span>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<Vendor>,

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
    }) as ColumnDef<Vendor>,

    columnHelper.accessor("updatedAt", {
      id: "updatedAt",
      minSize: 140,
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("updated")} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatter.dateTime(row.original.updatedAt, dateTimeOptions)}
        </span>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<Vendor>,

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
            <Link href={`/admin/vendors/${row.original.id}`}>{t("edit")}</Link>
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<Vendor>,
  ];
}
