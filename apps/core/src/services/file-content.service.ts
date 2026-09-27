import { PrismaRaw } from "@sokosumi/database/client";
import { head } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { notFound, serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { buildAuthorizedResourceSql } from "@/lib/files/evidence-scope";

/**
 * A validator that changes when the bytes change, and reveals nothing.
 *
 * This used to be `checksum ?? etag ?? objectKey`. Neither `checksum` nor
 * `etag` has a writer anywhere in the repository, so it was not a fallback
 * chain — it was always the object key, on every response. That was wrong
 * twice over. It put a storage coordinate in a header the web proxy
 * forwards verbatim, contradicting this module's own claim below; and
 * because a re-upload to the same pathname keeps the object key while
 * bumping `contentRevision`, the validator was *identical across content
 * revisions*. Nothing serves a 304 yet, so no stale bytes have been served
 * — but a validator that cannot invalidate is worse than none, because the
 * moment someone adds conditional requests, caches believe it.
 *
 * The resource id is already public (the caller just asked with it) and
 * `contentRevision` is exactly what a new upload moves.
 */
export function entityTagFor(version: {
  resourceId: string;
  contentRevision: number;
}): string {
  return `${version.resourceId}-${version.contentRevision}`;
}

/**
 * Serving the bytes behind a catalog entry.
 *
 * `FileVersion.objectKey` is a storage coordinate and never leaves the
 * server — including in the `ETag`, which is derived instead from the
 * resource id and content revision (see `entityTagFor`). A reader asks for a resource id, this module re-checks that *this*
 * caller may still have it, and only then resolves the coordinate.
 *
 * ## What this does and does not protect
 *
 * It re-authorizes on every request, through the same
 * `buildAuthorizedResourceSql` gate every other Files read uses, so a
 * revoked member stops being served immediately and a deep link stops
 * working for them.
 *
 * It is **not** the only way to reach the bytes. Drive objects live in a
 * *public-access* Vercel Blob store, so anyone already holding a storage URL
 * can fetch it without coming through here — the same caveat the Image Studio
 * proxy records, except that store is private and this one is not. What this
 * route adds is that the product stops *handing out* those URLs: the detail
 * page renders from this route, so a reader without access never learns a
 * storage URL to keep. Closing the remaining hole means moving the drive
 * store to private access, which is a migration of every existing object and
 * is not this change.
 */

/** Never stream a preview larger than this; the UI offers a download instead. */
export const FILE_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Types the browser may render in place, on our own origin.
 *
 * Deliberately a small allowlist rather than a blocklist. Anything absent is
 * still served, but as an attachment, so a stored `.html` or `.svg` cannot
 * execute as a same-origin document no matter what it contains. `nosniff` and
 * a sandbox CSP back this up in the route.
 */
const INLINE_RENDERABLE = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isInlineRenderable(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return INLINE_RENDERABLE.has(mimeType.split(";")[0].trim().toLowerCase());
}

/**
 * The policy that keeps served bytes from acting like a page of ours.
 *
 * `sandbox` with no tokens gives the response an opaque origin and no
 * scripting. Every content type gets it, including PDF.
 *
 * ## Why PDF is not special-cased any more
 *
 * It was, briefly. A PDF rendered in an `<iframe>` came out as an empty grey
 * box under the strict policy, so this granted `allow-scripts` and then
 * `allow-scripts allow-same-origin` to let Chrome's viewer run — the two
 * together being, in effect, no sandbox at all.
 *
 * It never worked. In a browser where `navigator.pdfViewerEnabled` is true,
 * where the viewer plugin is present, and where the very same URL renders
 * correctly when opened top-level, the sandboxed frame still showed the
 * broken-document icon under both relaxations. So the widening bought
 * nothing demonstrable, and the honest trade was to take it back: user
 * supplied bytes keep the strict policy, and the detail view offers "Open"
 * and "Download" for a PDF rather than an embedded frame that does not
 * render.
 */
export function contentSecurityPolicyFor(_contentType: string): string {
  return "sandbox; default-src 'none'";
}

/**
 * A filename safe to put in a header.
 *
 * Quotes, backslashes, control characters and newlines are what turn a
 * `content-disposition` value into a header-injection or a broken parse, so
 * they are dropped rather than escaped. The `filename*` form carries the
 * real name for anything non-ASCII.
 */
export function contentDispositionFor(
  displayName: string,
  inline: boolean,
): string {
  let ascii = "";
  for (const character of displayName) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (character === '"' || character === "\\") continue;
    ascii += code > 0x7e ? "_" : character;
  }
  const fallback = ascii.trim().slice(0, 120) || "file";
  const encoded = encodeURIComponent(displayName).slice(0, 240);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

interface AuthorizedVersionRow {
  resourceId: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  objectKey: string;
  contentRevision: number;
}

export interface FileContentStream {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
  displayName: string;
  /** Stable per revision, so a browser can revalidate cheaply with a 304. */
  entityTag: string;
  inline: boolean;
}

/**
 * Resolve one authorized resource to its current bytes.
 *
 * Throws `notFound` for both "no such resource" and "not yours", so the
 * answer never confirms a file exists to someone who cannot open it — the
 * same rule the metadata route follows.
 */
export async function openFileContentStream(input: {
  workspaceId: string;
  actor: FileActor;
  resourceId: string;
  /** Force a download even for a type that could render in place. */
  download?: boolean;
}): Promise<FileContentStream> {
  const authorized = buildAuthorizedResourceSql({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  const rows = await prisma.$queryRaw<AuthorizedVersionRow[]>(PrismaRaw.sql`
    SELECT
      fr.id AS "resourceId",
      fr."displayName",
      COALESCE(fv."mimeType", fr."mimeType") AS "mimeType",
      COALESCE(fv."sizeBytes", fr."sizeBytes") AS "sizeBytes",
      fv."objectKey",
      fr."contentRevision"
    FROM file_resource fr
    JOIN file_version fv
      ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
    WHERE ${authorized} AND fr.id::text = ${input.resourceId}
  `);

  const row = rows[0];
  if (!row) throw notFound("File unavailable");

  if (row.sizeBytes !== null && row.sizeBytes > FILE_PREVIEW_MAX_BYTES) {
    throw notFound("File is too large to serve inline");
  }

  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  // Distinct from 404: the entry is real, the store is simply not reachable
  // from this deployment. A caller should retry, not conclude it is gone.
  if (!token) throw serviceUnavailable("File storage is not configured");

  let metadata: Awaited<ReturnType<typeof head>>;
  try {
    metadata = await head(row.objectKey, { token });
  } catch {
    throw notFound("File bytes are no longer available");
  }

  if (metadata.size > FILE_PREVIEW_MAX_BYTES) {
    throw notFound("File is too large to serve inline");
  }

  const response = await fetch(metadata.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw notFound("File bytes are no longer available");
  }

  const contentType =
    row.mimeType ?? metadata.contentType ?? "application/octet-stream";

  return {
    stream: response.body,
    contentType,
    size: metadata.size,
    displayName: row.displayName,
    entityTag: entityTagFor(row),
    inline: !input.download && isInlineRenderable(contentType),
  };
}
