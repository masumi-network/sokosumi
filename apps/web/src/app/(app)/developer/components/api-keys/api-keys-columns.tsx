"use client";

import type { useFormatter, useTranslations } from "next-intl";

import { createAppColumnHelper } from "@/components/data-table/create-data-table-hook";
import DataTableColumnHeader from "@/components/data-table/data-table-column-header";

import {
  ApiKeyActions,
  ApiKeyLastUsed,
  ApiKeyStatus,
} from "./api-key-row-parts";
import type { ApiKeyRecord } from "./types";

const columnHelper = createAppColumnHelper<ApiKeyRecord>();

export function getApiKeyColumns(
  t: ReturnType<typeof useTranslations>,
  formatter: ReturnType<typeof useFormatter>,
  onToggleStatus: (apiKey: ApiKeyRecord) => Promise<void>,
  onDeleteClick: (apiKey: ApiKeyRecord) => void,
) {
  return columnHelper.columns([
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
    }),

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
    }),

    columnHelper.accessor("enabled", {
      id: "status",
      minSize: 90,
      size: 90,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.status")} />
      ),
      cell: ({ row }) => <ApiKeyStatus apiKey={row.original} t={t} />,
      enableSorting: true,
      enableHiding: false,
    }),

    columnHelper.accessor("createdAt", {
      id: "createdAt",
      minSize: 100,
      size: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.created")} />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-center">
          {formatter.dateTime(new Date(row.original.createdAt), {
            dateStyle: "medium",
          })}
        </div>
      ),
      enableSorting: true,
      enableHiding: true,
    }),

    columnHelper.accessor("lastRequest", {
      id: "lastUsed",
      minSize: 100,
      size: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.lastUsed")} />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground text-center">
          <ApiKeyLastUsed apiKey={row.original} t={t} bare />
        </div>
      ),
      enableSorting: false,
      enableHiding: true,
    }),

    columnHelper.display({
      id: "actions",
      minSize: 80,
      size: 80,
      maxSize: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Table.actions")} />
      ),
      cell: ({ row }) => (
        <ApiKeyActions
          apiKey={row.original}
          t={t}
          onToggleStatus={onToggleStatus}
          onDeleteClick={onDeleteClick}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }),
  ]);
}
