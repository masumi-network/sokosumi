import { SsrfError, ssrfSafeFetch } from "@sokosumi/net";

export type DriveFileDownloadFailure =
  | "too_large"
  | "unavailable"
  | "wrong_type";

/** A Drive file cannot be used as-is; callers map `reason` to their own error. */
export class DriveFileDownloadError extends Error {
  constructor(readonly reason: DriveFileDownloadFailure) {
    super(reason);
    this.name = "DriveFileDownloadError";
  }
}

interface DriveFileDownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  /** Receives the served MIME type: lowercased, without parameters. */
  acceptsMimeType: (mimeType: string) => boolean;
  signal?: AbortSignal;
}

/**
 * Fetches a Drive/Blob file through the SSRF guard. Raises
 * {@link DriveFileDownloadError} when the file is over `maxBytes`, is no
 * longer there (non-2xx) or is served as a type `acceptsMimeType` refuses;
 * any other failure is rethrown unchanged.
 */
export async function downloadDriveFile(
  fileUrl: string,
  { maxBytes, timeoutMs, acceptsMimeType, signal }: DriveFileDownloadOptions,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await ssrfSafeFetch(fileUrl, {
      maxResponseBytes: maxBytes,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    // SsrfError has no code; its message names the cap that was exceeded.
    if (error instanceof SsrfError && /maxResponseBytes/.test(error.message)) {
      throw new DriveFileDownloadError("too_large");
    }
    throw error;
  }
  if (!response.ok) throw new DriveFileDownloadError("unavailable");
  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!acceptsMimeType(mimeType))
    throw new DriveFileDownloadError("wrong_type");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new DriveFileDownloadError("too_large");
  return { bytes, mimeType };
}
