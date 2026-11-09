import { isOwnedProjectLogoUrl } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { compositeStudioLogo } from "@/lib/image-studio/brand-overlay";
import { downloadRemoteImage } from "@/lib/remote-image";
import type { StudioLogoPosition } from "@/schemas/project-image-studio.schema";
import { openAssetStream } from "./image-studio-assets.service";

export async function renderBrandedStudioAsset(
  options: Omit<Parameters<typeof openAssetStream>[0], "range">,
  position: StudioLogoPosition,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = await openAssetStream(options);
  try {
    if (
      !source.contentType.startsWith("image/") ||
      source.size > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES
    ) {
      throw unprocessableEntity(
        "Choose a still Studio image to export with a logo.",
      );
    }
    const project = await prisma.project.findUnique({
      where: { id: options.projectId },
      select: { logo: true },
    });
    const url = project?.logo;
    const logo =
      url && isOwnedProjectLogoUrl(url, options.projectId)
        ? await downloadRemoteImage(url, {
            timeoutMs: 8_000,
            maxBytes: 2 * 1024 * 1024,
            isAllowedContentType: (mime) =>
              mime === "image/png" ||
              mime === "image/jpeg" ||
              mime === "image/webp",
          })
        : null;
    if (!logo)
      throw unprocessableEntity(
        "A supported project logo could not be loaded.",
      );

    const image = new Uint8Array(
      await new Response(source.stream).arrayBuffer(),
    );
    const branded = await compositeStudioLogo(
      image,
      new Uint8Array(logo.bytes),
      position,
    ).catch(() => {
      throw unprocessableEntity(
        "The ad or project logo could not be rendered.",
      );
    });
    if (branded.byteLength > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES) {
      throw unprocessableEntity("The branded PNG is too large to export.");
    }
    return new Uint8Array(branded);
  } finally {
    if (!source.stream.locked) await source.stream.cancel().catch(() => {});
  }
}
