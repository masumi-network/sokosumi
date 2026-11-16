import {
  type SocialPostMediaRef,
  type SocialPostProvider,
  socialPostMaxBytesForKind,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import sharp from "sharp";

import { badRequest } from "@/helpers/error";

const LINKEDIN_MAX_PIXELS = 36_152_319;
const INSTAGRAM_MIN_WIDTH = 320;
const INSTAGRAM_MAX_WIDTH = 1440;
type NoticeCode = NonNullable<SocialPostMediaRef["transformation"]>["code"];

interface PreparedSocialPostImage {
  bytes: Uint8Array;
  mimeType: string;
  notice?: string;
  code?: NoticeCode;
}

const NOTICE_TEXT: Record<NoticeCode, string> = {
  pad_4_5: "will pad this image to 4:5.",
  pad_1_91_1: "will pad this image to 1.91:1.",
  resize: "will resize this image.",
  jpeg: "needs a JPEG copy.",
  srgb: "will convert this image to sRGB.",
  smaller_file: "needs a smaller file.",
};

/** Applies publishing API requirements only; accepted images keep their exact bytes. */
export async function prepareSocialPostImage(
  provider: SocialPostProvider,
  bytes: Uint8Array,
  mimeType: string,
): Promise<PreparedSocialPostImage> {
  const maxBytes =
    provider === "instagram"
      ? 8_000_000
      : provider === "x"
        ? socialPostMaxBytesForKind(provider, "image")
        : Number.POSITIVE_INFINITY;
  if (
    provider !== "instagram" &&
    provider !== "linkedin" &&
    bytes.byteLength <= maxBytes
  )
    return { bytes, mimeType };
  const metadata = await sharp(bytes)
    .metadata()
    .catch(() => null);
  if (!metadata?.width || !metadata.height || (metadata.pages ?? 1) > 1)
    throw badRequest("Attach a readable still image and try again");
  const rotated = (metadata.orientation ?? 0) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  let outputWidth = width;
  let outputHeight = height;
  let format = metadata.format === "png" ? "png" : "jpeg";
  let code: NoticeCode | undefined;
  let needsCopy = false;
  if (provider === "instagram") {
    // https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/#image-specifications
    format = "jpeg";
    if (width / height < 4 / 5) {
      outputWidth = Math.ceil((height * 4) / 5);
      code = "pad_4_5";
      needsCopy = true;
    } else if (width / height > 1.91) {
      outputHeight = Math.ceil(width / 1.91);
      code = "pad_1_91_1";
      needsCopy = true;
    }
    if (outputWidth < INSTAGRAM_MIN_WIDTH || outputWidth > INSTAGRAM_MAX_WIDTH)
      code ??= "resize";
    if (metadata.format !== "jpeg") {
      code ??= "jpeg";
      needsCopy = true;
    }
    if (metadata.space !== "srgb") code ??= "srgb";
  } else if (provider === "linkedin") {
    // https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
    if (width * height > LINKEDIN_MAX_PIXELS) {
      const scale = Math.sqrt(LINKEDIN_MAX_PIXELS / (width * height));
      outputWidth = Math.max(1, Math.floor(width * scale));
      outputHeight = Math.max(1, Math.floor(height * scale));
      code = "resize";
      needsCopy = true;
    }
    if (metadata.format !== "jpeg" && metadata.format !== "png") {
      code ??= "jpeg";
      needsCopy = true;
    }
  }
  if (bytes.byteLength > maxBytes) {
    code ??= "smaller_file";
    needsCopy = true;
  }
  if (!code) return { bytes, mimeType };
  const notice = `${socialPostProviderLabel(provider)} ${NOTICE_TEXT[code]}`;
  if (!needsCopy) return { bytes, mimeType, code, notice };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const pipeline = sharp(bytes).autoOrient().resize({
      width: outputWidth,
      height: outputHeight,
      fit: "contain",
      background: "white",
    });
    const prepared = await (format === "png"
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline
          .flatten({ background: "white" })
          .jpeg({ quality: Math.max(65, 95 - attempt * 10) })
    ).toBuffer();
    if (prepared.byteLength <= maxBytes)
      return { bytes: prepared, mimeType: `image/${format}`, code, notice };
    outputWidth = Math.max(1, Math.floor(outputWidth * 0.8));
    outputHeight = Math.max(1, Math.floor(outputHeight * 0.8));
    if (provider === "instagram")
      outputHeight = Math.max(
        Math.ceil(outputWidth / 1.91),
        Math.min(Math.floor((outputWidth * 5) / 4), outputHeight),
      );
  }
  throw badRequest(
    `The image could not fit ${socialPostProviderLabel(provider)}'s file size limit`,
  );
}
