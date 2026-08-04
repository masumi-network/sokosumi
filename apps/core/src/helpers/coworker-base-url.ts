import { assertPublicResolvedHttpUrl, SsrfError } from "@sokosumi/net";

import { unprocessableEntity } from "@/helpers/error";

/**
 * SSRF guard for vendor-supplied coworker endpoints.
 *
 * `Coworker.baseURL` is written by vendor admins and by any user holding a
 * coworker assignment, then used for server-side POSTs that carry Sokosumi
 * user/organization identifiers. Without this, a coworker could point Core at
 * loopback, link-local, cloud-metadata, or internal-only hosts and use it as a
 * blind internal request primitive.
 *
 * Resolves DNS and rejects private targets, so it also covers public hostnames
 * that resolve inward. Call it at write time AND immediately before each
 * request — a record can change between the two.
 */
export async function assertCoworkerBaseUrlIsPublic(
  rawUrl: string,
): Promise<void> {
  await assertPublicResolvedHttpUrl(rawUrl);
}

/**
 * Write-time variant: surfaces a 422 with the reason instead of a 500, so an
 * operator setting a bad endpoint learns why it was refused.
 */
export async function assertCoworkerBaseUrlIsPublicForWrite(
  rawUrl: string,
): Promise<void> {
  try {
    await assertPublicResolvedHttpUrl(rawUrl);
  } catch (error) {
    if (error instanceof SsrfError) {
      throw unprocessableEntity(
        `baseURL must be a publicly routable HTTP(S) endpoint: ${error.message}`,
      );
    }
    throw error;
  }
}
