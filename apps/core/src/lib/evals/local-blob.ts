import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The Vercel Blob API for local eval runs, on disk: eval lanes upload, read
 * and delete files exactly as Core does in production, and no byte reaches a
 * real Blob store (coordinator, 2026-11-27: no eval Blob store). Installed in
 * place of `@vercel/blob` by `local-blob-hooks.mjs` when evals:local runs with
 * EVAL_LOCAL_BLOB_DIR; never on Vercel. Objects live at
 * `<dir>/<pathname>`, with their content type beside them.
 */

/** The host stand-in URLs use; the outbound guard serves it from disk. */
export const LOCAL_BLOB_HOST = "local-blob.evals.invalid";

export class BlobError extends Error {
  constructor(message: string) {
    super(`Vercel Blob: ${message}`);
    this.name = "BlobError";
  }
}

export class BlobNotFoundError extends BlobError {
  constructor() {
    super("The requested blob does not exist");
    this.name = "BlobNotFoundError";
  }
}

export class BlobAccessError extends BlobError {
  constructor() {
    super("Access denied, please provide a valid token for this resource.");
    this.name = "BlobAccessError";
  }
}

function root(): string {
  const dir = process.env.EVAL_LOCAL_BLOB_DIR;
  if (!dir || process.env.VERCEL)
    throw new BlobError("the local eval Blob store is not configured");
  return resolve(dir);
}

/** A pathname or one of this store's URLs, as a path inside the store. */
function pathnameOf(urlOrPathname: string): string {
  const pathname = /^https?:\/\//.test(urlOrPathname)
    ? decodeURIComponent(new URL(urlOrPathname).pathname.replace(/^\/+/, ""))
    : urlOrPathname.replace(/^\/+/, "");
  if (!pathname) throw new BlobError("pathname is required");
  return pathname;
}

function fileOf(pathname: string): string {
  const base = root();
  const file = resolve(base, pathname);
  if (relative(base, file).startsWith(".."))
    throw new BlobError("pathname escapes the local store");
  return file;
}

function urlOf(pathname: string): string {
  return `https://${LOCAL_BLOB_HOST}/${pathname.split("/").map(encodeURIComponent).join("/")}`;
}

interface Meta {
  contentType: string;
  uploadedAt: string;
}

async function readMeta(file: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(`${file}.meta.json`, "utf8")) as Meta;
  } catch {
    return null;
  }
}

function describe(pathname: string, size: number, meta: Meta) {
  const url = urlOf(pathname);
  return {
    url,
    downloadUrl: `${url}?download=1`,
    pathname,
    size,
    uploadedAt: new Date(meta.uploadedAt),
    contentType: meta.contentType,
    contentDisposition: `attachment; filename="${pathname.split("/").pop()}"`,
    cacheControl: "public, max-age=31536000",
    etag: `"${meta.uploadedAt}"`,
  };
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body && typeof body === "object" && "getReader" in body)
    return Buffer.from(
      await new Response(body as ReadableStream).arrayBuffer(),
    );
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>)
      chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new BlobError("unsupported body");
}

