import * as Sentry from "@sentry/node";
import {
  buildOrganizationMetadataWithUrl,
  createOrganizationSlug,
} from "@sokosumi/utils";

import { getUserWorkspace } from "@/helpers/user-workspaces";
import { auth } from "@/lib/auth";
import { setPreferredOrganizationId } from "@/services/preferred-workspace.service";

/**
 * Creates an organization the person owns, with its website in the metadata,
 * and makes it preferred. The organization limit applies (Better Auth
 * throws). Returns its workspace as `/v1/users/me/workspaces` lists it.
 */
export async function createOrganizationWorkspace(
  userId: string,
  input: { name: string; websiteUrl: string },
) {
  // No headers: Better Auth treats a userId body as a system action for
  // that user and still runs the organization hooks.
  const organization = await auth.api.createOrganization({
    body: {
      name: input.name,
      slug: createOrganizationSlug(input.name),
      metadata: buildOrganizationMetadataWithUrl(null, input.websiteUrl) ?? {},
      userId,
    },
  });
  // The organization exists now; a failed preference only leaves it
  // unpreferred, so it must not turn into an error that a retry answers with
  // a second organization.
  try {
    await setPreferredOrganizationId(userId, organization.id);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        organizationId: organization.id,
        errorType: "workspace-create-set-preferred",
      },
    });
  }
  return getUserWorkspace(userId, { organizationId: organization.id });
}
