import sharp from "sharp";

import { unprocessableEntity } from "@/helpers/error";

const MAX_CUTOUT_PIXELS = 12_000_000;
const MAX_BACKDROP_PIXELS = 20_000_000;

export async function validateStudioProductCutout(
  bytes: Uint8Array,
): Promise<void> {
  const invalid = () =>
    unprocessableEntity(
      "Choose a still PNG with a transparent background for the original product photo.",
    );
  try {
    const source = sharp(bytes, { limitInputPixels: MAX_CUTOUT_PIXELS });
    const { format, hasAlpha, pages } = await source.metadata();
    if (format === "png" && hasAlpha && (pages ?? 1) === 1) {
      const { channels } = await source.stats();
      const alpha = channels.at(-1);
      if (alpha && alpha.min < 255 && alpha.max > 0) return;
    }
  } catch {
    throw invalid();
  }
  throw invalid();
}

/** Place the uploaded pixels over the generated setting before publishing the ad. */
export async function composeStudioProductCutout(
  backdrop: Uint8Array,
  cutout: Uint8Array,
  outputFormat: string,
) {
  const background = sharp(backdrop, { limitInputPixels: MAX_BACKDROP_PIXELS });
  const { autoOrient, pages } = await background.metadata();
  if (
    !autoOrient ||
    (pages ?? 1) > 1 ||
    autoOrient.width < 16 ||
    autoOrient.height < 16
  ) {
    throw new Error("Expected a still image with a readable backdrop");
  }
  const { width, height } = autoOrient;
  const product = await sharp(cutout, { limitInputPixels: MAX_CUTOUT_PIXELS })
    .autoOrient()
    .resize({
      width: Math.floor(width * 0.56),
      height: Math.floor(height * 0.55),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const composed = background.autoOrient().composite([
    {
      input: product.data,
      left: Math.floor((width - product.info.width) / 2),
      top: Math.floor(height * 0.86) - product.info.height,
    },
  ]);
  const format =
    outputFormat === "jpeg" || outputFormat === "webp" ? outputFormat : "png";
  return {
    bytes: await composed.toFormat(format).toBuffer(),
    contentType: `image/${format}`,
  };
}
