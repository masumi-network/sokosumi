import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

/** Better Auth `ORGANIZATION_ERROR_CODES.USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`. */
export const USER_NOT_MEMBER_OF_ORGANIZATION_MESSAGE =
  "User is not a member of the organization";

export function isUserNotMemberOfOrganizationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === USER_NOT_MEMBER_OF_ORGANIZATION_MESSAGE
  );
}

/**
 * Set Better Auth active organization (null = personal) and persist
 * preferredOrganizationId. Persist is best-effort. In-band setActive
 * errors throw and skip persist (client returns `{ data, error }`).
 */
export async function activateOrganizationWorkspace(
  organizationId: string | null,
): Promise<void> {
  const activation = await authClient.organization.setActive({
    organizationId,
  });

  if (activation.error) {
    throw new Error(
      activation.error.message ?? "Failed to set active organization",
    );
  }

  // Drop prior workspace Instant/Chats snapshot so soft-nav never paints the
  // previous org's rooms (SOK-903). New OrganizationChatList republishes.
  clearMembershipVisibleRoomsSnapshot();

  try {
    const result = await updatePreferredOrganization({
      organizationId,
    });

    if (!result.ok) {
      console.error("Failed to persist preferred organization:", result.error);
    }
  } catch (error) {
    console.error("Failed to persist preferred organization:", error);
  }
}

export async function activateOrganizationWorkspaceWithRetry(
  organizationId: string,
): Promise<boolean> {
  for (const label of [
    "Organization workspace activation failed",
    "Organization workspace activation retry failed",
  ] as const) {
    try {
      await activateOrganizationWorkspace(organizationId);
      return true;
    } catch (error) {
      console.error(label, error);
    }
  }
  return false;
}
