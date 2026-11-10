import {
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  isOwnedProjectLogoUrl,
  isStudioLogoMime,
} from "@sokosumi/utils";
import type { z } from "zod";
import { LIMITS } from "@/config/constants";
import { unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { renderStudioPng } from "@/lib/image-studio/brand-overlay";
import { downloadRemoteImage } from "@/lib/remote-image";
import type { imageStudioAssetContentQuerySchema } from "@/schemas/project-image-studio.schema";
import { openAssetStream } from "./image-studio-assets.service";

export async function renderStudioAssetPng(
  options: Omit<Parameters<typeof openAssetStream>[0], "range">,
  query: z.infer<typeof imageStudioAssetContentQuerySchema>,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = await openAssetStream(options);
  try {
    if (
      source.mediaType !== "IMAGE" ||
      source.size > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES
    ) {
      throw unprocessableEntity("Choose a still Studio image to render.");
    }
    let logo: Parameters<typeof renderStudioPng>[1]["logo"];
    if (query.logo) {
      const project = await prisma.project.findUnique({
        where: { id: options.projectId },
        select: { logo: true },
      });
      const url = project?.logo;
      const artwork =
        url && isOwnedProjectLogoUrl(url, options.projectId)
          ? await downloadRemoteImage(url, {
              timeoutMs: 8_000,
              maxBytes: ENTITY_IMAGE_MAX_SIZE_BYTES,
              isAllowedContentType: isStudioLogoMime,
            })
          : null;
      if (!artwork) {
        throw unprocessableEntity(
          "A supported project logo could not be loaded.",
        );
      }
      logo = { bytes: new Uint8Array(artwork.bytes), position: query.logo };
    }

    const image = new Uint8Array(
      await new Response(source.stream).arrayBuffer(),
    );
    const rendered = await renderStudioPng(image, {
      logo,
      placement: query.placement,
    }).catch(() => {
      throw unprocessableEntity(
        "The ad or project logo could not be rendered.",
      );
    });
    if (rendered.byteLength > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES) {
      throw unprocessableEntity("The PNG is too large to export.");
    }
    return new Uint8Array(rendered);
  } finally {
    if (!source.stream.locked) await source.stream.cancel().catch(() => {});
  }
}
