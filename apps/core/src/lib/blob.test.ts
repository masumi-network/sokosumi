import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUserFileUploadSession,
  deleteCoworkerImageIfOwned,
  deleteTaskFileIfOwned,
  listUserUploads,
  uploadCoworkerImage,
  uploadGeneratedChatImage,
  uploadProfileImage,
  uploadTaskFile,
} from "./blob";

const {
  listMock,
  putMock,
  delMock,
  issueSignedTokenMock,
  presignUrlMock,
  getEnvMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
  delMock: vi.fn(),
  issueSignedTokenMock: vi.fn(),
  presignUrlMock: vi.fn(),
  getEnvMock: vi.fn(() => ({})),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@vercel/blob", () => ({
  put: putMock,
  list: listMock,
  del: delMock,
  issueSignedToken: issueSignedTokenMock,
  presignUrl: presignUrlMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

describe("createUserFileUploadSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a scoped direct upload session for the user file path", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=1",
    });

    const result = await createUserFileUploadSession(
      "user_123",
      {
        filename: " ../my file(1).pdf ",
        contentType: "application/pdf",
        size: 2_048_000,
        maxSizeBytes: 262_144_000,
      },
      "token_123",
    );

    expect(issueSignedTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "token_123",
        pathname: "users/user_123/my_file1.pdf",
        operations: ["put"],
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 2_048_000,
      }),
    );
    expect(result).toEqual({
      uploadUrl: "https://blob.example/upload?sig=1",
      access: "public",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      pathname: "users/user_123/my_file1.pdf",
      addRandomSuffix: true,
      maxSizeBytes: 262_144_000,
      expiresAt: expect.any(String),
    });
  });

  it("uses explicit allowedContentTypes when provided", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=2",
    });

    await createUserFileUploadSession(
      "user_123",
      {
        filename: "logo.png",
        contentType: "image/png",
        size: 500,
        maxSizeBytes: 2_097_152,
        allowedContentTypes: ["image/png", "image/jpeg"],
      },
      "token_123",
    );

    expect(issueSignedTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["image/png", "image/jpeg"],
        maximumSizeInBytes: 500,
      }),
    );
  });
});

describe("listUserUploads", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("lists uploads by user prefix and sorts newest first", async () => {
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

    const files = await listUserUploads("user_123", "token_123");

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

    const files = await listUserUploads("user_123", "token_123");

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

    await expect(listUserUploads("user_123", "token_123")).rejects.toThrow(
      "Blob list pagination is invalid: hasMore=true without cursor",
    );
  });
});

describe("uploadProfileImage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("sends a canonical lowercase image contentType for case-variant data URIs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/profile-hash.png",
    });

    const dataUrl = `Data:Image/PNG;Base64,${Buffer.from("hello").toString("base64")}`;
    const url = await uploadProfileImage(dataUrl);

    expect(url).toBe("https://blob.example/profile-hash.png");
    expect(putMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ contentType: "image/png" }),
    );
  });
});

describe("uploadGeneratedChatImage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("accepts case-variant scheme, subtype, and base64 keyword in data URIs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/generated.png",
    });

    const dataUrl = `Data:Image/PNG;Base64,${Buffer.from("hello").toString("base64")}`;
    const result = await uploadGeneratedChatImage({
      dataUrl,
      userId: "user_1",
      conversationId: "conv_1",
    });

    expect(result?.mediaType).toBe("image/png");
    expect(result?.url).toBe("https://blob.example/generated.png");
  });

  it("uses a .svg file extension for SVG data URLs (not .svg+xml)", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/generated.svg",
    });

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    const result = await uploadGeneratedChatImage({
      dataUrl,
      userId: "user_1",
      conversationId: "conv_1",
    });

    expect(result?.mediaType).toBe("image/svg+xml");
    expect(result?.filename).toMatch(/^generated-[a-f0-9]+\.svg$/);
    const pathnameArg = putMock.mock.calls[0]?.[0];
    expect(pathnameArg).toMatch(/\.svg$/);
    expect(pathnameArg).not.toContain("svg+xml");
    expect(putMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ contentType: "image/svg+xml" }),
    );
  });
});

