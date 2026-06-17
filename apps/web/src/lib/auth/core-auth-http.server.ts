import "server-only";

import type { MemberRole } from "@sokosumi/utils";

import {
  fetchCoreAuth,
  getAuthServerClient,
  getCoreAuthBaseUrl,
} from "./auth.server.client";

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
 * Sets the current user's password through Core Better Auth when they have no
 * credential account yet (first password / link credential flow).
 *
 * Uses a direct HTTP POST because Better Auth marks `setPassword` as
 * server-only and omits it from the typed client surface.
 */
export async function setPasswordViaCore(newPassword: string): Promise<void> {
  const response = await fetchCoreAuth(`${getCoreAuthBaseUrl()}/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });

  if (response.ok) {
    return;
  }

  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;

  const error = new Error(
    body?.message ??
      `Failed to set password via Core auth (${response.status})`,
  ) as Error & { code?: string };

  if (body?.code) {
    error.code = body.code;
  }

  throw error;
}

/**
 * Creates or resends an organization invitation through Core Better Auth.
 */
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
