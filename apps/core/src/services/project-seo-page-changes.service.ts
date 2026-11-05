import type { Prisma } from "@sokosumi/database";
import { badRequest, conflict } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  recordSeoPageChangeSchema,
  SEO_PAGE_CHANGE_CLOCK_SKEW_MS,
  type SeoActor,
  seoPageChangePayloadSchema,
} from "@/schemas/project-seo.schema";
import {
  commitSeoMutation,
  requireLockedSeoProject,
  requireSeoPages,
  type SeoMutationHooks,
  sha256,
} from "./project-seo-store";

/** A manual change is an immutable annotation. It does not claim a deployment or an SEO improvement. */
export async function recordProjectSeoPageChange(
  actor: SeoActor,
  raw: unknown,
  hooks: SeoMutationHooks = {},
) {
  const input = recordSeoPageChangeSchema.parse(raw);
  if (
    new Date(input.occurredAt).getTime() >
    Date.now() + SEO_PAGE_CHANGE_CLOCK_SKEW_MS
  )
    throw badRequest("Record a change after it happens");
  if (new Set(input.pageIds).size !== input.pageIds.length)
    throw badRequest("Select each changed page once");
  const payload = seoPageChangePayloadSchema.parse({
    version: 1,
    kind: "page_change",
    title: input.title,
    note: input.note,
    occurredAt: input.occurredAt,
    recordedBy: actor.userId,
  });
  const artifactHash = sha256(
    JSON.stringify({ ...payload, pageIds: [...input.pageIds].sort() }),
  );
  const sourceKey = `page-change:${sha256(JSON.stringify([actor.userId, input.idempotencyKey]))}`;
  return serializableTransaction(async (tx) => {
    await requireLockedSeoProject(tx, actor);
    await hooks.authorize?.(tx);
    const pages = await requireSeoPages(actor, input.pageIds, tx);
    const previous = await tx.projectSeoObservation.findUnique({
      where: { projectId_sourceKey: { projectId: actor.projectId, sourceKey } },
    });
    if (previous) {
      if (previous.artifactHash !== artifactHash)
        throw conflict(
          "This change key was already used for different details",
        );
      return commitSeoMutation(tx, previous, hooks);
    }
    const data: Prisma.InputJsonObject = payload;
    const result = await tx.projectSeoObservation.create({
      data: {
        projectId: actor.projectId,
        kind: "page_change",
        source: "user",
        sourceKey,
        pageIds: pages.map((page) => page.id),
        artifactHash,
        payload: data,
        observedAt: new Date(input.occurredAt),
      },
    });
    return commitSeoMutation(tx, result, hooks);
  }, "The page change was recorded concurrently. Retry with the same key.");
}
