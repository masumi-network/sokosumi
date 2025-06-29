"use server";

import { acceptPendingInvitationsByEmailAndOrganizationId } from "@/lib/db/repositories";

export async function updatePendingInvitations(
  email: string,
  organizationId: string,
) {
  try {
    await acceptPendingInvitationsByEmailAndOrganizationId(
      email,
      organizationId,
    );
    return { success: true };
  } catch (error) {
    console.error("Error updating pending invitations", error);
    return { success: false };
  }
}
