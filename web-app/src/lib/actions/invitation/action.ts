"use server";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { acceptPendingInvitationsByEmailAndOrganizationId } from "@/lib/db/repositories";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function updatePendingInvitations(
  email: string,
  organizationId: string,
): Promise<Result<void, ActionError>> {
  try {
    await acceptPendingInvitationsByEmailAndOrganizationId(
      email,
      organizationId,
    );
    return Ok();
  } catch (error) {
    console.error("Error updating pending invitations", error);
    return Err({
      message: "Error updating pending invitations",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
