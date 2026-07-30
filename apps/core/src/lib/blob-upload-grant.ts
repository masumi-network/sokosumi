import { issueSignedToken, presignUrl } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

const DEFAULT_TOKEN_VALID_MS = 15 * 60 * 1000;
const DEFAULT_URL_VALID_MS = 10 * 60 * 1000;

export interface CreateBlobUploadGrantInput {
  /** Server-owned blob pathname (never client-supplied). */
  pathname: string;
  contentType: string;
  /** Hard cap embedded in the signed grant (usually this file's size). */
  maximumSizeInBytes: number;
  /** Policy max returned to clients for messaging. */
  maxSizeBytes: number;
  access: "public";
  addRandomSuffix: boolean;
  /** Blob read-write token. */
  token: string;
  /** Allowed MIME types for this grant. Defaults to `[contentType]`. */
  allowedContentTypes?: readonly string[];
  tokenValidMs?: number;
  urlValidMs?: number;
  /** Dual-run: also mint legacy client token for `@vercel/blob/client` `put`. */
  includeClientToken?: boolean;
  /**
   * Blob `onUploadCompleted` callback (presigned PUT path).
   * Requires a public Core URL and `BLOB_WEBHOOK_PUBLIC_KEY` on the completion route.
   */
  onUploadCompleted?: {
    callbackUrl: string;
    tokenPayload: string;
  };
}

export interface BlobUploadGrant {
  uploadUrl: string;
  pathname: string;
  access: "public";
  method: "PUT";
  headers: {
    "Content-Type": string;
  };
  expiresAt: string;
  maxSizeBytes: number;
  addRandomSuffix: boolean;
  clientToken?: string;
}

/**
 * Mint a short-lived direct-upload grant: presigned PUT URL (+ optional legacy
 * client token). Callers own auth, path construction, and MIME/size policy.
 */
export async function createBlobUploadGrant(
  input: CreateBlobUploadGrantInput,
): Promise<BlobUploadGrant> {
  const allowedContentTypes =
    input.allowedContentTypes && input.allowedContentTypes.length > 0
      ? [...input.allowedContentTypes]
      : [input.contentType];

  const now = Date.now();
  const tokenValidUntil = now + (input.tokenValidMs ?? DEFAULT_TOKEN_VALID_MS);
  const urlValidUntil = Math.min(
    now + (input.urlValidMs ?? DEFAULT_URL_VALID_MS),
    tokenValidUntil,
  );

  const signedToken = await issueSignedToken({
    token: input.token,
    pathname: input.pathname,
    operations: ["put"],
    allowedContentTypes,
    maximumSizeInBytes: input.maximumSizeInBytes,
    validUntil: tokenValidUntil,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "put",
    pathname: input.pathname,
    access: input.access,
    allowedContentTypes,
    maximumSizeInBytes: input.maximumSizeInBytes,
    addRandomSuffix: input.addRandomSuffix,
    validUntil: urlValidUntil,
    ...(input.onUploadCompleted
      ? { onUploadCompleted: input.onUploadCompleted }
      : {}),
  });

  const grant: BlobUploadGrant = {
    uploadUrl: presignedUrl,
    pathname: input.pathname,
    access: input.access,
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
    },
    expiresAt: new Date(urlValidUntil).toISOString(),
    maxSizeBytes: input.maxSizeBytes,
    addRandomSuffix: input.addRandomSuffix,
  };

  if (input.includeClientToken) {
    grant.clientToken = await generateClientTokenFromReadWriteToken({
      token: input.token,
      pathname: input.pathname,
      allowedContentTypes,
      maximumSizeInBytes: input.maximumSizeInBytes,
      validUntil: tokenValidUntil,
      addRandomSuffix: input.addRandomSuffix,
    });
  }

  return grant;
}
