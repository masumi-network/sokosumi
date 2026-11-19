import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import sharp from "sharp";

import { deleteObservedDriveFiles } from "@/helpers/drive-file-delete";
import { unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { driveHead } from "@/lib/drive-blob";
import {
  findTalkingVideoPresenter,
  TALKING_VIDEO_PRESENTERS,
} from "@/lib/image-studio/talking-video";
import { type Cuso, requireCuso } from "@/services/cmo-cuso.service";
import {
  cusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";
import { tombstoneDriveUploadResource } from "@/services/file-catalog.service";

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
  await removePresenterPhoto(cuso);
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
  await removePresenterPhoto(await requireCuso(input));
}

/**
 * Deletes the Project's presenter photo from Files, then forgets it. The
 * file goes first: a delete that fails leaves the photo set, so removing it
 * again still finds it.
 */
async function removePresenterPhoto(
  cuso: Pick<Cuso, "projectId" | "workspaceId">,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: cuso.projectId },
    select: { presenterFileId: true },
  });
  const file = project?.presenterFileId
    ? await prisma.fileResource.findFirst({
        where: {
          id: project.presenterFileId,
          workspaceId: cuso.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          tombstonedAt: null,
        },
        select: { sourceId: true, sourceScope: true },
      })
    : null;
  if (file) {
    const scope =
      file.sourceScope === FileSourceScope.ORGANIZATION
        ? "organization"
        : "user";
    // Recoverably, and only the object observed here, as in the Drive
    // delete route; a file whose bytes are already gone is only tombstoned.
    const observed = await driveHead(file.sourceId);
    if (observed) {
      await deleteObservedDriveFiles({
        workspaceId: cuso.workspaceId,
        scope,
        objects: [
          {
            pathname: file.sourceId,
            access: observed.access,
            etag: observed.etag,
          },
        ],
      });
    } else {
      await tombstoneDriveUploadResource({
        workspaceId: cuso.workspaceId,
        scope,
        pathname: file.sourceId,
      });
    }
  }
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
