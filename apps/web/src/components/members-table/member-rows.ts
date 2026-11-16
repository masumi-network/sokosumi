import type { PendingInvitation } from "@sokosumi/core-client";
import { InvitationStatus, MemberRole } from "@sokosumi/core-client";
import { InvitationDisplayStatus } from "@/lib/constants/invitation-display-status";
import type { MemberRowData, OrganizationMember } from "./types";

/** The members table's rows: members by role then name, then invitations to people not yet in. */
export function combineMembersAndPendingInvitations(
  members: OrganizationMember[],
  pendingInvitations: PendingInvitation[],
  now = new Date(),
): MemberRowData[] {
  const sortedMembers = [...members].sort((a, b) => {
    const roleScoreDiff =
      (RoleScoreMap[a.role] ?? 0) - (RoleScoreMap[b.role] ?? 0);
    const nameDiff = a.user.name.localeCompare(b.user.name);
    return roleScoreDiff !== 0 ? roleScoreDiff : nameDiff;
  });

  const memberEmails = new Set(
    sortedMembers.map((member) => member.user.email.toLowerCase()),
  );

  const filteredInvitations = pendingInvitations.filter(
    (invitation) => !memberEmails.has(invitation.email.toLowerCase()),
  );

  const memberRows = sortedMembers.map(convertMemberWithUserToMemberRowData);

  const invitationRows = filteredInvitations.map((invitation) =>
    convertInvitationToMemberRowData(invitation, now),
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
  now: Date,
): MemberRowData {
  return {
    email: invitation.email,
    role:
      invitation.expiresAt > now
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
