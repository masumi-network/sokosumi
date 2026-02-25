import { BlobStatus } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  blobFindManyMock,
  blobFindUniqueMock,
  blobHeadMock,
  blobPutMock,
  blobUpdateMock,
} = vi.hoisted(() => ({
  blobFindManyMock: vi.fn(),
  blobFindUniqueMock: vi.fn(),
  blobHeadMock: vi.fn(),
  blobPutMock: vi.fn(),
  blobUpdateMock: vi.fn(),
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
  },
}));

vi.mock("@vercel/blob", () => ({
  head: blobHeadMock,
  put: blobPutMock,
}));

const originalFetch = global.fetch;

interface PendingBlobStub {
  id: string;
  name: string | null;
  sourceUrl: string;
  status: BlobStatus;
  createdAt: Date;
}

function createPendingBlob(index: number): PendingBlobStub {
  return {
    id: `blob-${index}`,
    name: `blob-${index}.txt`,
    sourceUrl: `https://example.com/blob-${index}.txt`,
    status: BlobStatus.PENDING,
    createdAt: new Date(`2026-02-25T10:00:0${index}.000Z`),
  };
}

async function waitFor(
  assertion: () => void,
  timeoutMs = 500,
): Promise<void> {
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("continues scheduling later blobs when one running import is stalled", async () => {
    const sourceImportSyncService = await getSourceImportSyncService();

    let resolveHungFetch: ((response: Response) => void) | null = null;
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

    const runPromise = sourceImportSyncService.importPendingResultBlobs();

    try {
      await waitFor(() => {
        const calledUrls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(calledUrls).toContain("https://example.com/blob-6.txt");
      });
    } finally {
      resolveHungFetch?.(
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
});
