"use server";

import { updatePendingInvitationsByEmailAndOrganizationId } from "@/lib/db";

export async function updatePendingInvitations(
  email: string,
  organizationId: string,
) {
  try {
    await updatePendingInvitationsByEmailAndOrganizationId(
      email,
      organizationId,
    );
    return { success: true };
  } catch (error) {
    console.error("Error updating pending invitations", error);
    return { success: false };
  }
}
