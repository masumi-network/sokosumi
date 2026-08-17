import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

/**
 * Set Better Auth active organization (null = personal) and persist
 * preferredOrganizationId. Persist is best-effort; setActive still throws.
 */
export async function activateOrganizationWorkspace(
  organizationId: string | null,
): Promise<void> {
  await authClient.organization.setActive({
    organizationId,
  });

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
