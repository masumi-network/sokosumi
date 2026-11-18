import sharp from "sharp";

import { unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  findTalkingVideoPresenter,
  TALKING_VIDEO_PRESENTERS,
} from "@/lib/image-studio/talking-video";
import { requireCuso } from "@/services/cmo-cuso.service";
import {
  cusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";

/** A phone selfie, scaled down in the browser first, fits well within this. */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 1600;

/**
 * The owner's photo, to front Cuso's talking videos. Stored with the moment
 * they confirmed they may use it; a video uses it only while both are set.
 */
export async function setCmoPresenter(input: {
  userId: string;
  projectId: string;
  photo: Uint8Array;
}): Promise<void> {
  if (input.photo.byteLength > MAX_PHOTO_BYTES)
    throw unprocessableEntity("Choose a photo under 3 MB.");
  const cuso = await requireCuso(input);
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input.photo)
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw unprocessableEntity("Choose a JPEG, PNG or WebP photo.");
  }
  const drive = await cusoDrive(cuso);
  if (!drive) throw unprocessableEntity("Cuso's files are not available.");
  const fileId = await saveCusoProjectFile(
    drive,
    { folder: "Presenter", filename: `presenter-${Date.now()}.jpg` },
    jpeg,
    "image/jpeg",
  );
  if (!fileId) throw unprocessableEntity("The photo could not be saved.");
  await prisma.project.update({
    where: { id: cuso.projectId },
    data: { presenterFileId: fileId, presenterConsentAt: new Date() },
    select: { id: true },
  });
}

/** Stop using the owner's photo; stock presenters front the videos again. */
export async function clearCmoPresenter(input: {
  userId: string;
  projectId: string;
}): Promise<void> {
  const cuso = await requireCuso(input);
  await prisma.project.update({
    where: { id: cuso.projectId },
    data: { presenterFileId: null, presenterConsentAt: null },
    select: { id: true },
  });
}

/**
 * Who fronts a talking video: "owner" is the Project's photo while it has
 * one with consent, anything else a stock presenter (the first when the id
 * is unknown). Null for "owner" without a consented photo.
 */
export async function talkingVideoPresenter(input: {
  projectId: string;
  presenter: string;
  userId: string;
}) {
  if (input.presenter !== "owner") {
    const stock =
      findTalkingVideoPresenter(input.presenter) ??
      TALKING_VIDEO_PRESENTERS[0]!;
    return { kind: "stock" as const, id: stock.id };
  }
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      presenterFileId: true,
      presenterConsentAt: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!project?.presenterFileId || !project.presenterConsentAt) return null;
  return {
    kind: "file" as const,
    fileId: project.presenterFileId,
    consentAt: project.presenterConsentAt,
    actor: {
      kind: "soko_bot" as const,
      userId: input.userId,
      organizationId: project.workspace.organizationId,
    },
  };
}