export async function put(
  pathname: string,
  body: unknown,
  options: {
    addRandomSuffix?: boolean;
    allowOverwrite?: boolean;
    contentType?: string;
  } = {},
) {
  let target = pathnameOf(pathname);
  if (options.addRandomSuffix) {
    const dot = target.lastIndexOf(".");
    const suffix = randomUUID().slice(0, 8);
    target =
      dot > target.lastIndexOf("/")
        ? `${target.slice(0, dot)}-${suffix}${target.slice(dot)}`
        : `${target}-${suffix}`;
  }
  const file = fileOf(target);
  if (
    !options.allowOverwrite &&
    !options.addRandomSuffix &&
    (await readMeta(file))
  )
    throw new BlobError(
      "This blob already exists, use `allowOverwrite: true` if you want to overwrite it.",
    );
  const bytes = await bodyBytes(body);
  const meta: Meta = {
    contentType: options.contentType ?? "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(`${file}.meta.json`, JSON.stringify(meta));
  return describe(target, bytes.length, meta);
}

export async function head(urlOrPathname: string, _options?: unknown) {
  const pathname = pathnameOf(urlOrPathname);
  const file = fileOf(pathname);
  const meta = await readMeta(file);
  if (!meta) throw new BlobNotFoundError();
  return describe(pathname, (await stat(file)).size, meta);
}

export async function get(urlOrPathname: string, _options?: unknown) {
  try {
    const blob = await head(urlOrPathname);
    const bytes = await readFile(fileOf(blob.pathname));
    return {
      statusCode: 200,
      stream: new Blob([bytes]).stream(),
      headers: new Headers({
        "content-type": blob.contentType,
        "content-length": String(bytes.length),
      }),
      blob,
    };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

export async function del(
  urlOrPathname: string | readonly string[],
  _options?: unknown,
): Promise<void> {
  const all =
    typeof urlOrPathname === "string" ? [urlOrPathname] : urlOrPathname;
  for (const each of all) {
    const file = fileOf(pathnameOf(each));
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }
}

export async function copy(
  fromUrlOrPathname: string,
  toPathname: string,
  options: { contentType?: string; allowOverwrite?: boolean } = {},
) {
  const from = await head(fromUrlOrPathname);
  const target = pathnameOf(toPathname);
  const file = fileOf(target);
  if (!options.allowOverwrite && (await readMeta(file)))
    throw new BlobError(
      "This blob already exists, use `allowOverwrite: true` if you want to overwrite it.",
    );
  const meta: Meta = {
    contentType: options.contentType ?? from.contentType,
    uploadedAt: new Date().toISOString(),
  };
  await mkdir(dirname(file), { recursive: true });
  await copyFile(fileOf(from.pathname), file);
  await writeFile(`${file}.meta.json`, JSON.stringify(meta));
  return describe(target, from.size, meta);
}

export async function rename(
  fromUrlOrPathname: string,
  toPathname: string,
  options: { allowOverwrite?: boolean } = {},
) {
  const moved = await copy(fromUrlOrPathname, toPathname, options);
  await del(fromUrlOrPathname);
  return moved;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (!entry.name.endsWith(".meta.json")) files.push(full);
  }
  return files;
}

export async function list(
  options: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    mode?: string;
  } = {},
) {
  const base = root();
  const prefix = options.prefix ?? "";
  const all = (await walk(base))
    .map((file) => relative(base, file).split("\\").join("/"))
    .filter((pathname) => pathname.startsWith(prefix))
    .sort();
  const start = options.cursor ? Number(options.cursor) : 0;
  const limit = options.limit ?? 1000;
  const page = all.slice(start, start + limit);
  const blobs = await Promise.all(page.map((pathname) => head(pathname)));
  const hasMore = start + limit < all.length;
  const folded =
    options.mode === "folded"
      ? {
          folders: [
            ...new Set(
              all
                .map((pathname) => pathname.slice(prefix.length).split("/"))
                .filter((parts) => parts.length > 1)
                .map((parts) => `${prefix}${parts[0]}/`),
            ),
          ],
        }
      : {};
  return {
    blobs,
    hasMore,
    ...(hasMore ? { cursor: String(start + limit) } : {}),
    ...folded,
  };
}

/** Local objects need no signature: the presigned URL is the object's URL. */
export async function issueSignedToken(options: { pathname: string }) {
  return {
    clientSigningToken: "local-eval-blob",
    delegationToken: "local-eval-blob",
    pathname: options.pathname,
  };
}

export async function presignUrl(
  _signedToken: unknown,
  options: { pathname: string },
) {
  return { presignedUrl: urlOf(pathnameOf(options.pathname)) };
}

/** The bytes of a stand-in URL, for the outbound guard; null when absent. */
export async function readLocalBlob(
  url: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const blob = await head(url);
    return {
      bytes: await readFile(fileOf(blob.pathname)),
      contentType: blob.contentType,
    };
  } catch {
    return null;
  }
}