describe("uploadCoworkerImage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("uploads under the coworker prefix with a random suffix", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/coworkers/cow-1/image-logo-xyz.png",
    });

    const url = await uploadCoworkerImage({
      coworkerId: "cow-1",
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
      filename: "logo.png",
    });

    expect(url).toBe("https://blob.example/coworkers/cow-1/image-logo-xyz.png");
    expect(putMock).toHaveBeenCalledWith(
      "coworkers/cow-1/image-logo.png",
      Buffer.from("png-bytes"),
      expect.objectContaining({
        access: "public",
        contentType: "image/png",
        token: "rw_token",
        addRandomSuffix: true,
      }),
    );
  });

  it("uses the content-type extension when the filename extension differs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/coworkers/cow-1/image-logo-xyz.png",
    });

    await uploadCoworkerImage({
      coworkerId: "cow-1",
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
      filename: "logo.jpg",
    });

    expect(putMock).toHaveBeenCalledWith(
      "coworkers/cow-1/image-logo.png",
      Buffer.from("png-bytes"),
      expect.objectContaining({ contentType: "image/png" }),
    );
  });

  it("returns null when blob storage is not configured", async () => {
    getEnvMock.mockReturnValue({});

    await expect(
      uploadCoworkerImage({
        coworkerId: "cow-1",
        bytes: Buffer.from("png-bytes"),
        contentType: "image/png",
        filename: "logo.png",
      }),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("deleteCoworkerImageIfOwned", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("deletes owned coworker image URLs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    delMock.mockResolvedValue(undefined);

    const url =
      "https://abc.public.blob.vercel-storage.com/coworkers/cow-1/image-logo-xyz.png";

    await deleteCoworkerImageIfOwned(url, "cow-1");

    expect(delMock).toHaveBeenCalledWith(url, { token: "rw_token" });
  });

  it("ignores foreign or invalid URLs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });

    await deleteCoworkerImageIfOwned("https://example.com/evil.png", "cow-1");
    await deleteCoworkerImageIfOwned(
      "https://abc.public.blob.vercel-storage.com/coworkers/other/image.png",
      "cow-1",
    );
    await deleteCoworkerImageIfOwned(
      "https://abc.public.blob.vercel-storage.com/orchestrators/cow-1/image.png",
      "cow-1",
    );
    await deleteCoworkerImageIfOwned(null, "cow-1");

    expect(delMock).not.toHaveBeenCalled();
  });

  it("captures delete failures without throwing", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    delMock.mockRejectedValue(new Error("blob delete failed"));

    const url =
      "https://abc.public.blob.vercel-storage.com/coworkers/cow-1/image-logo-xyz.png";

    await expect(
      deleteCoworkerImageIfOwned(url, "cow-1"),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

describe("uploadTaskFile", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("uploads under the task prefix with a random suffix", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    putMock.mockResolvedValue({
      url: "https://blob.example/tasks/tsk_123/report-xyz.pdf",
    });

    const url = await uploadTaskFile({
      taskId: "tsk_123",
      bytes: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: " my report.pdf ",
    });

    expect(url).toBe("https://blob.example/tasks/tsk_123/report-xyz.pdf");
    expect(putMock).toHaveBeenCalledWith(
      "tasks/tsk_123/my_report.pdf",
      Buffer.from("%PDF"),
      expect.objectContaining({
        access: "public",
        contentType: "application/pdf",
        token: "rw_token",
        addRandomSuffix: true,
      }),
    );
  });

  it("returns null when blob storage is not configured", async () => {
    getEnvMock.mockReturnValue({});

    await expect(
      uploadTaskFile({
        taskId: "tsk_123",
        bytes: Buffer.from("%PDF"),
        contentType: "application/pdf",
        filename: "report.pdf",
      }),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("deleteTaskFileIfOwned", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("deletes owned task file URLs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    delMock.mockResolvedValue(undefined);

    const url =
      "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";

    await deleteTaskFileIfOwned(url, "tsk_123");

    expect(delMock).toHaveBeenCalledWith(url, { token: "rw_token" });
  });

  it("ignores foreign or invalid URLs", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });

    await deleteTaskFileIfOwned("https://example.com/evil.pdf", "tsk_123");
    await deleteTaskFileIfOwned(
      "https://abc.public.blob.vercel-storage.com/tasks/other/report.pdf",
      "tsk_123",
    );
    await deleteTaskFileIfOwned(null, "tsk_123");

    expect(delMock).not.toHaveBeenCalled();
  });

  it("captures delete failures without throwing", async () => {
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "rw_token" });
    delMock.mockRejectedValue(new Error("blob delete failed"));

    const url =
      "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";

    await expect(
      deleteTaskFileIfOwned(url, "tsk_123"),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
