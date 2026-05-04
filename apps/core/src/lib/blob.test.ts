import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUserFileUploadSession,
  listUserUploads,
  uploadGeneratedChatImage,
} from "./blob";

const {
  listMock,
  putMock,
  generateClientTokenFromReadWriteTokenMock,
  getEnvMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
  generateClientTokenFromReadWriteTokenMock: vi.fn(),
  getEnvMock: vi.fn(() => ({})),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@vercel/blob", () => ({
  put: putMock,
  list: listMock,
}));

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken:
    generateClientTokenFromReadWriteTokenMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

describe("createUserFileUploadSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a scoped direct upload session for the user upload path", async () => {
    generateClientTokenFromReadWriteTokenMock.mockResolvedValue(
      "client-token-123",
    );

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

    expect(generateClientTokenFromReadWriteTokenMock).toHaveBeenCalledWith({
      token: "token_123",
      pathname: "users/user_123/my_file1.pdf",
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 2_048_000,
      validUntil: expect.any(Number),
      addRandomSuffix: true,
    });
    expect(result).toEqual({
      clientToken: "client-token-123",
      access: "public",
      pathname: "users/user_123/my_file1.pdf",
      addRandomSuffix: true,
      maxSizeBytes: 262_144_000,
    });
  });

  it("uses explicit allowedContentTypes when provided", async () => {
    generateClientTokenFromReadWriteTokenMock.mockResolvedValue(
      "client-token-456",
    );

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

    expect(generateClientTokenFromReadWriteTokenMock).toHaveBeenCalledWith(
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
