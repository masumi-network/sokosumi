import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  saveSeoBrandTermsSchema,
  seoSettingsPayloadSchema,
} from "@/schemas/project-seo-traffic.schema";
import {
  commitSeoMutation,
  requireLockedSeoOwner,
  type SeoMutationHooks,
  seoOwnerData,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";

/** Settings rows are not evidence of a page: they cover no page and stay out of the evidence load. */
export const SEO_SETTINGS_KIND = "settings";

/** The same term written twice, in another case or form, is one term. First spelling wins. */
export function uniqueSeoBrandTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.normalize("NFKC").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function seoSettingsWhere(actor: SeoActor) {
  return { ...seoOwnerWhere(actor), kind: SEO_SETTINGS_KIND, ownerId: null };
}
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/**
 * Saves the whole brand term list. The same list as the current one writes nothing.
 * A new list replaces the old rows: nothing reads settings history, so only the
 * newest row is kept.
 */
export async function saveProjectSeoBrandTerms(
  actor: SeoActor,
  raw: unknown,
  hooks: SeoMutationHooks = {},
) {
  const input = saveSeoBrandTermsSchema.parse(raw);
  const payload = seoSettingsPayloadSchema.parse({
    version: 1,
    kind: SEO_SETTINGS_KIND,
    brandTerms: uniqueSeoBrandTerms(input.terms),
    recordedBy: actor.userId,
  });
  // The terms alone decide the hash: the same list saved by someone else is no change.
  const artifactHash = sha256(JSON.stringify(payload.brandTerms));
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const newest = await tx.projectSeoObservation.findFirst({
      where: seoSettingsWhere(actor),
      orderBy: NEWEST_FIRST,
    });
    if (newest?.artifactHash === artifactHash)
      return commitSeoMutation(tx, newest, hooks);
    const data: Prisma.InputJsonObject = payload;
    const result = await tx.projectSeoObservation.create({
      data: {
        ...seoOwnerData(actor),
        kind: SEO_SETTINGS_KIND,
        source: "user",
        // Saving A, then B, then A again must make A current, so every change is a new row.
        sourceKey: `settings:${randomUUID()}`,
        pageIds: [],
        artifactHash,
        payload: data,
        observedAt: new Date(),
      },
    });
    await tx.projectSeoObservation.deleteMany({
      where: { ...seoSettingsWhere(actor), id: { not: result.id } },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The brand terms changed. Please retry.");
}

/** The current brand terms, or none before the first save. */
export async function loadSeoBrandTerms(
  actor: SeoActor,
): Promise<string[] | undefined> {
  const row = await prisma.projectSeoObservation.findFirst({
    where: seoSettingsWhere(actor),
    orderBy: NEWEST_FIRST,
  });
  if (!row) return undefined;
  const parsed = seoSettingsPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data.brandTerms : undefined;
}
