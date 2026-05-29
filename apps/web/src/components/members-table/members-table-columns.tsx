"use client";

import type { Member } from "@sokosumi/database";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import type { useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { OrganizationRoleBadge } from "@/components/organizations";

import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

import InvitationActionsDropdown from "./invitation-actions-dropdown";
import MemberActionsDropdown from "./member-actions-dropdown";
import { MemberSubscriptionCell } from "./member-subscription-cell";
import type { MemberRowData } from "./types";

const columnHelper = createColumnHelper<MemberRowData>();

export function getMembersTableColumns(
  t: ReturnType<typeof useTranslations>,
  me: Member,
  showSeatManagement: boolean,
  paidPlan: SubscriptionPlanName | null,
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

    subscriptionColumn: columnHelper.display({
      id: "seat",
      minSize: 120,
      header: () => <div>{t("Header.seat")}</div>,
      cell: ({ row }) => {
        const { member } = row.original;
        if (!member) {
          return null;
        }

        return (
          <MemberSubscriptionCell
            hasPaidSeat={member.seatAssignedAt !== null}
            paidPlan={paidPlan}
          />
        );
      },
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
