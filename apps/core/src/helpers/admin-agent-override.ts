import type { Prisma } from "@sokosumi/database";

/**
 * Deletes an override row when every admin-editable scalar is null and both
 * collections are empty, so empty PATCH bodies do not leave a useless
 * `hasOverride` record.
 *
 * `capabilityName` / `capabilityVersion` are not part of the admin write
 * surface (marketplace never merged them). They are ignored for prune so
 * migrated leftovers cannot keep a sticky empty-looking override.
 */
export async function pruneEmptyMetadataOverride(
  tx: Prisma.TransactionClient,
  overrideId: string,
): Promise<boolean> {
  const override = await tx.agentMetadataOverride.findUnique({
    where: { id: overrideId },
    include: {
      tags: { select: { id: true }, take: 1 },
      exampleOutputs: { select: { id: true }, take: 1 },
    },
  });

  if (!override) {
    return false;
  }

  const hasScalar =
    override.name !== null ||
    override.description !== null ||
    override.apiBaseUrl !== null ||
    override.authorName !== null ||
    override.authorImage !== null ||
    override.authorContactEmail !== null ||
    override.authorContactOther !== null ||
    override.authorOrganization !== null ||
    override.legalPrivacyPolicy !== null ||
    override.legalDpa !== null ||
    override.legalTerms !== null ||
    override.legalOther !== null ||
    override.image !== null;

  if (
    hasScalar ||
    override.tags.length > 0 ||
    override.exampleOutputs.length > 0
  ) {
    return false;
  }

  await tx.agentMetadataOverride.delete({ where: { id: overrideId } });
  return true;
}
