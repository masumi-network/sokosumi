import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

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
