import { PrismaRaw } from "@sokosumi/database/client";
import { head } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { notFound, serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { buildAuthorizedResourceSql } from "@/lib/files/evidence-scope";

/**
 * Serving the bytes behind a catalog entry.
 *
 * `FileVersion.objectKey` is a storage coordinate and never leaves the
 * server. A reader asks for a resource id, this module re-checks that *this*
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
 * scripting. That is right for everything except a PDF: the browser's own
 * viewer runs inside the frame and needs both scripting and a real origin,
 * and under the strict policy a PDF renders as an empty grey box. Observed
 * on preprod — the same file opened top-level rendered fine.
 *
 * `allow-scripts allow-same-origin` together normally means "no sandbox at
 * all", so it is worth being explicit about why it is safe *here* and only
 * here:
 *
 * 1. The response is `Content-Type: application/pdf` with
 *    `X-Content-Type-Options: nosniff`, so the browser will not parse the
 *    bytes as HTML no matter what they contain.
 * 2. The only thing that can therefore occupy the frame is Chrome's PDF
 *    viewer — browser code, not the file's.
 * 3. A PDF's own scripting runs inside that viewer, which sandboxes it
 *    independently of this header.
 *
 * Every other type keeps the strict policy, so an HTML or SVG file — the
 * ones that *would* become a document — never reaches this branch.
 */
export function contentSecurityPolicyFor(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base === "application/pdf") {
    return "sandbox allow-scripts allow-same-origin";
  }
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
  checksum: string | null;
  etag: string | null;
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
      fv.checksum,
      fv.etag
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
    // Prefer our own checksum; fall back to the store's etag, then to the
    // revision-stable object key. Never a timestamp: it would churn.
    entityTag: row.checksum ?? row.etag ?? row.objectKey,
    inline: !input.download && isInlineRenderable(contentType),
  };
}
