import "server-only";

import type { MemberRole } from "@sokosumi/database";

import { getAuthServerClient } from "./auth.server.client";

/**
 * Updates the current user through Core Better Auth so the session cookie cache
 * stays in sync with the database.
 */
export async function updateCurrentUserViaCore(
  body: Record<string, unknown>,
): Promise<void> {
  const result = await getAuthServerClient().updateUser(body);

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
/**
 * Sets the current user's password through Core Better Auth when they have no
 * credential account yet (first password / link credential flow).
 */
export async function setPasswordViaCore(newPassword: string): Promise<void> {
  const result = await getAuthServerClient().setPassword({ newPassword });

  if (result.error) {
    const error = new Error(
      result.error.message ??
        `Failed to set password via Core auth (${result.error.status})`,
    ) as Error & { code?: string };

    if (result.error.code) {
      error.code = result.error.code;
    }

    throw error;
  }
}

export async function inviteOrganizationMemberViaCore(body: {
  email: string;
  organizationId: string;
  resend: boolean;
  role: MemberRole;
}): Promise<void> {
  const result = await getAuthServerClient().organization.inviteMember(body);

  if (result.error) {
    throw new Error(
      result.error.message ??
        `Failed to invite organization member via Core auth (${result.error.status})`,
    );
  }
}
