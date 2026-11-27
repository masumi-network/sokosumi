import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BlobError,
  BlobNotFoundError,
  copy,
  del,
  get,
  head,
  issueSignedToken,
  LOCAL_BLOB_HOST,
  list,
  presignUrl,
  put,
  readLocalBlob,
} from "./local-blob";

describe("the on-disk Blob stand-in for eval lanes", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "local-blob-"));
    vi.stubEnv("EVAL_LOCAL_BLOB_DIR", dir);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("uploads, reads by pathname or URL, and deletes", async () => {
    const stored = await put("drive/org-1/notes.md", "# Notes", {
      contentType: "text/markdown",
      addRandomSuffix: false,
    });
    expect(stored).toMatchObject({
      pathname: "drive/org-1/notes.md",
      contentType: "text/markdown",
      size: 7,
    });
    expect(new URL(stored.url).hostname).toBe(LOCAL_BLOB_HOST);
    expect((await head(stored.url)).pathname).toBe("drive/org-1/notes.md");
    const read = await get("drive/org-1/notes.md", { access: "private" });
    expect(await new Response(read?.stream).text()).toBe("# Notes");
    expect((await readLocalBlob(stored.url))?.bytes.toString()).toBe("# Notes");
    await del([stored.url]);
    await expect(head(stored.url)).rejects.toBeInstanceOf(BlobNotFoundError);
    expect(await get("drive/org-1/notes.md")).toBeNull();
  });

  it("refuses to overwrite unless asked, and suffixes on request", async () => {
    await put("drive/a.pdf", new Uint8Array([1]), {});
    await expect(
      put("drive/a.pdf", new Uint8Array([2]), {}),
    ).rejects.toBeInstanceOf(BlobError);
    await put("drive/a.pdf", new Uint8Array([2]), { allowOverwrite: true });
    expect((await head("drive/a.pdf")).size).toBe(1);
    const suffixed = await put("drive/a.pdf", "x", { addRandomSuffix: true });
    expect(suffixed.pathname).toMatch(/^drive\/a-[0-9a-f]{8}\.pdf$/);
  });

  it("copies and lists like the real store, and never leaves its directory", async () => {
    await put("tasks/t1/brief.md", "brief", { allowOverwrite: true });
    const copied = await copy("tasks/t1/brief.md", "tasks/t2/brief.md", {});
    expect(copied.pathname).toBe("tasks/t2/brief.md");
    const listed = await list({ prefix: "tasks/" });
    expect(listed.blobs.map((blob) => blob.pathname)).toEqual([
      "tasks/t1/brief.md",
      "tasks/t2/brief.md",
    ]);
    expect((await list({ prefix: "tasks/", mode: "folded" })).folders).toEqual([
      "tasks/t1/",
      "tasks/t2/",
    ]);
    await expect(put("../outside", "x", {})).rejects.toThrow(/escapes/);
  });

  it("presigns a read as the object's own URL", async () => {
    const token = await issueSignedToken({ pathname: "drive/a.pdf" });
    const { presignedUrl } = await presignUrl(token, {
      pathname: "drive/a.pdf",
    });
    expect(new URL(presignedUrl).hostname).toBe(LOCAL_BLOB_HOST);
  });
});
