"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { Member } from "@/prisma/generated/client";

import InvitationActionsDropdown from "./invitation-actions-dropdown";
import MemberActionsDropdown from "./member-actions-dropdown";
import { MemberRowData } from "./types";

const columnHelper = createColumnHelper<MemberRowData>();

export function getMemberColumns(
  t: ReturnType<typeof useTranslations>,
  me: Member,
) {
  return {
    nameColumn: columnHelper.accessor("name", {
      id: "name",
      minSize: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.name")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.name}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberRowData>,

    emailColumn: columnHelper.accessor("email", {
      id: "email",
      minSize: 240,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.email")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.email}</div>,
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberRowData>,

    roleColumn: columnHelper.accessor("role", {
      id: "role",
      minSize: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.role")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          <OrganizationRoleBadge role={row.original.role} />
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<MemberRowData>,

    actionColumn: columnHelper.display({
      id: "actions",
      maxSize: 80,
      header: () => <div>{t("Header.actions")}</div>,
      cell: ({ row }) => {
        const { member, invitation } = row.original;
        if (member) {
          return member.id === me.id ? null : (
            <MemberActionsDropdown member={member} />
          );
        }
        if (invitation) {
          return <InvitationActionsDropdown invitation={invitation} />;
        }
        return null;
      },
    }) as ColumnDef<MemberRowData>,
  };
}
