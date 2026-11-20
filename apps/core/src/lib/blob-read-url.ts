import { issueSignedToken, presignUrl } from "@vercel/blob";

/** A short-lived read capability for one object in the caller's private store. */
export async function privateBlobReadUrl(
  pathname: string,
  token: string,
  validMs: number,
): Promise<string> {
  const validUntil = Date.now() + validMs;
  const signedToken = await issueSignedToken({
    token,
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}
