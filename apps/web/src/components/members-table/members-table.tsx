"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/data-table";
import type { PendingInvitation } from "@/lib/clients/generated/core";
import { InvitationStatus, MemberRole } from "@/lib/clients/generated/core";
import { InvitationDisplayStatus } from "@/lib/constants/invitation-display-status";
import type { OrganizationMembershipSelf } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import InvitationActionsModal from "./invitation-actions-modal";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";
import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { getMembersTableColumnList } from "./members-table-columns";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { MemberRowData, OrganizationMember } from "./types";

interface MembersTableProps {
  me: OrganizationMembershipSelf;
  members: OrganizationMember[];
  pendingInvitations: PendingInvitation[];
  showSeatManagement?: boolean;
  unusedSeats?: number;
}

export default function MembersTable({
  me,
  members,
  pendingInvitations,
  showSeatManagement = false,
  unusedSeats = 0,
}: MembersTableProps) {
  const t = useTranslations("Components.MembersTable");
  const isOwnerOrAdmin =
    me.role === MemberRole.OWNER || me.role === MemberRole.ADMIN;

  return (
    <SeatManagementContextProvider
      showSeatManagement={showSeatManagement}
      unusedSeats={unusedSeats}
    >
      <MemberActionsModalContextProvider>
        <InvitationActionsModalContextProvider>
          <DataTable
            columns={getMembersTableColumnList(t, me, {
              showSeatManagement,
              includeActions: isOwnerOrAdmin,
            })}
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

function combineMembersAndPendingInvitations(
  members: OrganizationMember[],
  pendingInvitations: PendingInvitation[],
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
  member: OrganizationMember,
): MemberRowData {
  return {
    email: member.user.email,
    name: member.user.name,
    role: member.role,
    lastSeenAt: member.lastSeenAt,
    member,
  };
}

function convertInvitationToMemberRowData(
  invitation: PendingInvitation,
): MemberRowData {
  return {
    email: invitation.email,
    role:
      invitation.expiresAt > new Date()
        ? InvitationStatus.PENDING
        : InvitationDisplayStatus.EXPIRED,
    invitation,
  };
}

const RoleScoreMap: Record<string, number> = {
  [MemberRole.OWNER]: 1,
  [MemberRole.ADMIN]: 2,
  [MemberRole.MEMBER]: 3,
};
