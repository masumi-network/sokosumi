"use client";

import type { Member } from "@sokosumi/database";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { DataTableColumnHeader } from "@/components/data-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import InvitationActionsDropdown from "./invitation-actions-dropdown";
import MemberActionsDropdown from "./member-actions-dropdown";
import type { MemberRowData } from "./types";

const columnHelper = createColumnHelper<MemberRowData>();

export function getMembersTableColumns(
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

    seatColumn: columnHelper.display({
      id: "seat",
      minSize: 120,
      header: () => <div>{t("Header.seat")}</div>,
      cell: ({ row }) => <SeatStatusCell member={row.original.member} />,
    }) as ColumnDef<MemberRowData>,

    actionColumn: columnHelper.display({
      id: "actions",
      maxSize: 80,
      header: () => <div>{t("Header.actions")}</div>,
      cell: ({ row }) => {
        const { member, invitation } = row.original;
        if (member) {
          return member.id === me.id ? null : (
            <MemberActionsDropdown me={me} member={member} />
          );
        }
        if (invitation) {
          return <InvitationActionsDropdown me={me} invitation={invitation} />;
        }
        return null;
      },
    }) as ColumnDef<MemberRowData>,
  };
}

function SeatStatusCell({ member }: { member: MemberRowData["member"] }) {
  const t = useTranslations("Components.MembersTable.Seat");

  if (!member) {
    return null;
  }

  const isAssigned = member.seatAssignedAt !== null;
  const label = isAssigned ? t("assigned") : t("unassigned");

  return (
    <div className="p-2">
      <span
        className={
          isAssigned
            ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
            : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
        }
      >
        {label}
      </span>
    </div>
  );
}
