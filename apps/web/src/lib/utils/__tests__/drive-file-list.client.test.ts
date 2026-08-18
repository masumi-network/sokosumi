import { beforeEach, describe, expect, it, vi } from "vitest";

const getDriveFilesMock = vi.fn();
const getBrowserCoreClientMock = vi.fn(() => ({ id: "browser-core-client" }));

vi.mock("@/lib/clients/generated/core", () => ({
  getDriveFiles: (...args: unknown[]) => getDriveFilesMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => getBrowserCoreClientMock(),
}));

import {
  DRIVE_FILES_MAX_PAGES,
  DRIVE_FILES_PAGE_LIMIT,
  listDriveFiles,
} from "@/lib/utils/drive-file-list.client";

function driveFile(name: string) {
  return {
    name,
    fileUrl: `https://blob.example/${name}`,
    pathname: `drive/users/user_123/${name}`,
    size: 10,
    uploadedAt: "2026-08-18T10:00:00.000Z",
  };
}

function pageResponse(
  files: ReturnType<typeof driveFile>[],
  nextCursor: string | null,
) {
  return {
    data: {
      data: files,
      meta: {
        pagination: {
          cursor: null,
          limit: DRIVE_FILES_PAGE_LIMIT,
          nextCursor,
        },
      },
    },
  };
}

describe("listDriveFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a single page when nextCursor is null", async () => {
    getDriveFilesMock.mockResolvedValue(
      pageResponse([driveFile("a.pdf")], null),
    );

    await expect(listDriveFiles({ scope: "me" })).resolves.toEqual([
      driveFile("a.pdf"),
    ]);

    expect(getDriveFilesMock).toHaveBeenCalledTimes(1);
    expect(getDriveFilesMock).toHaveBeenCalledWith({
      client: { id: "browser-core-client" },
      query: {
        scope: "me",
        limit: DRIVE_FILES_PAGE_LIMIT,
      },
      throwOnError: true,
    });
  });

  it("walks nextCursor until the last page", async () => {
    getDriveFilesMock
      .mockResolvedValueOnce(pageResponse([driveFile("a.pdf")], "cursor-2"))
      .mockResolvedValueOnce(pageResponse([driveFile("b.pdf")], null));

    await expect(listDriveFiles({ scope: "me" })).resolves.toEqual([
      driveFile("a.pdf"),
      driveFile("b.pdf"),
    ]);

    expect(getDriveFilesMock).toHaveBeenNthCalledWith(2, {
      client: { id: "browser-core-client" },
      query: {
        scope: "me",
        limit: DRIVE_FILES_PAGE_LIMIT,
        cursor: "cursor-2",
      },
      throwOnError: true,
    });
  });

  it("passes organizationId for org scope", async () => {
    getDriveFilesMock.mockResolvedValue(pageResponse([], null));

    await listDriveFiles({ scope: "org", organizationId: "org_123" });

    expect(getDriveFilesMock).toHaveBeenCalledWith({
      client: { id: "browser-core-client" },
      query: {
        scope: "org",
        organizationId: "org_123",
        limit: DRIVE_FILES_PAGE_LIMIT,
      },
      throwOnError: true,
    });
  });

  it("stops after DRIVE_FILES_MAX_PAGES when nextCursor never ends", async () => {
    getDriveFilesMock.mockImplementation(
      async (options: { query: { cursor?: string } }) => {
        const page = options.query.cursor ?? "start";
        return pageResponse([driveFile(`${page}.pdf`)], `next-${page}`);
      },
    );

    const files = await listDriveFiles({ scope: "me" });

    expect(files).toHaveLength(DRIVE_FILES_MAX_PAGES);
    expect(getDriveFilesMock).toHaveBeenCalledTimes(DRIVE_FILES_MAX_PAGES);
  });

  it("throws when Core returns an error envelope", async () => {
    getDriveFilesMock.mockResolvedValue({
      error: { message: "Forbidden" },
    });

    await expect(listDriveFiles({ scope: "me" })).rejects.toThrow("Forbidden");
  });

  it("propagates SDK throws from throwOnError", async () => {
    getDriveFilesMock.mockRejectedValue(new Error("Unauthorized"));

    await expect(listDriveFiles({ scope: "me" })).rejects.toThrow(
      "Unauthorized",
    );
  });
});
