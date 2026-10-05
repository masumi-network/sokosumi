import { BlobStatus } from "@sokosumi/database";
import type { SsrfSafeFetchInit } from "@sokosumi/net";
import { FILE_UPLOAD_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  blobFindManyMock,
  blobFindUniqueMock,
  blobHeadMock,
  blobPutMock,
  blobUpdateMock,
  taskFileFindManyMock,
  taskFileFindUniqueMock,
  taskFileUpdateMock,
  enqueueTaskOutputsFromMarkdownMock,
} = vi.hoisted(() => ({
  blobFindManyMock: vi.fn(),
  blobFindUniqueMock: vi.fn(),
  blobHeadMock: vi.fn(),
  blobPutMock: vi.fn(),
  blobUpdateMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  taskFileFindUniqueMock: vi.fn(),
  taskFileUpdateMock: vi.fn(),
  enqueueTaskOutputsFromMarkdownMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BLOB_READ_WRITE_TOKEN: "test-blob-token",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    blob: {
      findMany: blobFindManyMock,
      findUnique: blobFindUniqueMock,
      update: blobUpdateMock,
    },
    taskFile: {
      findMany: taskFileFindManyMock,
      findUnique: taskFileFindUniqueMock,
      update: taskFileUpdateMock,
    },
  },
}));

vi.mock("@vercel/blob", () => ({
  head: blobHeadMock,
  put: blobPutMock,
}));

// The SSRF guard is unit-tested in `@sokosumi/net`. Here we stub it to
// delegate straight to the mocked `global.fetch` so these orchestration tests
// keep exercising the worker's scheduling/cancellation behavior.
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: (url: string, init: SsrfSafeFetchInit) =>
    global.fetch(url, init),
}));

vi.mock("./source-import.service", () => ({
  sourceImportService: {
    enqueueTaskOutputsFromMarkdown: enqueueTaskOutputsFromMarkdownMock,
  },
}));

const originalFetch = global.fetch;

interface PendingBlobStub {
  id: string;
  name: string | null;
  sourceUrl: string;
  status: BlobStatus;
  createdAt: Date;
  event: { jobId: string } | null;
}

interface ImportPendingResultBlobsOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

function createImportOptions(
  overrides: Partial<ImportPendingResultBlobsOptions> = {},
): ImportPendingResultBlobsOptions {
  return {
    abortSignal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
    ...overrides,
  };
}

function createPendingBlob(index: number): PendingBlobStub {
  return {
    id: `blob-${index}`,
    name: `blob-${index}.txt`,
    sourceUrl: `https://example.com/blob-${index}.txt`,
    status: BlobStatus.PENDING,
    createdAt: new Date(`2026-02-25T10:00:0${index}.000Z`),
    event: { jobId: "job-1" },
  };
}

/** Mirrors the `SsrfError` `ssrfSafeFetch` throws once a body passes the cap. */
function createSizeRejection(): Error {
  const error = new Error("Response body exceeds maxResponseBytes (1)");
  error.name = "SsrfError";
  return error;
}

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function getSourceImportSyncService() {
  const module = await import("./source-import-sync.service");
  return module.sourceImportSyncService;
}

