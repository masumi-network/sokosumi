import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";

import { searchOrganizationsAction, searchUsersAction } from "./action";

/**
 * Client-side wrappers around the admin search server actions that unwrap the
 * `Result` into a plain array (throwing on error) so they can be passed
 * directly to `AsyncSearchCombobox`'s `search` prop.
 */
export async function searchOrganizationsClient(
  query: string,
): Promise<AdminOrganizationOption[]> {
  const result = await searchOrganizationsAction({ query });
  if (!result.ok) {
    throw new Error(result.error.message ?? "Failed to search organizations");
  }
  return result.value;
}

export async function searchUsersClient(
  query: string,
): Promise<AdminUserOption[]> {
  const result = await searchUsersAction({ query });
  if (!result.ok) {
    throw new Error(result.error.message ?? "Failed to search users");
  }
  return result.value;
}
