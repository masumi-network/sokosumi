import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

/**
 * The image studio's private Blob store.
 *
 * Generated images are project artwork. They live in a store of their own,
 * created with `--access private`, and never in the shared store the rest of
 * the platform uses.
 *
 * That separation is not stylistic. Vercel fixes public-or-private per
 * *store*, not per object, and `BLOB_READ_WRITE_TOKEN` names a store created
 * with `access: "public"` — every object in it is served to anyone who has the
 * URL, with no credential. Two things that look like they would make up for
 * that do not:
 *
 * - **Serving the bytes through an authorizing route.** Core's asset route
 *   controls one way of reaching an object. It cannot un-publish an object the
 *   store is already serving anonymously on its own URL.
 * - **An unguessable pathname.** The studio's pathnames embed a content hash,
 *   which makes them hard to guess. Hard to guess is obscurity; it is not
 *   authorization, it does not survive a leaked URL, a referrer header, a
 *   proxy log or a shared screenshot, and it cannot be revoked.
 *
 * So the store has to be private, and the studio fails closed without one.
 */

/**
 * The read-write token for that store, when one is configured.
 *
 * For the caller that has something better to do than throw — settlement holds
 * a lease and a paid image, so it fails the job deliberately rather than
 * unwinding through an HTTP error.
 */
export function readStudioBlobToken(): string | undefined {
  return getEnv().IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN;
}

/**
 * What the person is told. Deliberately says nothing about which variable is
 * missing: the reader of an error toast cannot act on an environment variable
 * name, and naming server configuration in a response body tells an
 * unauthenticated prober how the deployment is put together. The name they
 * would need is in the server log instead, one line below.
 */
const STORAGE_UNAVAILABLE_MESSAGE =
  "Image storage is unavailable, so the studio cannot keep what it generates. Nothing was generated or charged. This needs an administrator.";

/**
 * The same token, or a refusal.
 *
 * There is deliberately no fallback to `BLOB_READ_WRITE_TOKEN`: falling back
 * would publish private artwork silently, which is worse than not generating
 * at all. `createImageJob` calls this before anything is reserved or sent, so
 * an unconfigured deployment costs nothing rather than paying fal for images
 * it is not allowed to keep.
 */
export function requireStudioBlobToken(): string {
  const token = readStudioBlobToken();
  if (!token) {
    // The actionable half, for whoever can act on it.
    console.error(
      "[image-studio] IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN is not set. The studio needs its own private-access Blob store and will refuse to generate until one is configured; it will not fall back to the shared public store named by BLOB_READ_WRITE_TOKEN.",
    );
    throw serviceUnavailable(STORAGE_UNAVAILABLE_MESSAGE);
  }
  return token;
}