describe("sourceImportSyncService.importPendingResultBlobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const pendingBlobs = Array.from({ length: 6 }, (_, index) =>
      createPendingBlob(index + 1),
    );
    const blobsById = new Map(pendingBlobs.map((blob) => [blob.id, blob]));

    blobFindManyMock.mockResolvedValue(pendingBlobs);
    blobFindUniqueMock.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(blobsById.get(where.id) ?? null),
    );
    blobPutMock.mockImplementation(async (pathname: string) => ({
      url: `https://blob.example/${pathname}`,
    }));
    blobHeadMock.mockResolvedValue({
      contentType: "text/plain",
      size: 5,
    });
    blobUpdateMock.mockResolvedValue(undefined);
    taskFileFindManyMock.mockResolvedValue([]);
    taskFileFindUniqueMock.mockResolvedValue(null);
    taskFileUpdateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("continues scheduling later blobs when one running import is stalled", async () => {
    const sourceImportSyncService = await getSourceImportSyncService();

    let resolveHungFetch: ((response: Response) => void) | undefined;
    const hungFetchPromise = new Promise<Response>((resolve) => {
      resolveHungFetch = resolve;
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url === "https://example.com/blob-1.txt") {
          return await hungFetchPromise;
        }

        return new Response("hello", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const runPromise = sourceImportSyncService.importPendingResultBlobs(
      createImportOptions(),
    );

    try {
      await waitFor(() => {
        const calledUrls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(calledUrls).toContain("https://example.com/blob-6.txt");
      });
    } finally {
      const resolve = resolveHungFetch;
      if (!resolve) {
        throw new Error("Expected hung fetch resolver to be assigned");
      }

      resolve(
        new Response("late hello", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        }),
      );
    }

    const processedCount = await runPromise;
    expect(processedCount).toBe(6);
  });

  it("stores imported blobs under jobs/{jobId}/ pathname", async () => {
    const sourceImportSyncService = await getSourceImportSyncService();
    const pendingBlob = createPendingBlob(1);

    blobFindManyMock.mockResolvedValue([pendingBlob]);
    blobFindUniqueMock.mockResolvedValue(pendingBlob);

    const fetchMock = vi.fn(async () => {
      return new Response("hello", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sourceImportSyncService.importPendingResultBlobs(
      createImportOptions(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      pendingBlob.sourceUrl,
      expect.objectContaining({ maxResponseBytes: FILE_UPLOAD_MAX_SIZE_BYTES }),
    );
    expect(blobPutMock).toHaveBeenCalledOnce();
    const [pathname] = blobPutMock.mock.calls[0] ?? [];
    expect(pathname).toMatch(/^jobs\/job-1\//);
    expect(pathname).not.toMatch(/^blobs\//);
    expect(blobUpdateMock).toHaveBeenCalledWith({
      where: { id: pendingBlob.id },
      data: expect.objectContaining({
        status: BlobStatus.READY,
        fileUrl: expect.stringContaining("jobs/job-1/"),
      }),
    });
  });

  it("marks blob FAILED when the fetch rejects the body size", async () => {
    const sourceImportSyncService = await getSourceImportSyncService();
    const pendingBlob = createPendingBlob(1);

    blobFindManyMock.mockResolvedValue([pendingBlob]);
    blobFindUniqueMock.mockResolvedValue(pendingBlob);
    global.fetch = vi
      .fn()
      .mockRejectedValue(createSizeRejection()) as unknown as typeof fetch;

    await sourceImportSyncService.importPendingResultBlobs(
      createImportOptions(),
    );

    expect(blobPutMock).not.toHaveBeenCalled();
    expect(blobUpdateMock).toHaveBeenCalledWith({
      where: { id: pendingBlob.id },
      data: { status: BlobStatus.FAILED },
    });
  });

  it("marks blob FAILED when jobId is missing and skips put", async () => {
    const sourceImportSyncService = await getSourceImportSyncService();
    const pendingBlob: PendingBlobStub = {
      ...createPendingBlob(1),
      event: null,
    };

    blobFindManyMock.mockResolvedValue([pendingBlob]);
    blobFindUniqueMock.mockResolvedValue(pendingBlob);

    global.fetch = vi.fn(async () => {
      return new Response("hello", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      });
    }) as unknown as typeof fetch;

    await sourceImportSyncService.importPendingResultBlobs(
      createImportOptions(),
    );

    expect(blobPutMock).not.toHaveBeenCalled();
    expect(blobUpdateMock).toHaveBeenCalledWith({
      where: { id: pendingBlob.id },
      data: { status: BlobStatus.FAILED },
    });
  });

  it("stops processing when cancellation is reached and keeps timed-out blobs pending", async () => {
    vi.useFakeTimers();
    try {
      const sourceImportSyncService = await getSourceImportSyncService();
      const now = new Date("2026-02-25T10:00:00.000Z");
      vi.setSystemTime(now);

      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);

          if (url.startsWith("https://example.com/blob-")) {
            const signal = init?.signal;

            return new Promise<Response>((_resolve, reject) => {
              if (signal instanceof AbortSignal) {
                signal.addEventListener("abort", () => {
                  reject(new DOMException("Request timed out", "TimeoutError"));
                });
              }
            });
          }

          return Promise.resolve(
            new Response("hello", {
              status: 200,
              headers: {
                "content-type": "text/plain",
              },
            }),
          );
        },
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const runPromise = sourceImportSyncService.importPendingResultBlobs(
        createImportOptions({
          abortSignal: AbortSignal.timeout(200),
          deadlineMs: Date.now() + 1000,
        }),
      );

      vi.advanceTimersByTime(250);
      await runPromise;

      const failedUpdateCalls = blobUpdateMock.mock.calls.filter(
        ([payload]) => {
          return payload.data?.status === BlobStatus.FAILED;
        },
      );

      expect(failedUpdateCalls).toHaveLength(0);
      expect(blobPutMock).not.toHaveBeenCalled();
      expect(blobHeadMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("TaskFile import (task-output files from comments)", () => {
    it("imports PENDING TASK_OUTPUT TaskFile and marks READY", async () => {
      const taskFileId = "tfile_123";
      const taskId = "tsk_123";
      const sourceUrl = "https://example.com/report.pdf";
      const fileContent = "test file content";

      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl,
        fileUrl: null,
        name: "report.pdf",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });
      blobFindManyMock.mockResolvedValue([]);

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(fileContent, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      );
      global.fetch = fetchMock;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock).toHaveBeenCalledWith(
        sourceUrl,
        expect.objectContaining({
          maxResponseBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
        }),
      );
      expect(blobPutMock).toHaveBeenCalledWith(
        `tasks/${taskId}/report.pdf`,
        expect.any(Blob),
        expect.objectContaining({
          access: "public",
          addRandomSuffix: true,
        }),
      );
      expect(taskFileUpdateMock).toHaveBeenCalledWith({
        where: { id: taskFileId },
        data: {
          status: "READY",
          fileUrl: `https://blob.example/tasks/${taskId}/report.pdf`,
          mimeType: "text/plain",
          name: "report.pdf",
          size: BigInt(5),
        },
      });
    });

    it("marks TaskFile FAILED when fetch fails", async () => {
      const taskFileId = "tfile_124";
      const taskId = "tsk_124";
      const sourceUrl = "https://example.com/missing.pdf";

      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl,
        fileUrl: null,
        name: "missing.pdf",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });
      blobFindManyMock.mockResolvedValue([]);

      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 404 }));
      global.fetch = fetchMock;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock).toHaveBeenCalledWith(sourceUrl, expect.anything());
      expect(blobPutMock).not.toHaveBeenCalled();
      expect(taskFileUpdateMock).toHaveBeenCalledWith({
        where: { id: taskFileId },
        data: {
          status: "FAILED",
        },
      });
    });

    it("marks TaskFile FAILED when the fetch rejects the body size", async () => {
      const taskFileId = "tfile_125";
      const taskId = "tsk_125";
      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl: "https://example.com/huge.pdf",
        fileUrl: null,
        name: "huge.pdf",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });
      blobFindManyMock.mockResolvedValue([]);
      global.fetch = vi
        .fn()
        .mockRejectedValue(createSizeRejection()) as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).not.toHaveBeenCalled();
      expect(taskFileUpdateMock).toHaveBeenCalledWith({
        where: { id: taskFileId },
        data: { status: "FAILED" },
      });
    });

    it("keeps TaskFile PENDING when deadline is reached", async () => {
      vi.useFakeTimers();
      try {
        const taskFileId = "tfile_125";
        const taskId = "tsk_125";
        const sourceUrl = "https://example.com/slow.pdf";

        const pendingTaskFile = {
          id: taskFileId,
          taskId,
          sourceUrl,
          fileUrl: null,
          name: "slow.pdf",
          status: "PENDING",
          origin: "TASK_OUTPUT",
          createdAt: new Date("2026-02-25T10:00:00.000Z"),
        };

        taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
        taskFileFindUniqueMock.mockResolvedValue({
          ...pendingTaskFile,
          task: { id: taskId },
        });
        blobFindManyMock.mockResolvedValue([]);

        const sourceImportSyncService = await getSourceImportSyncService();
        const now = new Date("2026-02-25T10:00:00.000Z");
        vi.setSystemTime(now);

        const fetchMock = vi.fn(
          (input: RequestInfo | URL, init?: RequestInit) => {
            const signal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
              if (signal instanceof AbortSignal) {
                signal.addEventListener("abort", () => {
                  reject(new DOMException("Request timed out", "TimeoutError"));
                });
              }
            });
          },
        );
        global.fetch = fetchMock;

        const runPromise = sourceImportSyncService.importPendingResultBlobs(
          createImportOptions({
            abortSignal: AbortSignal.timeout(200),
            deadlineMs: now.getTime() + 1000,
          }),
        );

        vi.advanceTimersByTime(250);
        await runPromise;

        expect(fetchMock).toHaveBeenCalled();
        expect(blobPutMock).not.toHaveBeenCalled();
        expect(taskFileUpdateMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("processes blobs and TaskFiles together", async () => {
      const pendingBlob = createPendingBlob(1);
      const pendingTaskFile = {
        id: "tfile_126",
        taskId: "tsk_126",
        sourceUrl: "https://example.com/task-file.pdf",
        fileUrl: null,
        name: "task-file.pdf",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:01.000Z"),
      };

      blobFindManyMock.mockResolvedValue([pendingBlob]);
      blobFindUniqueMock.mockImplementation(({ where }) =>
        Promise.resolve(where.id === pendingBlob.id ? pendingBlob : null),
      );
      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: "tsk_126" },
      });

      const fetchMock = vi.fn().mockResolvedValue(
        new Response("content", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );
      global.fetch = fetchMock;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(blobPutMock).toHaveBeenCalled();
      expect(blobUpdateMock).toHaveBeenCalled();
      expect(taskFileUpdateMock).toHaveBeenCalled();
    });
  });

  describe("source URLs that name a page rather than a file", () => {
    const BLOB_PAGE =
      "https://github.com/masumi-network/sokosumi/blob/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";
    const DOWNLOAD_ROUTE =
      "https://github.com/masumi-network/sokosumi/raw/84d0a395284dd5dda58367470411a1e611c2c997/docs/image-studio/deployment.md";

    /**
     * The reported bug: a job linked a GitHub blob page ending in `.md`, the
     * importer downloaded the HTML page and stored it as `deployment.md`, and
     * opening the file showed GitHub's navigation menu rendered as Markdown.
     */
    function pendingMarkdownBlob(sourceUrl: string) {
      return {
        id: "blob-md",
        name: "deployment.md",
        sourceUrl,
        status: BlobStatus.PENDING,
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
        event: { jobId: "job-1" },
      };
    }

    function onlyBlob(blob: ReturnType<typeof pendingMarkdownBlob>) {
      blobFindManyMock.mockResolvedValue([blob]);
      blobFindUniqueMock.mockResolvedValue(blob);
      taskFileFindManyMock.mockResolvedValue([]);
    }

    it("downloads through GitHub's storage-aware route for a blob page", async () => {
      onlyBlob(pendingMarkdownBlob(BLOB_PAGE));
      blobHeadMock.mockResolvedValue({
        contentType: "text/markdown",
        size: 12,
      });

      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("# Deployment\n\nReal markdown.", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        DOWNLOAD_ROUTE,
      ]);
      expect(blobPutMock).toHaveBeenCalled();
      expect(blobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BlobStatus.READY }),
        }),
      );
    });

    it("fails the import instead of storing a web page as Markdown", async () => {
      onlyBlob(pendingMarkdownBlob("https://docs.example.com/guide.md"));

      const fetchMock = vi.fn(async () => {
        return new Response(
          "<!DOCTYPE html><html><body>Navigation Menu</body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).not.toHaveBeenCalled();
      expect(blobUpdateMock).toHaveBeenCalledWith({
        where: { id: "blob-md" },
        data: { status: BlobStatus.FAILED },
      });
    });

    it("still imports an ordinary Markdown file untouched", async () => {
      onlyBlob(pendingMarkdownBlob("https://example.com/notes.md"));
      blobHeadMock.mockResolvedValue({
        contentType: "text/markdown",
        size: 9,
      });

      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("# Notes", {
            status: 200,
            headers: { "content-type": "text/markdown" },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "https://example.com/notes.md",
      ]);
      expect(blobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BlobStatus.READY }),
        }),
      );
    });

    it("still imports a page that is genuinely meant to be HTML", async () => {
      const blob = {
        ...pendingMarkdownBlob("https://example.com/report.html"),
        name: "report.html",
      };
      onlyBlob(blob);
      blobHeadMock.mockResolvedValue({ contentType: "text/html", size: 20 });

      global.fetch = vi.fn(async () => {
        return new Response("<html><body>Report</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }) as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).toHaveBeenCalled();
      expect(blobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BlobStatus.READY }),
        }),
      );
    });

    it("downloads through the same route for a GitHub-linked task output", async () => {
      const taskFileId = "tfile_md";
      const taskId = "tsk_md";
      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl: BLOB_PAGE,
        fileUrl: null,
        name: "deployment.md",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      blobFindManyMock.mockResolvedValue([]);
      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });
      blobHeadMock.mockResolvedValue({
        contentType: "text/markdown",
        size: 12,
      });

      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("# Deployment", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        DOWNLOAD_ROUTE,
      ]);
      expect(taskFileUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "READY" }),
        }),
      );
    });

    /**
     * An existing `/raw/` link already reaches the bytes, including for Git
     * LFS files where it redirects to `media.githubusercontent.com`.
     * Rewriting it to `raw.githubusercontent.com` would fetch the ~130 byte
     * LFS pointer instead — with a 200 and `text/plain`, so it would be
     * stored READY and the file would be unusable.
     */
    it("leaves an existing GitHub /raw/ link untouched, for Git LFS", async () => {
      const lfsRawRoute =
        "https://github.com/Schoonology/git-lfs-test/raw/master/binary.jpg";
      const blob = {
        ...pendingMarkdownBlob(lfsRawRoute),
        name: "binary.jpg",
      };
      onlyBlob(blob);
      blobHeadMock.mockResolvedValue({
        contentType: "image/jpeg",
        size: 620773,
      });

      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("\xff\xd8\xff\xe0 jpeg bytes", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      const requested = fetchMock.mock.calls.map(([input]) => String(input));
      expect(requested).toEqual([lfsRawRoute]);
      expect(requested[0]).not.toContain("raw.githubusercontent.com");
      expect(blobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BlobStatus.READY }),
        }),
      );
    });

    /**
     * The response names itself in `Content-Disposition`, and that name used
     * to win outright — so a page could clear the HTML check by answering
     * `filename="login.html"` for a request the job made for `guide.md`.
     */
    it("rejects HTML renamed by Content-Disposition, on the blob path", async () => {
      const blob = {
        ...pendingMarkdownBlob("https://docs.example.com/guide.md"),
        name: "guide.md",
      };
      onlyBlob(blob);

      global.fetch = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("<!DOCTYPE html><html><body>Sign in</body></html>", {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-disposition": 'attachment; filename="login.html"',
            },
          }),
      ) as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).not.toHaveBeenCalled();
      expect(blobUpdateMock).toHaveBeenCalledWith({
        where: { id: "blob-md" },
        data: { status: BlobStatus.FAILED },
      });
    });

    it("rejects HTML renamed by Content-Disposition, on the task-file path", async () => {
      const taskFileId = "tfile_cd";
      const taskId = "tsk_cd";
      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl: "https://docs.example.com/guide.md",
        fileUrl: null,
        name: "guide.md",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      blobFindManyMock.mockResolvedValue([]);
      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });

      global.fetch = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response("<!DOCTYPE html><html><body>Sign in</body></html>", {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-disposition": 'attachment; filename="login.html"',
            },
          }),
      ) as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).not.toHaveBeenCalled();
      expect(taskFileUpdateMock).toHaveBeenCalledWith({
        where: { id: taskFileId },
        data: { status: "FAILED" },
      });
    });

    /** The task-file path had no HTML-failure regression of its own. */
    it("fails a plain HTML page on the task-file path", async () => {
      const taskFileId = "tfile_html";
      const taskId = "tsk_html";
      const pendingTaskFile = {
        id: taskFileId,
        taskId,
        sourceUrl: "https://docs.example.com/handbook.md",
        fileUrl: null,
        name: "handbook.md",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
      };

      blobFindManyMock.mockResolvedValue([]);
      taskFileFindManyMock.mockResolvedValue([pendingTaskFile]);
      taskFileFindUniqueMock.mockResolvedValue({
        ...pendingTaskFile,
        task: { id: taskId },
      });

      global.fetch = vi.fn(
        async (_input: RequestInfo | URL): Promise<Response> =>
          new Response(
            "<!DOCTYPE html><html><body>Navigation Menu</body></html>",
            {
              status: 200,
              headers: { "content-type": "text/html" },
            },
          ),
      ) as unknown as typeof fetch;

      const sourceImportSyncService = await getSourceImportSyncService();
      await sourceImportSyncService.importPendingResultBlobs(
        createImportOptions(),
      );

      expect(blobPutMock).not.toHaveBeenCalled();
      expect(taskFileUpdateMock).toHaveBeenCalledWith({
        where: { id: taskFileId },
        data: { status: "FAILED" },
      });
    });
  });
});
