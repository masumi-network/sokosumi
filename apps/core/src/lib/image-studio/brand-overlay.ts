import sharp from "sharp";

import type { StudioLogoPosition } from "@/schemas/project-image-studio.schema";

const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_LOGO_PIXELS = 4_000_000;

/** Composite the project artwork over the displayed pixels of the original ad. */
export async function compositeStudioLogo(
  image: Uint8Array,
  logo: Uint8Array,
  position: StudioLogoPosition,
): Promise<Buffer> {
  const source = sharp(image, { limitInputPixels: MAX_IMAGE_PIXELS });
  const { autoOrient, pages } = await source.metadata();
  const { width = 0, height = 0 } = autoOrient ?? {};
  if (width < 16 || height < 16 || (pages ?? 1) > 1) {
    throw new Error("Expected a still image with a readable frame");
  }
  const inset = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  const { data, info } = await sharp(logo, {
    limitInputPixels: MAX_LOGO_PIXELS,
  })
    .autoOrient()
    .resize({
      width: Math.min(width - 2 * inset, Math.round(width * 0.22)),
      height: Math.min(height - 2 * inset, Math.round(height * 0.15)),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  return await source
    .autoOrient()
    .composite([
      {
        input: data,
        left: position.endsWith("right") ? width - inset - info.width : inset,
        top: position.startsWith("bottom")
          ? height - inset - info.height
          : inset,
      },
    ])
    .png()
    .toBuffer();
}
