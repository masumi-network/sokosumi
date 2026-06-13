import "server-only";

import { headers } from "next/headers";

import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

const CORE_AUTH_REQUEST_TIMEOUT_MS = 5000;

async function postCoreAuth(
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const url = new URL(joinCoreApiPath(getServerCoreAppBaseUrl(), path));

  return fetch(url, {
    method: "POST",
    headers: {
      ...Object.fromEntries(buildAuthHeaders(await headers()).entries()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(CORE_AUTH_REQUEST_TIMEOUT_MS),
  });
}

/**
 * Updates the current user through Core Better Auth so the session cookie cache
 * stays in sync with the database.
 */
export async function updateCurrentUserViaCore(
  body: Record<string, unknown>,
): Promise<void> {
  const response = await postCoreAuth("/auth/update-user", body);

  if (!response.ok) {
    throw new Error(`Failed to update user via Core auth (${response.status})`);
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
  const response = await postCoreAuth("/auth/organization/invite-member", body);

  if (!response.ok) {
    throw new Error(
      `Failed to invite organization member via Core auth (${response.status})`,
    );
  }
}
