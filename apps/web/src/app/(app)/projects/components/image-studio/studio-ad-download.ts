import type { StudioLogoPosition } from "@sokosumi/core-client";
import { renderStudioHeadline } from "./studio-ad-headline";
import {
  assetContentUrl,
  assetFileExtension,
  isVideoAsset,
  type StudioAdRenderOptions,
  type StudioAsset,
} from "./types";

export const MAX_ARCHIVE_IMAGES = 12;
export const MAX_ARCHIVE_MIB = 96;
export const MAX_ARCHIVE_BYTES = MAX_ARCHIVE_MIB * 1024 * 1024;

export async function fetchStudioAd(
  asset: Pick<StudioAsset, "id" | "projectId">,
  options?: StudioAdRenderOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(assetContentUrl(asset, options), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Studio image returned ${response.status}`);
  if (
    (options?.logo || options?.placement) &&
    response.headers.get("content-type") !== "image/png"
  ) {
    throw new Error("Studio image returned an unexpected format");
  }
  return response;
}

export function saveStudioDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Allow the browser to begin saving before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function createStudioAdArchive(
  assets: StudioAsset[],
  logo?: StudioLogoPosition,
  headlines?: Readonly<Record<string, string>>,
): Promise<ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let bytes = 0;

  // Fetch one image at a time to limit simultaneous reads of private files.
  for (const [index, asset] of assets.entries()) {
    const headline = !isVideoAsset(asset) ? headlines?.[asset.id] : undefined;
    const response = await fetchStudioAd(asset, { logo, download: true });
    const source = await response.blob();
    const image = headline
      ? await renderStudioHeadline(source, headline, logo)
      : source;
    bytes += image.size;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error("Studio archive too large");

    const suffix =
      (logo ? "-branded" : "") +
      (headline ? "-headline" : "") +
      (logo || headline ? ".png" : `.${assetFileExtension(asset)}`);
    zip.file(
      `ad-${index + 1}-${asset.width}x${asset.height}${suffix}`,
      await image.arrayBuffer(),
    );
  }

  return zip.generateAsync({ type: "arraybuffer", streamFiles: true });
}
