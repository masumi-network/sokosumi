import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  get,
  type PutBlobResult,
  type PutCommandOptions,
  put,
} from "@vercel/blob";
import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import { recordCoreError } from "@/lib/evlog";

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
  return (
    getEnv().IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN ??
    (localStudioDir() ? LOCAL_STUDIO_TOKEN : undefined)
  );
}

/**
 * A local eval run with no private store (the owner benchmark on a laptop)
 * keeps studio bytes in a directory instead. Never on Vercel, and never when a
 * real private store is configured: the directory is private to the machine.
 */
const LOCAL_STUDIO_TOKEN = "local-studio-store";

function localStudioDir(): string | undefined {
  if (process.env.VERCEL) return undefined;
  return getEnv().EVAL_LOCAL_STUDIO_STORE_DIR;
}

function localPath(pathname: string): string {
  const dir = localStudioDir();
  if (!dir) throw new Error("The local studio store is not configured");
  const full = resolve(dir, pathname);
  if (!full.startsWith(`${resolve(dir)}/`))
    throw new Error("Studio pathname escapes the local store");
  return full;
}

/** `put` to the studio's store: Vercel Blob, or the local eval directory. */
export async function studioPut(
  pathname: string,
  body: Buffer | Uint8Array,
  options: PutCommandOptions,
): Promise<Pick<PutBlobResult, "pathname">> {
  if (options.token !== LOCAL_STUDIO_TOKEN)
    return put(pathname, body as Buffer, options);
  const file = localPath(pathname);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  await writeFile(`${file}.type`, options.contentType ?? "");
  return { pathname };
}

/** `get` from the studio's store; the local directory answers whole objects. */
export async function studioGet(
  pathname: string,
  options: Parameters<typeof get>[1],
): ReturnType<typeof get> {
  if (options.token !== LOCAL_STUDIO_TOKEN) return get(pathname, options);
  const file = localPath(pathname);
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return null;
  const contentType = await readFile(`${file}.type`, "utf8").catch(() => "");
  return {
    statusCode: 200,
    stream: new Blob([bytes]).stream(),
    headers: new Headers({ "content-type": contentType }),
    blob: { size: bytes.length, contentType, pathname },
  } as unknown as Awaited<ReturnType<typeof get>>;
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
    recordCoreError(
      { operation: "image_studio_storage" },
      {
        message:
          "Refused an image studio request, because its private storage is not configured",
        why: "IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN is unset, and the studio never falls back to the shared public store named by BLOB_READ_WRITE_TOKEN",
        fix: "Set IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN to the read-write token of a private-access Vercel Blob store.",
      },
    );
    throw serviceUnavailable(STORAGE_UNAVAILABLE_MESSAGE);
  }
  return token;
}
