import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { MemberWithUser } from "@/lib/db";

const columnHelper = createColumnHelper<MemberWithUser>();

export function getMemberColumns(t: ReturnType<typeof useTranslations>) {
  return {
    nameColumn: columnHelper.accessor("user.name", {
      id: "name",
      minSize: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.name")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.user.name}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberWithUser>,

    emailColumn: columnHelper.accessor("user.email", {
      id: "email",
      minSize: 240,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.email")} />
      ),
      cell: ({ row }) => <div>{row.original.user.email}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberWithUser>,

    roleColumn: columnHelper.accessor("role", {
      id: "role",
      minSize: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.role")} />
      ),
      cell: ({ row }) => (
        <div>
          <OrganizationRoleBadge role={row.original.role} />
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberWithUser>,

    actionColumn: columnHelper.display({
      id: "action",
      maxSize: 80,
      header: () => <div>{t("Header.action")}</div>,
      cell: () => (
        <div>
          <Ellipsis />
        </div>
      ),
    }) as ColumnDef<MemberWithUser>,
  };
}
