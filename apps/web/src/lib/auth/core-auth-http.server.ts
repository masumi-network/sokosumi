import "server-only";

import { authServerClient } from "./auth.server.client";

/**
 * Updates the current user through Core Better Auth so the session cookie cache
 * stays in sync with the database.
 */
export async function updateCurrentUserViaCore(
  body: Record<string, unknown>,
): Promise<void> {
  const result = await authServerClient.updateUser(body);

  if (result.error) {
    throw new Error(
      result.error.message ??
        `Failed to update user via Core auth (${result.error.status})`,
    );
  }
}

/**
 * Creates or resends an organization invitation through Core Better Auth.
 */
export async function inviteOrganizationMemberViaCore(body: {
  email: string;
  organizationId: string;
  resend: boolean;
  role: string;
}): Promise<void> {
  const result = await authServerClient.organization.inviteMember(body);

  if (result.error) {
    throw new Error(
      result.error.message ??
        `Failed to invite organization member via Core auth (${result.error.status})`,
    );
  }
}
