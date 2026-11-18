import type { Prisma } from "@sokosumi/database";
import { conflict, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type SeoAuditBrief,
  type SeoBriefContent,
  saveSeoAuditBriefRequestSchema,
  seoBriefContent,
} from "@/schemas/seo-audit-brief.schema";
import {
  requireLockedSeoOwner,
  requireSeoOwner,
  requireSeoPages,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { loadBriefFollowUps } from "./seo-audit-brief-follow-up";
import {
  briefLandingEvidence,
  briefPriorities,
} from "./seo-audit-brief-priorities";

const BRIEF_KIND = "audit_brief";
const empty: SeoBriefContent = {
  objective: null,
  audience: null,
  outcome: null,
  constraints: null,
  pages: [],
};
function briefWhere(actor: SeoActor) {
  return {
    ...seoOwnerWhere(actor),
    ownerId: actor.userId,
    visibility: "PRIVATE",
    kind: BRIEF_KIND,
    source: "user",
  };
}

export async function currentBrief(
  actor: SeoActor,
  client: Prisma.TransactionClient,
) {
  return client.projectSeoObservation.findFirst({
    where: briefWhere(actor),
    orderBy: { scopeVersion: "desc" },
    select: { id: true, scopeVersion: true, payload: true, createdAt: true },
  });
}

function ownerSession(actor: SeoActor) {
  if (actor.sokoBotId)
    throw forbidden(
      "Use your own session to edit or view the private SEO brief",
    );
}

async function briefResponse(
  actor: SeoActor,
  row: Awaited<ReturnType<typeof currentBrief>>,
  client: Prisma.TransactionClient,
): Promise<SeoAuditBrief> {
  const content = row ? seoBriefContent.parse(row.payload) : empty;
  const pageIds = content.pages.map((page) => page.pageId);
  const pages = pageIds.length
    ? await client.projectSeoPage.findMany({
        where: { ...seoOwnerWhere(actor), id: { in: pageIds } },
        select: { id: true, url: true },
      })
    : [];
  const [followUps, evidence] = await Promise.all([
    loadBriefFollowUps(actor, content, pages, client),
    briefLandingEvidence(actor, pages, client),
  ]);
  return {
    ...content,
    revision: row?.scopeVersion ?? 0,
    updatedAt: row?.createdAt.toISOString() ?? null,
    followUps,
    priorities: briefPriorities(content, followUps, evidence),
  };
}

export async function getSeoBrief(actor: SeoActor): Promise<SeoAuditBrief> {
  ownerSession(actor);
  await requireSeoOwner(actor);
  return briefResponse(actor, await currentBrief(actor, prisma), prisma);
}

export async function saveSeoBrief(
  actor: SeoActor,
  raw: unknown,
): Promise<SeoAuditBrief> {
  ownerSession(actor);
  const { expectedRevision, ...content } =
    saveSeoAuditBriefRequestSchema.parse(raw);
  const artifactHash = sha256(JSON.stringify(content));
  const row = await serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    const current = await currentBrief(actor, tx);
    const revision = current?.scopeVersion ?? 0;
    const sameContent =
      JSON.stringify(content) ===
      JSON.stringify(current ? seoBriefContent.parse(current.payload) : empty);
    // A retry can arrive after the first save committed but its response was lost.
    if (sameContent && expectedRevision === revision - 1) return current;
    if (expectedRevision !== revision)
      throw conflict("The SEO brief changed. Reload it before saving.");
    const pageIds = content.pages.map((page) => page.pageId);
    if (pageIds.length) await requireSeoPages(actor, pageIds, tx);
    if (sameContent) return current;
    const nextRevision = revision + 1;
    // The unique source key makes simultaneous creates contend even on the first edit.
    const sourceKey = `audit-brief:${actor.userId}:${nextRevision}`;
    const written = await tx.projectSeoObservation.createMany({
      data: {
        ...briefWhere(actor),
        sourceKey,
        scopeVersion: nextRevision,
        pageIds,
        payload: content,
        observedAt: new Date(),
        artifactHash,
      },
      skipDuplicates: true,
    });
    if (!written.count)
      throw conflict("The SEO brief changed. Reload it before saving.");
    return currentBrief(actor, tx);
  }, "The SEO brief changed. Reload it before saving.");
  return briefResponse(actor, row, prisma);
}
