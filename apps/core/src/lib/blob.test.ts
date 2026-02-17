import { afterEach, describe, expect, it, vi } from "vitest";

import { listUserFiles, uploadUserFile } from "./blob";

const { putMock, headMock, listMock, sentryCaptureExceptionMock } = vi.hoisted(
  () => ({
    putMock: vi.fn(),
    headMock: vi.fn(),
    listMock: vi.fn(),
    sentryCaptureExceptionMock: vi.fn(),
  }),
);

vi.mock("@vercel/blob", () => ({
  put: putMock,
  head: headMock,
  list: listMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: sentryCaptureExceptionMock,
}));

describe("uploadUserFile", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("uploads into user namespace and returns canonical metadata from head", async () => {
    putMock.mockResolvedValue({
      url: "https://blob.example/users/user_123/report_abc.pdf",
      downloadUrl: "https://blob.example/download/report_abc.pdf",
      pathname: "users/user_123/report_abc.pdf",
      etag: "etag-put",
    });
    headMock.mockResolvedValue({
      size: 123,
      uploadedAt: new Date("2026-02-16T12:00:00.000Z"),
      pathname: "users/user_123/report_abc.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      url: "https://blob.example/users/user_123/report_abc.pdf",
      downloadUrl: "https://blob.example/download/report_abc.pdf",
      cacheControl: "public, max-age=3600",
      etag: "etag-head",
    });

    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    const uploaded = await uploadUserFile("user_123", file, "token_123");

    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/user_123\//),
      file,
      {
        access: "public",
        addRandomSuffix: true,
        allowOverwrite: false,
        contentType: "application/pdf",
        token: "token_123",
      },
    );
    expect(uploaded).toEqual({
      publicUrl: "https://blob.example/users/user_123/report_abc.pdf",
      metadata: {
        pathname: "users/user_123/report_abc.pdf",
        downloadUrl: "https://blob.example/download/report_abc.pdf",
        size: 123,
        uploadedAt: "2026-02-16T12:00:00.000Z",
        etag: "etag-head",
      },
    });
  });

  it("sanitizes file names in the uploaded pathname", async () => {
    putMock.mockResolvedValue({
      url: "https://blob.example/users/user_123/my_file1_abc.pdf",
      downloadUrl: "https://blob.example/download/my_file1_abc.pdf",
      pathname: "users/user_123/my_file1_abc.pdf",
      etag: "etag-put",
    });
    headMock.mockResolvedValue({
      size: 42,
      uploadedAt: new Date("2026-02-16T12:00:00.000Z"),
      pathname: "users/user_123/my_file1_abc.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      url: "https://blob.example/users/user_123/my_file1_abc.pdf",
      downloadUrl: "https://blob.example/download/my_file1_abc.pdf",
      cacheControl: "public, max-age=3600",
      etag: "etag-head",
    });

    const file = new File(["hello"], " ../my file(1).pdf ", {
      type: "application/pdf",
    });

    await uploadUserFile("user_123", file, "token_123");

    expect(putMock).toHaveBeenCalledWith(
      expect.stringContaining("users/user_123/my_file1.pdf"),
      file,
      expect.any(Object),
    );
  });

  it("falls back to deterministic metadata when head fails", async () => {
    putMock.mockResolvedValue({
      url: "https://blob.example/users/user_123/photo_abc.png",
      downloadUrl: "https://blob.example/download/photo_abc.png",
      pathname: "users/user_123/photo_abc.png",
      etag: "etag-put",
    });
    headMock.mockRejectedValue(new Error("head failed"));

    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", {
      type: "image/png",
    });

    const uploaded = await uploadUserFile("user_123", file, "token_123");

    expect(uploaded.publicUrl).toBe(
      "https://blob.example/users/user_123/photo_abc.png",
    );
    expect(uploaded.metadata.pathname).toBe("users/user_123/photo_abc.png");
    expect(uploaded.metadata.downloadUrl).toBe(
      "https://blob.example/download/photo_abc.png",
    );
    expect(uploaded.metadata.size).toBe(file.size);
    expect(uploaded.metadata.etag).toBe("etag-put");
    expect(new Date(uploaded.metadata.uploadedAt).toISOString()).toBe(
      uploaded.metadata.uploadedAt,
    );
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("listUserFiles", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("lists files by user prefix and sorts newest first", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/users/user_123/older.txt",
          downloadUrl: "https://blob.example/download/older.txt",
          pathname: "users/user_123/older.txt",
          size: 10,
          uploadedAt: new Date("2026-02-16T10:00:00.000Z"),
          etag: "etag-older",
        },
        {
          url: "https://blob.example/users/user_123/newer.txt",
          downloadUrl: "https://blob.example/download/newer.txt",
          pathname: "users/user_123/newer.txt",
          size: 20,
          uploadedAt: new Date("2026-02-16T12:00:00.000Z"),
          etag: "etag-newer",
        },
      ],
      hasMore: false,
      cursor: undefined,
    });

    const files = await listUserFiles("user_123", "token_123");

    expect(listMock).toHaveBeenCalledWith({
      prefix: "users/user_123/",
      token: "token_123",
    });
    expect(files).toEqual([
      {
        publicUrl: "https://blob.example/users/user_123/newer.txt",
        metadata: {
          pathname: "users/user_123/newer.txt",
          downloadUrl: "https://blob.example/download/newer.txt",
          size: 20,
          uploadedAt: "2026-02-16T12:00:00.000Z",
          etag: "etag-newer",
        },
      },
      {
        publicUrl: "https://blob.example/users/user_123/older.txt",
        metadata: {
          pathname: "users/user_123/older.txt",
          downloadUrl: "https://blob.example/download/older.txt",
          size: 10,
          uploadedAt: "2026-02-16T10:00:00.000Z",
          etag: "etag-older",
        },
      },
    ]);
  });

  it("paginates through all blob pages before sorting", async () => {
    listMock
      .mockResolvedValueOnce({
        blobs: [
          {
            url: "https://blob.example/users/user_123/oldest.txt",
            downloadUrl: "https://blob.example/download/oldest.txt",
            pathname: "users/user_123/oldest.txt",
            size: 10,
            uploadedAt: new Date("2026-02-16T09:00:00.000Z"),
            etag: "etag-oldest",
          },
        ],
        hasMore: true,
        cursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        blobs: [
          {
            url: "https://blob.example/users/user_123/newest.txt",
            downloadUrl: "https://blob.example/download/newest.txt",
            pathname: "users/user_123/newest.txt",
            size: 30,
            uploadedAt: new Date("2026-02-16T13:00:00.000Z"),
            etag: "etag-newest",
          },
          {
            url: "https://blob.example/users/user_123/middle.txt",
            downloadUrl: "https://blob.example/download/middle.txt",
            pathname: "users/user_123/middle.txt",
            size: 20,
            uploadedAt: new Date("2026-02-16T11:00:00.000Z"),
            etag: "etag-middle",
          },
        ],
        hasMore: false,
        cursor: undefined,
      });

    const files = await listUserFiles("user_123", "token_123");

    expect(listMock).toHaveBeenNthCalledWith(1, {
      prefix: "users/user_123/",
      token: "token_123",
    });
    expect(listMock).toHaveBeenNthCalledWith(2, {
      prefix: "users/user_123/",
      token: "token_123",
      cursor: "cursor-1",
    });
    expect(files.map((file) => file.metadata.pathname)).toEqual([
      "users/user_123/newest.txt",
      "users/user_123/middle.txt",
      "users/user_123/oldest.txt",
    ]);
  });

  it("throws when blob pagination response is malformed", async () => {
    listMock.mockResolvedValue({
      blobs: [],
      hasMore: true,
      cursor: undefined,
    });

    await expect(listUserFiles("user_123", "token_123")).rejects.toThrow(
      "Blob list pagination is invalid: hasMore=true without cursor",
    );
  });
});
