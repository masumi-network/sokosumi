import "server-only";

import { nanoid } from "nanoid";
import slugify from "slugify";
import { inviteOrganizationMemberViaCore } from "@/lib/auth/core-auth-http.server";
import { coreClient } from "@/lib/clients/core.client";
import type { PendingInvitation } from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";

export type BulkInviteResultRow = {
  email: string;
  status: "sent" | "failed";
};

/**
 * A pending invitation resolved for the accept-invitation flow, carrying the
 * organization and inviter fields the invitation card renders.
 */
export type PendingInvitationDetail = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
  organization: { id: string; name: string; slug: string };
  inviter: { id: string; email: string };
};

/**
 * Service for organization and invitation related operations: reading pending
 * invitations (via core) and sending invites (via Core Better Auth HTTP).
 */
export const organizationService = (() => {
  /**
   * Generates a unique, URL-friendly slug for an organization based on its name.
   *
   * - Converts the provided name to a lowercase, strict slug.
   * - Appends a unique 6-character ID to ensure uniqueness.
   *
   * @param name - The name of the organization to generate a slug for.
   * @returns A unique, URL-safe slug string for the organization.
   */
  async function generateOrganizationSlugFromName(name: string) {
    const slugedName = slugify(name, { lower: true, strict: true });
    const uniqueId = nanoid(6).toLowerCase();
    return `${slugedName}-${uniqueId}`;
  }

  /**
   * Retrieves a pending invitation by its ID.
   *
   * @param id - The ID of the invitation to retrieve.
   * @returns A promise that resolves to the invitation if usable, or an error
   *   if it is not found, expired, or its inviter is no longer a member.
   */
  async function getPendingInvitation(id: string): Promise<
    | {
        error: PendingInvitationErrorCode;
      }
    | {
        error?: never;
        invitation: PendingInvitationDetail;
      }
  > {
    const { data } = await coreClient.getInvitationById(id);

    switch (data.kind) {
      case "not_found":
        return { error: PendingInvitationErrorCode.NOT_FOUND };
      case "expired":
        return { error: PendingInvitationErrorCode.EXPIRED };
      case "inviter_not_found":
        return { error: PendingInvitationErrorCode.INVITER_NOT_FOUND };
      case "ok":
        return { invitation: data.invitation };
      default:
        throw new Error(
          `Unexpected invitation lookup result: ${JSON.stringify(data)}`,
        );
    }
  }

  async function getPendingInvitations(
    organizationId: string,
  ): Promise<PendingInvitation[]> {
    const { data } =
      await coreClient.getOrganizationPendingInvitations(organizationId);
    return data;
  }

  /**
   * Invites multiple members to an organization in batch.
   * Callers must verify the current user can invite members before calling.
   *
   * @param organizationId - The ID of the organization.
   * @param emails - Array of email addresses to invite.
   * @param role - The role to assign to invited members.
   * @returns Promise that resolves with one status row per email.
   */
  async function inviteMultipleMembers(
    organizationId: string,
    emails: string[],
    role: MemberRole,
  ): Promise<{ results: BulkInviteResultRow[] }> {
    const results: BulkInviteResultRow[] = [];

    for (const email of emails) {
      try {
        await inviteOrganizationMemberViaCore({
          email,
          role,
          organizationId,
          resend: true,
        });
        results.push({ email, status: "sent" });
      } catch (error) {
        console.error("Failed to invite organization member", {
          email,
          organizationId,
          error,
        });
        results.push({ email, status: "failed" });
      }
    }

    return { results };
  }

  return {
    generateOrganizationSlugFromName,
    getPendingInvitation,
    getPendingInvitations,
    inviteMultipleMembers,
  };
})();

/**
 * Error codes for pending invitations.
 */
export enum PendingInvitationErrorCode {
  EXPIRED = "EXPIRED",
  NOT_FOUND = "NOT_FOUND",
  INVITER_NOT_FOUND = "INVITER_NOT_FOUND",
}
