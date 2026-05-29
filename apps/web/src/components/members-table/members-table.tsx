"use client";

import {
  type Invitation,
  InvitationStatus,
  type Member,
  MemberRole,
  type MemberWithUser,
} from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";
import { cn } from "@/lib/utils";
import InvitationActionsModal from "./invitation-actions-modal";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";
import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";

import { getMembersTableColumns } from "./members-table-columns";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { MemberRowData } from "./types";

interface MembersTableProps {
  me: Member;
  members: MemberWithUser[];
  pendingInvitations: Invitation[];
  paidPlan?: SubscriptionPlanName | null;
  showSeatManagement?: boolean;
  unusedSeats?: number;
}

export default function MembersTable({
  me,
  members,
  pendingInvitations,
  paidPlan = null,
  showSeatManagement = false,
  unusedSeats = 0,
}: MembersTableProps) {
  const t = useTranslations("Components.MembersTable");

  return (
    <SeatManagementContextProvider
      showSeatManagement={showSeatManagement}
      unusedSeats={unusedSeats}
    >
      <MemberActionsModalContextProvider>
        <InvitationActionsModalContextProvider>
          <DataTable
            columns={getColumns(t, me, showSeatManagement, paidPlan)}
            data={combineMembersAndPendingInvitations(
              members,
              pendingInvitations,
            )}
            rowClassName={() =>
              "text-foreground active:bg-muted hover:bg-muted"
            }
            containerClassName={cn("w-full rounded-xl bg-muted/50 p-2")}
            showPagination={members.length > 10}
            showRowsPerPage={false}
            enableRowSelection={false}
            initialPageSize={10}
          />
          <MemberActionsModal />
          <InvitationActionsModal />
        </InvitationActionsModalContextProvider>
      </MemberActionsModalContextProvider>
    </SeatManagementContextProvider>
  );
}

function getColumns(
  t: ReturnType<typeof useTranslations>,
  me: Member,
  showSeatManagement: boolean,
  paidPlan: SubscriptionPlanName | null,
) {
  const {
    nameColumn,
    emailColumn,
    roleColumn,
    subscriptionColumn,
    actionColumn,
  } = getMembersTableColumns(t, me, showSeatManagement, paidPlan);
  const isOwnerOrAdmin =
    me.role === MemberRole.OWNER || me.role === MemberRole.ADMIN;

  return [nameColumn, emailColumn, roleColumn]
    .concat(showSeatManagement ? [subscriptionColumn] : [])
    .concat(isOwnerOrAdmin ? [actionColumn] : []);
}

function combineMembersAndPendingInvitations(
  members: MemberWithUser[],
  pendingInvitations: Invitation[],
): MemberRowData[] {
  // Sort members by role score, then by name
  const sortedMembers = [...members].sort((a, b) => {
    const roleScoreDiff =
      (RoleScoreMap[a.role] ?? 0) - (RoleScoreMap[b.role] ?? 0);
    const nameDiff = a.user.name.localeCompare(b.user.name);
    return roleScoreDiff !== 0 ? roleScoreDiff : nameDiff;
  });

  // Get set of member emails for quick lookup
  const memberEmails = new Set(
    sortedMembers.map((member) => member.user.email.toLowerCase()),
  );

  // Filter invitations: exclude those matching member emails
  const filteredInvitations = pendingInvitations.filter(
    (invitation) => !memberEmails.has(invitation.email.toLowerCase()),
  );

  // Convert members to row data
  const memberRows = sortedMembers.map(convertMemberWithUserToMemberRowData);

  // Convert filtered invitations to row data
  const invitationRows = filteredInvitations.map(
    convertInvitationToMemberRowData,
  );

  return memberRows.concat(invitationRows);
}

function convertMemberWithUserToMemberRowData(
  member: MemberWithUser,
): MemberRowData {
  return {
    email: member.user.email,
    name: member.user.name,
    role: member.role,
    member,
  };
}

function convertInvitationToMemberRowData(
  invitation: Invitation,
): MemberRowData {
  return {
    email: invitation.email,
    role:
      invitation.expiresAt > new Date()
        ? InvitationStatus.PENDING
        : InvitationStatus.EXPIRED,
    invitation,
  };
}

const RoleScoreMap: Record<string, number> = {
  [MemberRole.OWNER]: 1,
  [MemberRole.ADMIN]: 2,
  [MemberRole.MEMBER]: 3,
};
