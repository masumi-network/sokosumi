import prisma from "@/lib/db/prisma";
import {
  IMAGE_STUDIO_DRIVE_FOLDER,
  ownerDrivePathname,
  studioAssetFileName,
} from "@/services/image-studio-drive.service";
import { recordStudioAdEvent } from "@/services/image-studio-events.service";

interface SocialStudioMediaRef {
  pathname: string;
  transformation?: { original: { pathname: string } };
}

interface SocialStudioAdEventInput {
  projectId: string;
  workspaceId: string;
  postId: string;
  userId?: string | null;
  type: "attached_to_post" | "scheduled" | "posted";
  media: readonly SocialStudioMediaRef[];
  previousMedia?: readonly SocialStudioMediaRef[];
  threadParts?: readonly { media: readonly SocialStudioMediaRef[] }[];
  previousThreadParts?: readonly { media: readonly SocialStudioMediaRef[] }[];
}

export async function recordSocialStudioAdEvents(
  input: SocialStudioAdEventInput,
): Promise<void> {
  try {
    const previous = new Set(
      [
        ...(input.previousMedia ?? []),
        ...(input.previousThreadParts ?? []).flatMap((part) => part.media),
      ].map((ref) => ref.transformation?.original.pathname ?? ref.pathname),
    );
    const pathnames = new Set(
      [
        ...input.media,
        ...(input.threadParts ?? []).flatMap((part) => part.media),
      ]
        .map((ref) => ref.transformation?.original.pathname ?? ref.pathname)
        .filter(
          (pathname) =>
            pathname.includes(`/${IMAGE_STUDIO_DRIVE_FOLDER}/`) &&
            !previous.has(pathname),
        ),
    );
    if (pathnames.size === 0) return;

    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { organizationId: true, userId: true },
    });
    if (!workspace || (!workspace.organizationId && !workspace.userId)) return;
    const assets = await prisma.projectImageAsset.findMany({
      where: { projectId: input.projectId, workspaceId: input.workspaceId },
      select: { id: true, prompt: true, jobId: true, contentType: true },
    });
    for (const asset of assets) {
      const pathname = ownerDrivePathname({
        organizationId: workspace.organizationId,
        userId: workspace.userId ?? "",
        folder: IMAGE_STUDIO_DRIVE_FOLDER,
        name: studioAssetFileName(asset.prompt, asset.jobId, asset.contentType),
      });
      if (!pathnames.has(pathname)) continue;
      await recordStudioAdEvent({
        workspaceId: input.workspaceId,
        assetId: asset.id,
        userId: input.userId,
        type: input.type,
        meta: { socialPostId: input.postId },
      });
    }
  } catch {
    // A failed pathname lookup must not interrupt writing or publishing a post.
  }
}
