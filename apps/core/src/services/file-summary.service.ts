import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { labelExcerptFromChunks } from "@/lib/files/jev-request";

/** A tick does at most this many, so summaries never starve extraction. */
const SUMMARY_BATCH = 5;
const SUMMARY_TIMEOUT_MS = 15_000;
/** Characters of text sent; a description needs the opening, not the file. */
const SUMMARY_EXCERPT_CHARS = 3_000;
const SUMMARY_MAX_CHARS = 200;

/**
 * Write the one-line summary for files that have text and no summary yet.
 *
 * Runs in the drive-index cycle after extraction, so a file gains its summary
 * a minute after it gains its text, and files indexed before this existed are
 * picked up the same way. `summaryRevision` records the content revision that
 * was attempted: a model that declined a file is not asked again until the
 * bytes change, while a failed call leaves it unset and retries next tick.
 *
 * Off with the rest of the files model features (`FILES_JEV_ENABLED`), since
 * it sends the same extracted text to a provider.
 */
export async function summarizeMissingFiles(input: {
  shouldContinue: () => boolean;
  limit?: number;
}): Promise<{ summarized: number; failed: number }> {
  if (!getEnv().FILES_JEV_ENABLED) return { summarized: 0, failed: 0 };

  const due = await prisma.$queryRaw<
    { id: string; displayName: string; contentRevision: number }[]
  >`
    SELECT fr.id::text AS id, fr."displayName", fr."contentRevision"
    FROM file_resource fr
    JOIN file_version fv
      ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
    WHERE fr."tombstonedAt" IS NULL
      AND fv."extractionState" IN ('INDEXED', 'PARTIAL')
      AND fr."summaryRevision" IS DISTINCT FROM fr."contentRevision"
    ORDER BY fr."updatedAt" DESC
    LIMIT ${input.limit ?? SUMMARY_BATCH}
  `;

  let summarized = 0;
  let failed = 0;
  for (const resource of due) {
    if (!input.shouldContinue()) break;

    const chunks = await prisma.fileChunk.findMany({
      where: {
        version: {
          resourceId: resource.id,
          revision: resource.contentRevision,
        },
      },
      orderBy: { ordinal: "asc" },
      take: 3,
      select: { text: true },
    });
    const excerpt = labelExcerptFromChunks(chunks)
      .slice(0, SUMMARY_EXCERPT_CHARS)
      .trim();

    const result = excerpt
      ? await openrouterClient.generateFileSummary(
          { fileName: resource.displayName, excerpt },
          { abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS) },
        )
      : ({ kind: "declined" } as const);
    if (!result) {
      failed += 1;
      continue;
    }

    // Guarded on the revision, so a summary of old bytes never lands on new.
    await prisma.fileResource.updateMany({
      where: { id: resource.id, contentRevision: resource.contentRevision },
      data: {
        summary:
          result.kind === "summary"
            ? result.text.slice(0, SUMMARY_MAX_CHARS)
            : null,
        summaryRevision: resource.contentRevision,
      },
    });
    if (result.kind === "summary") summarized += 1;
  }

  return { summarized, failed };
}
