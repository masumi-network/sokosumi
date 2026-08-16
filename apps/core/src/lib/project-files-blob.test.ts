import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteProjectBlobs,
  ensureProjectFilesToken,
  generateProjectFilesToken,
  uploadProjectBriefingFile,
  uploadProjectContextMdFile,
} from "./project-files-blob";

const {
  captureExceptionMock,
  delMock,
  getEnvMock,
  listMock,
  projectFindUniqueMock,
  projectUpdateManyMock,
  putMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  delMock: vi.fn(),
  putMock: vi.fn(),
  getEnvMock: vi.fn((): { BLOB_READ_WRITE_TOKEN: string | undefined } => ({
    BLOB_READ_WRITE_TOKEN: "blob_token",
  })),
  listMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@vercel/blob", () => ({
  del: delMock,
  list: listMock,
  put: putMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findUnique: projectFindUniqueMock,
      updateMany: projectUpdateManyMock,
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

describe("project markdown blob uploads", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    listMock.mockResolvedValue({ blobs: [], hasMore: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob_token" });
  });

  it("uploads BRIEFING.md to its tokenized stable project path", async () => {
    putMock.mockResolvedValueOnce({ url: "https://blob.example/BRIEFING.md" });

    const url = await uploadProjectBriefingFile(
      "project_123",
      "secret_token",
      "# Briefing",
    );

    expect(putMock).toHaveBeenCalledWith(
      "projects/project_123/secret_token/BRIEFING.md",
      "# Briefing",
      {
        access: "public",
        contentType: "text/markdown; charset=utf-8",
        token: "blob_token",
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      },
    );
    expect(url).toBe("https://blob.example/BRIEFING.md");
  });

  it("uploads CONTEXT.md to its tokenized stable project path", async () => {
    putMock.mockResolvedValueOnce({ url: "https://blob.example/CONTEXT.md" });

    const url = await uploadProjectContextMdFile(
      "project_123",
      "secret_token",
      "# Context",
    );

    expect(putMock).toHaveBeenCalledWith(
      "projects/project_123/secret_token/CONTEXT.md",
      "# Context",
      expect.objectContaining({ cacheControlMaxAge: 60 }),
    );
    expect(url).toBe("https://blob.example/CONTEXT.md");
  });

  it("returns null and reports Blob failures", async () => {
    putMock.mockRejectedValueOnce(new Error("blob down"));

    await expect(
      uploadProjectBriefingFile("project_123", "secret_token", "# Briefing"),
    ).resolves.toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it("returns null when Blob storage is not configured", async () => {
    getEnvMock.mockReturnValueOnce({ BLOB_READ_WRITE_TOKEN: undefined });

    await expect(
      uploadProjectContextMdFile("project_123", "secret_token", "# Context"),
    ).resolves.toBeNull();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("generates 24 random bytes as base64url", () => {
    const filesToken = generateProjectFilesToken();

    expect(filesToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("claims a token once and reuses the winning token", async () => {
    projectUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    const claimedToken = await ensureProjectFilesToken("project_123", null);

    expect(claimedToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "project_123", filesToken: null },
      data: { filesToken: claimedToken },
    });

    projectUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    projectFindUniqueMock.mockResolvedValueOnce({ filesToken: "winner" });
    await expect(ensureProjectFilesToken("project_123", null)).resolves.toBe(
      "winner",
    );
  });

  it("deletes every project and DESIGN.md blob page by prefix", async () => {
    listMock
      .mockResolvedValueOnce({
        blobs: [{ url: "https://blob.example/briefing" }],
        hasMore: true,
        cursor: "next",
      })
      .mockResolvedValueOnce({
        blobs: [{ url: "https://blob.example/design" }],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        blobs: [{ url: "https://blob.example/context" }],
        hasMore: false,
      });

    await deleteProjectBlobs("project_123");

    expect(listMock).toHaveBeenCalledWith({
      prefix: "projects/project_123/",
      cursor: undefined,
      token: "blob_token",
    });
    expect(listMock).toHaveBeenCalledWith({
      prefix: "design-md/projects/project_123/",
      cursor: undefined,
      token: "blob_token",
    });
    expect(delMock).toHaveBeenCalledWith(["https://blob.example/briefing"], {
      token: "blob_token",
    });
    expect(delMock).toHaveBeenCalledWith(["https://blob.example/context"], {
      token: "blob_token",
    });
    expect(delMock).toHaveBeenCalledWith(["https://blob.example/design"], {
      token: "blob_token",
    });
  });

  it("contains project blob deletion failures", async () => {
    listMock.mockRejectedValue(new Error("blob list unavailable"));

    await expect(deleteProjectBlobs("project_123")).resolves.toBeUndefined();

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });
});
