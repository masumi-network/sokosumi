"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { MemberWithUser } from "@/lib/db";
import { Member } from "@/prisma/generated/client";

import MemberRowActionsDropdown from "./member-row-actions-dropdown";

const columnHelper = createColumnHelper<MemberWithUser>();

export function getMemberColumns(
  t: ReturnType<typeof useTranslations>,
  me: Member,
) {
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
      id: "actions",
      maxSize: 80,
      header: () => <div>{t("Header.actions")}</div>,
      cell: ({ row }) =>
        row.original.id === me.id ? null : (
          <MemberRowActionsDropdown member={row.original} />
        ),
    }) as ColumnDef<MemberWithUser>,
  };
}
