import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Points every later import of `@vercel/blob` at the on-disk stand-in. Call
 * before any Core module loads (a module already holding the real client
 * keeps it). Local only; the outbound guard refuses any real Blob host.
 */
export function installLocalBlob(dir: string): void {
  if (process.env.VERCEL) throw new Error("The local Blob store is local only");
  process.env.EVAL_LOCAL_BLOB_DIR = dir;
  const here = new URL(".", import.meta.url);
  register(new URL("local-blob-hooks.mjs", here), {
    data: {
      stubUrl: pathToFileURL(new URL("local-blob.ts", here).pathname).href,
    },
  });
}
