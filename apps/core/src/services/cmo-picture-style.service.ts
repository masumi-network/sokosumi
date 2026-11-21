import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import { recordCoreWarning } from "@/lib/evlog";
import {
  describeBrandPictureStyle,
  describeComposition,
  fallbackPictureStyle,
} from "@/lib/reference-library/layout";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { readReferenceImage } from "@/services/reference-library.service";

/**
 * How a brand's pictures look, in one sentence written once from its
 * DESIGN.md and kept on the Project until the DESIGN.md changes (cmo-v11).
 * Without a DESIGN.md, a plain modern look in the brand's colours.
 */
export async function cmoPictureStyle(
  projectId: string,
  colours: readonly string[],
): Promise<{ text: string; costUsd: number }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      designMdUrl: true,
      cmoPictureStyle: true,
      cmoPictureStyleSource: true,
    },
  });
  const source = project?.designMdUrl ?? null;
  if (project?.cmoPictureStyle && project.cmoPictureStyleSource === source)
    return { text: project.cmoPictureStyle, costUsd: 0 };
  const designMd = await readDesignMdContent(source);
  if (!designMd) return { text: fallbackPictureStyle(colours), costUsd: 0 };
  try {
    const { text, costUsd } = await describeBrandPictureStyle(designMd);
    await prisma.project.update({
      where: { id: projectId },
      data: { cmoPictureStyle: text, cmoPictureStyleSource: source },
      select: { id: true },
    });
    return { text, costUsd };
  } catch (error) {
    recordCoreWarning(
      { operation: "cmo_picture_style" },
      {
        message: "Could not write a brand's picture style",
        why: "The vision model call failed",
        fix: "Pictures use a plain modern look in the brand's colours until the next one; nothing to do unless it repeats.",
      },
      { project: { id: projectId }, failure: messageSafeErrorFields(error) },
    );
    return { text: fallbackPictureStyle(colours), costUsd: 0 };
  }
}

/**
 * A reference's composition in words, written the first time a picture
 * borrows its layout and kept on the reference after that.
 */
export async function referenceComposition(
  referenceId: string,
): Promise<{ text: string | null; costUsd: number }> {
  const row = await prisma.referenceImage.findUnique({
    where: { id: referenceId },
    select: { composition: true, layout: true },
  });
  if (!row) return { text: null, costUsd: 0 };
  if (row.composition) return { text: row.composition, costUsd: 0 };
  const image = await readReferenceImage(referenceId);
  if (!image) return { text: row.layout, costUsd: 0 };
  try {
    const { text, costUsd } = await describeComposition(image.bytes);
    await prisma.referenceImage.update({
      where: { id: referenceId },
      data: { composition: text },
      select: { id: true },
    });
    return { text, costUsd };
  } catch {
    // The catalogue's own layout line names the print's subjects, but it is
    // better than none for one picture.
    return { text: row.layout, costUsd: 0 };
  }
}
