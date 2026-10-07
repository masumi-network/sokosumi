import { organizationService } from "@/lib/services/organization.service";

/**
 * The address an invitation was sent to, which sign-in and sign-up keep
 * fixed. Read from Core by id so the address never travels in the URL, where
 * it would reach server logs and analytics. `undefined` when the invitation
 * is gone or cannot be read: the page then works without the lock, and the
 * invitation page explains the problem afterwards.
 */
export async function getInvitationEmail(
  invitationId: string | undefined,
): Promise<string | undefined> {
  if (!invitationId) return undefined;
  try {
    const result = await organizationService.getPendingInvitation(invitationId);
    return result.error ? undefined : result.invitation.email;
  } catch (error) {
    console.error("Could not read the invitation for sign-in", error);
    return undefined;
  }
}
