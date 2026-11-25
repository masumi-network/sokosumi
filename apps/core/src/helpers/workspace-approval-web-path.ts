import prisma from "@/lib/db/prisma";

/**
 * Where a person approves Coworker access and vendor grants for their
 * personal workspace (ADR 0077).
 */
export const ACCOUNT_WEB_PATH = "/account";

/**
 * Where a person approves Coworker access and vendor grants for an
 * organization workspace: its settings in Sokosumi (ADR 0077). Falls back to
 * the active organization's settings when the id names none.
 */
export async function organizationSettingsWebPath(
  organizationId: string,
): Promise<string> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  return organization
    ? `/organizations/${encodeURIComponent(organization.slug)}`
    : "/organization";
}
