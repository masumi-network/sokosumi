import "server-only";

import type { MemberRole } from "@/lib/clients/generated/core";

import {
  fetchCoreAuth,
  getAuthServerClient,
  getCoreAuthBaseUrl,
} from "./auth.server.client";

async function throwCoreAuthResponseError(
  response: Response,
  fallbackMessage: string,
): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  const error = new Error(body?.message ?? fallbackMessage) as Error & {
    code?: string;
  };

  if (body?.code) {
    error.code = body.code;
  }

  throw error;
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

  await throwCoreAuthResponseError(
    response,
    `Failed to set password via Core auth (${response.status})`,
  );
}

/** Resets a password through Core without exposing the token to client code. */
export async function resetPasswordViaCore(
  newPassword: string,
  token: string,
): Promise<void> {
  const response = await fetchCoreAuth(
    `${getCoreAuthBaseUrl()}/reset-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword, token }),
    },
  );

  if (response.ok) {
    return;
  }

  await throwCoreAuthResponseError(
    response,
    `Failed to reset password via Core auth (${response.status})`,
  );
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
