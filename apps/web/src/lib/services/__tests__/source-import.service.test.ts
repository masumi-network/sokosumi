jest.mock("server-only", () => ({}));

const captureExceptionMock = jest.fn();

jest.mock("@sentry/nextjs", () => {
  const sentry = {
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
  };

  return {
    __esModule: true,
    ...sentry,
    default: sentry,
  };
});

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => (fn: () => Promise<void>) => fn(),
}));

const getPendingBlobsMock = jest.fn();
const markBlobReadyMock = jest.fn();
const markBlobFailedMock = jest.fn();

jest.mock("@sokosumi/database/repositories", () => ({
  blobRepository: {
    getPendingBlobs: (...args: unknown[]) => getPendingBlobsMock(...args),
    markBlobReady: (...args: unknown[]) => markBlobReadyMock(...args),
    markBlobFailed: (...args: unknown[]) => markBlobFailedMock(...args),
  },
  linkRepository: {
    upsertLink: jest.fn(),
  },
}));

const uploadFileForBlobMock = jest.fn();
jest.mock("@/lib/blob/utils", () => ({
  uploadFileForBlob: (...args: unknown[]) => uploadFileForBlobMock(...args),
}));

const headMock = jest.fn();
jest.mock("@vercel/blob", () => ({
  head: (...args: unknown[]) => headMock(...args),
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {},
}));

import { BlobStatus, type Blob } from "@sokosumi/database";

import { sourceImportService } from "../source-import.service";

function createPendingBlob(overrides: Partial<Blob> = {}): Blob {
  return {
    id: "blob_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    fileUrl: null,
    name: null,
    mimeType: null,
    size: null,
    sourceUrl: "https://example.com/files/source.txt",
    status: BlobStatus.PENDING,
    eventId: "event_1",
    ...overrides,
  };
}

function createUploadedBlob(url: string) {
  return {
    url,
    pathname: "blobs/blob_1/source.txt",
    downloadUrl: `${url}?download=1`,
    contentType: "text/plain",
    contentDisposition: "attachment; filename=source.txt",
    etag: "etag_123",
  };
}

describe("sourceImportService.importPendingResultBlobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores size from uploaded blob metadata instead of source content-length", async () => {
    const sourceResponse = new Response("hello", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": "1",
        "content-disposition": 'attachment; filename="result.txt"',
      },
    });
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(sourceResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    getPendingBlobsMock.mockResolvedValue([createPendingBlob()]);
    uploadFileForBlobMock.mockResolvedValue(
      createUploadedBlob("https://blob.example/result.txt"),
    );
    headMock.mockResolvedValue({
      size: 999,
      uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
      pathname: "blobs/blob_1/result.txt",
      contentType: "application/pdf",
      contentDisposition: "attachment; filename=result.txt",
      url: "https://blob.example/result.txt",
      downloadUrl: "https://blob.example/result.txt?download=1",
      cacheControl: "public, max-age=31536000",
      etag: "etag_abc",
    });

    const processedCount = await sourceImportService.importPendingResultBlobs();

    expect(processedCount).toBe(1);
    expect(markBlobReadyMock).toHaveBeenCalledWith(
      "blob_1",
      expect.objectContaining({
        fileUrl: "https://blob.example/result.txt",
        mimeType: "application/pdf",
        size: BigInt(999),
        name: "result.txt",
      }),
      expect.any(Object),
    );
    expect(markBlobFailedMock).not.toHaveBeenCalled();
  });

  it("marks blob as failed when blob head metadata lookup fails", async () => {
    const sourceResponse = new Response("hello world", {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
    });
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(sourceResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    getPendingBlobsMock.mockResolvedValue([createPendingBlob()]);
    uploadFileForBlobMock.mockResolvedValue(
      createUploadedBlob("https://blob.example/fallback.txt"),
    );
    headMock.mockRejectedValue(new Error("head failed"));

    await sourceImportService.importPendingResultBlobs();

    expect(markBlobReadyMock).not.toHaveBeenCalled();
    expect(markBlobFailedMock).toHaveBeenCalledWith(
      "blob_1",
      expect.any(Object),
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
