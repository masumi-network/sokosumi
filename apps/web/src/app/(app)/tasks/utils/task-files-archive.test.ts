import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTaskFilesArchive,
  MAX_TASK_ARCHIVE_BYTES,
  MAX_TASK_ARCHIVE_FILES,
  safeFileName,
  uniqueArchiveName,
} from "./task-files-archive";

function file(name: string) {
  return { name, fileUrl: `https://blob.test/${encodeURIComponent(name)}` };
}

describe("task files archive", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps every name distinct and inside the zip folder", () => {
    const taken = new Set<string>();
    expect(
      [
        "Report.pdf",
        "report.pdf",
        "Report.pdf",
        "../etc/passwd",
        "..",
        "notes",
        "notes",
      ].map((name) => uniqueArchiveName(name, taken)),
    ).toEqual([
      "Report.pdf",
      "report (2).pdf",
      "Report (3).pdf",
      "..-etc-passwd",
      "file",
      "notes",
      "notes (2)",
    ]);
    expect(safeFileName(" a\u0000b:c ", "x")).toBe("a-b-c");
    expect(safeFileName("   ", "files")).toBe("files");
  });

  it("zips the bytes of each file and names the ones that failed", async () => {
    const fetchFile = vi
      .fn()
      .mockResolvedValueOnce(new Response("one"))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("two"));
    vi.stubGlobal("fetch", fetchFile);

    const archive = await createTaskFilesArchive([
      file("a.txt"),
      file("missing.txt"),
      file("blocked.txt"),
      file("a.txt"),
    ]);

    expect(fetchFile.mock.calls.map(([url]) => url)).toEqual([
      "https://blob.test/a.txt",
      "https://blob.test/missing.txt",
      "https://blob.test/blocked.txt",
      "https://blob.test/a.txt",
    ]);
    expect(archive.included).toEqual(["a.txt", "a.txt"]);
    expect(archive.missing).toEqual(["missing.txt", "blocked.txt"]);
    const zip = await JSZip.loadAsync(archive.data ?? new ArrayBuffer(0));
    expect(Object.keys(zip.files)).toEqual(["a.txt", "a (2).txt"]);
    expect(await zip.file("a.txt")?.async("text")).toBe("one");
    expect(await zip.file("a (2).txt")?.async("text")).toBe("two");
  });

  it("returns no zip when nothing could be added", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 403 })),
    );
    const archive = await createTaskFilesArchive([file("a"), file("b")]);
    expect(archive).toEqual({ data: null, included: [], missing: ["a", "b"] });
  });

  it("lists files over the count limit as not included", async () => {
    const fetchFile = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetchFile);
    const files = Array.from({ length: MAX_TASK_ARCHIVE_FILES + 2 }, (_, i) =>
      file(`f${i}`),
    );
    const archive = await createTaskFilesArchive(files);
    expect(archive.included).toHaveLength(MAX_TASK_ARCHIVE_FILES);
    expect(archive.missing).toEqual([
      `f${MAX_TASK_ARCHIVE_FILES}`,
      `f${MAX_TASK_ARCHIVE_FILES + 1}`,
    ]);
    expect(fetchFile).toHaveBeenCalledTimes(MAX_TASK_ARCHIVE_FILES);
  });

  it("leaves out a file that would pass the size limit", async () => {
    const big = { size: MAX_TASK_ARCHIVE_BYTES } as Blob;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("small"))
        .mockResolvedValueOnce({ ok: true, blob: async () => big }),
    );
    const archive = await createTaskFilesArchive([file("small"), file("huge")]);
    expect(archive.included).toEqual(["small"]);
    expect(archive.missing).toEqual(["huge"]);
  });

  it("stops when the download is cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(
      createTaskFilesArchive([file("a"), file("b")], controller.signal),
    ).rejects.toThrow("Aborted");
  });
});
