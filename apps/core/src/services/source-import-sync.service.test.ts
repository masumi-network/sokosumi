import { BlobStatus } from "@sokosumi/database";
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
} = vi.hoisted(() => ({
  blobFindManyMock: vi.fn(),
  blobFindUniqueMock: vi.fn(),
  blobHeadMock: vi.fn(),
  blobPutMock: vi.fn(),
  blobUpdateMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  taskFileFindUniqueMock: vi.fn(),
  taskFileUpdateMock: vi.fn(),
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
vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: (url: string, init?: RequestInit) => global.fetch(url, init),
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

      expect(fetchMock).toHaveBeenCalledWith(sourceUrl, expect.anything());
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
});
