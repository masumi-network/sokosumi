import { type Prisma, ProjectImageMediaType } from "@sokosumi/database";
import { MAX_STUDIO_HEADLINE_LENGTH } from "@sokosumi/utils";

import { conflict, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireApprovedStudioHeadline } from "@/lib/image-studio/studio-brand";
import { parseBrandBrain } from "@/services/brand-brain.service";

interface HeadlineAssetScope {
  projectId: string;
  workspaceId: string;
  assetId: string;
}

async function loadHeadlineAsset(
  { projectId, workspaceId, assetId }: HeadlineAssetScope,
  db: Prisma.TransactionClient = prisma,
) {
  const asset = await db.projectImageAsset.findFirst({
    where: {
      id: assetId,
      projectId,
      workspaceId,
      mediaType: ProjectImageMediaType.IMAGE,
    },
    select: {
      headline: { select: { text: true, revision: true } },
      project: { select: { brandBrain: { select: { body: true } } } },
    },
  });
  if (!asset) throw notFound("Image not found");
  return {
    headline: asset.headline ?? { text: null, revision: 0 },
    brandBody: asset.project.brandBrain?.body,
  };
}

export async function readStudioAdHeadline(scope: HeadlineAssetScope) {
  const { headline, brandBody } = await loadHeadlineAsset(scope);
  const approvedLines = parseBrandBrain(brandBody)?.voice.examples ?? [];
  return {
    headline,
    approvedLines: [...new Set(approvedLines)].filter(
      (line) => line.trim() && line.length <= MAX_STUDIO_HEADLINE_LENGTH,
    ),
  };
}

export async function saveStudioAdHeadline(
  input: HeadlineAssetScope & {
    userId: string;
    text: string | null;
    expectedRevision?: number;
  },
) {
  const { assetId, text, expectedRevision } = input;
  return await serializableTransaction(async (tx) => {
    await requireProjectAccess(input, tx);
    const { headline, brandBody } = await loadHeadlineAsset(input, tx);
    if (text !== null) requireApprovedStudioHeadline(text, brandBody);
    if (headline.text === text) return headline;
    if (
      expectedRevision !== undefined &&
      headline.revision !== expectedRevision
    ) {
      throw conflict(
        "The ad headline changed. Read the current headline first.",
        {
          kind: "studio_headline_changed",
        },
      );
    }
    return tx.projectImageHeadline.upsert({
      where: { assetId },
      create: { assetId, text },
      update: { text, revision: { increment: 1 } },
      select: { text: true, revision: true },
    });
  }, "The ad headline changed. Try saving it again.");
}
