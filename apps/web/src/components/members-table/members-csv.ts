import {
  InvitationStatus,
  type PendingInvitation,
} from "@sokosumi/core-client";
import { encodeTableCsv } from "@sokosumi/utils";
import { combineMembersAndPendingInvitations } from "./member-rows";
import type { OrganizationMember } from "./types";

export interface MembersCsvLabels {
  /** Name, email, role, status, joined, last seen, invited, invitation expires. */
  headers: string[];
  active: string;
  pending: string;
  expired: string;
  role: (role: string) => string;
}

/** Calendar day in UTC, so the file reads the same wherever it is opened. */
function day(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * Every member and invitation as CSV, in the members table's order. Joined is
 * when they joined this organization, not when they signed up.
 */
export function membersCsv(
  members: OrganizationMember[],
  pendingInvitations: PendingInvitation[],
  labels: MembersCsvLabels,
  now = new Date(),
): string {
  const rows = combineMembersAndPendingInvitations(
    members,
    pendingInvitations,
    now,
  ).map(({ name, email, role, member, invitation }) =>
    member
      ? [
          name,
          email,
          labels.role(member.role),
          labels.active,
          day(member.createdAt),
          day(member.lastSeenAt),
          "",
          "",
        ]
      : [
          "",
          email,
          invitation?.role ? labels.role(invitation.role) : "",
          role === InvitationStatus.PENDING ? labels.pending : labels.expired,
          "",
          "",
          day(invitation?.createdAt),
          day(invitation?.expiresAt),
        ],
  );
  return encodeTableCsv([labels.headers, ...rows]);
}
