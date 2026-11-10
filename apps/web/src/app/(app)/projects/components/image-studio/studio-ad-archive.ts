import { assetContentUrl, assetFileExtension, type StudioAsset } from "./types";

export const MAX_ARCHIVE_IMAGES = 12;
export const MAX_ARCHIVE_MIB = 96;
export const MAX_ARCHIVE_BYTES = MAX_ARCHIVE_MIB * 1024 * 1024;

export async function createStudioAdArchive(
  assets: StudioAsset[],
): Promise<ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let bytes = 0;

  // Fetch one image at a time to limit simultaneous reads of private files.
  for (const [index, asset] of assets.entries()) {
    const response = await fetch(assetContentUrl(asset), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Studio image returned ${response.status}`);

    const image = await response.arrayBuffer();
    bytes += image.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error("Studio archive too large");

    zip.file(
      `ad-${index + 1}-${asset.width}x${asset.height}.${assetFileExtension(asset)}`,
      image,
    );
  }

  return zip.generateAsync({ type: "arraybuffer", streamFiles: true });
}
