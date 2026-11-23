import sharp from "sharp";
import { LIMITS } from "@/config/constants";

export async function rasterizeStudioSvg(source: Uint8Array) {
  const png = await sharp(source, { limitInputPixels: 16_000_000 })
    .timeout({ seconds: 10 })
    .png()
    .toBuffer();
  if (png.length > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES)
    throw new Error("PNG exceeds the asset limit");
  return png;
}
