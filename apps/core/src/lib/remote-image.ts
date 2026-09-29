import { ssrfSafeFetch } from "@sokosumi/net";
import { sniffImageMimeFromBytes } from "@sokosumi/utils";

export interface DownloadRemoteImageOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  isAllowedContentType: (contentType: string) => boolean;
}

/**
 * SSRF-safe download of a remote raster image. Returns null on any network,
 * status, or type failure; callers treat the image as optional.
 */
export async function downloadRemoteImage(
  url: string,
  options: DownloadRemoteImageOptions,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(url, {
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
      maxResponseBytes: options.maxBytes,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }
  // Trust the bytes, not the header: a mislabelled PNG still stores, an SVG
  // or HTML page served as image/png does not.
  const contentType = sniffImageMimeFromBytes(bytes);
  if (contentType === null || !options.isAllowedContentType(contentType)) {
    return null;
  }
  return { bytes, contentType };
}
