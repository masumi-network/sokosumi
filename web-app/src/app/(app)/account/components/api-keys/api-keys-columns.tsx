"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Apikey } from "@/prisma/generated/client";

const columnHelper = createColumnHelper<Apikey>();

export function getApiKeyColumns(
  t: ReturnType<typeof useTranslations>,
  onToggleStatus: (apiKey: Apikey) => Promise<void>,
  onDeleteClick: (apiKey: Apikey) => void,
) {
  return [
    columnHelper.accessor("name", {
      id: "name",
      minSize: 120,
      size: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.name")} />
      ),
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<Apikey>,

    columnHelper.accessor("start", {
      id: "key",
      minSize: 80,
      size: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.key")} />
      ),
      cell: ({ row }) => (
        <code className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm">
          {row.original.start ?? "••••••••"}
        </code>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<Apikey>,

    columnHelper.accessor("enabled", {
      id: "status",
      minSize: 90,
      size: 90,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.status")} />
      ),
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            row.original.enabled
              ? "bg-semantic-success/10 text-semantic-success"
              : "bg-semantic-destructive/10 text-semantic-destructive"
          }`}
        >
          {row.original.enabled ? t("Status.enabled") : t("Status.disabled")}
        </span>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<Apikey>,

    columnHelper.accessor("createdAt", {
      id: "createdAt",
      minSize: 100,
      size: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.created")} />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-center">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </div>
      ),
      enableSorting: true,
      enableHiding: true,
    }) as ColumnDef<Apikey>,

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
            onClick={(e) => {
              e.stopPropagation();
              onToggleStatus(row.original);
            }}
            title={
              row.original.enabled
                ? t("Actions.disableTooltip")
                : t("Actions.enableTooltip")
            }
          >
            {row.original.enabled ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(row.original);
            }}
            title={t("Actions.deleteTooltip")}
          >
            <Trash2 className="text-destructive h-4 w-4" />
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<Apikey>,
  ];
}
