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

/** Saves the whole brand term list as a new settings row. The newest row is the current list. */
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
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const data: Prisma.InputJsonObject = payload;
    const now = new Date();
    const result = await tx.projectSeoObservation.create({
      data: {
        ...seoOwnerData(actor),
        kind: SEO_SETTINGS_KIND,
        source: "user",
        // Saving A, then B, then A again must make A current, so every save is a new row.
        sourceKey: `settings:${randomUUID()}`,
        pageIds: [],
        artifactHash: sha256(JSON.stringify(payload)),
        payload: data,
        observedAt: now,
      },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The brand terms changed. Please retry.");
}

/** The current brand terms, or none before the first save. */
export async function loadSeoBrandTerms(
  actor: SeoActor,
): Promise<string[] | undefined> {
  const row = await prisma.projectSeoObservation.findFirst({
    where: { ...seoOwnerWhere(actor), kind: SEO_SETTINGS_KIND, ownerId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!row) return undefined;
  const parsed = seoSettingsPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data.brandTerms : undefined;
}
