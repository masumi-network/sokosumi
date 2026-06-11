import "server-only";

import type { Invitation, MemberRole } from "@sokosumi/database";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import slugify from "slugify";

import { auth } from "@/lib/auth/auth";
import { coreClient } from "@/lib/clients/core.client";

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
 * invitations (via core) and creating organizations / sending invites (via
 * Better Auth).
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
  ): Promise<Invitation[]> {
    const { data } =
      await coreClient.getOrganizationPendingInvitations(organizationId);
    return data;
  }

  /**
   * Creates an organization with the specified user as owner.
   *
   * @param name - The name of the organization.
   * @param userId - The ID of the user who will own the organization.
   * @returns Promise that resolves to the created organization or null if failed.
   */
  async function createOrganizationWithOwner(name: string, userId: string) {
    const slug = await generateOrganizationSlugFromName(name);
    const headersList = await headers();

    return await auth.api.createOrganization({
      body: {
        name,
        slug,
        userId,
      },
      headers: headersList,
    });
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
    const headersList = await headers();
    const results: BulkInviteResultRow[] = [];

    for (const email of emails) {
      try {
        await auth.api.createInvitation({
          body: {
            email,
            role,
            organizationId,
            resend: true,
          },
          headers: headersList,
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
    createOrganizationWithOwner,
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
