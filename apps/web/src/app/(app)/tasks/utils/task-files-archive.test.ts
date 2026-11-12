import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTaskFilesArchive,
  MAX_TASK_ARCHIVE_FILES,
  readWithinBudget,
  safeFileName,
  uniqueArchiveName,
} from "./task-files-archive";

function file(name: string) {
  return { name, fileUrl: `https://blob.test/${encodeURIComponent(name)}` };
}

/** A body of `chunks` chunks of `size` bytes, read only on demand. */
function streamedResponse(chunks: number, size: number, init?: ResponseInit) {
  const pulls = { count: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls.count++;
        if (pulls.count > chunks) controller.close();
        else controller.enqueue(new Uint8Array(size));
      },
      cancel() {
        pulls.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, init), pulls };
}

describe("task files archive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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
        "summary",
        "summary.",
        "summary .. ",
        "CON.txt",
        "con",
        "nul.",
        "Lpt1.tar.gz",
        "COM9 ",
        "console.txt",
      ].map((name) => uniqueArchiveName(name, taken)),
    ).toEqual([
      "Report.pdf",
      "report (2).pdf",
      "Report (3).pdf",
      "..-etc-passwd",
      "file",
      "notes",
      "notes (2)",
      "summary",
      "summary (2)",
      "summary (3)",
      "_CON.txt",
      "_con",
      "_nul",
      "_Lpt1.tar.gz",
      "_COM9",
      "console.txt",
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

  it("refuses a body declared over budget without reading it", async () => {
    const { response, pulls } = streamedResponse(3, 4, {
      headers: { "content-length": "12" },
    });
    expect(await readWithinBudget(response, 11)).toBeNull();
    expect(pulls.count).toBe(0);
    expect(pulls.cancelled).toBe(true);
  });

  it("stops reading an undeclared body at the first chunk over budget", async () => {
    const { response, pulls } = streamedResponse(100, 4);
    expect(await readWithinBudget(response, 6)).toBeNull();
    expect(pulls.count).toBe(2);
    expect(pulls.cancelled).toBe(true);

    const fits = streamedResponse(2, 4);
    expect((await readWithinBudget(fits.response, 8))?.size).toBe(8);
  });

  it("shares one byte budget across files and names the file that passed it", async () => {
    const first = streamedResponse(1, 4);
    const second = streamedResponse(100, 4);
    const third = streamedResponse(1, 2);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response)
        .mockResolvedValueOnce(third.response),
    );
    const archive = await createTaskFilesArchive(
      [file("small"), file("huge"), file("fits")],
      undefined,
      6,
    );
    expect(archive.included).toEqual(["small", "fits"]);
    expect(archive.missing).toEqual(["huge"]);
    expect(second.pulls.count).toBe(1);
    expect(second.pulls.cancelled).toBe(true);
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

  it("does not return a zip when cancelled after the last file was read", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response("last");
        controller.abort();
        return response;
      }),
    );
    await expect(
      createTaskFilesArchive([file("a")], controller.signal),
    ).rejects.toThrow();
  });

  it("does not return a zip when cancelled while it is being made", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("a")),
    );
    vi.spyOn(JSZip.prototype, "generateAsync").mockImplementation(async () => {
      controller.abort();
      return new ArrayBuffer(1);
    });
    await expect(
      createTaskFilesArchive([file("a")], controller.signal),
    ).rejects.toThrow();
  });
});
