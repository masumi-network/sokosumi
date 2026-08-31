import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  compareDriveRecentsItems,
  decodeDriveRecentsCursor,
  driveRecentsDriveFileNameMatchesSearch,
  encodeDriveRecentsCursor,
  fetchDriveRecentsPage,
  isRecentsItemOlderThanCursor,
} from "@/helpers/drive-recents";
import type { DriveTaskOutputRecentsRow } from "@/helpers/drive-task-output-catalog";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => ({
  list: listMock,
  head: vi.fn(),
}));

const CURSOR_SECRET = "test-cursor-secret";
const PREFIX = "drive/users/u/";
const CURSOR_BINDING = {
  prefix: PREFIX,
  searchQuery: "",
  sortFingerprint: "desc:none:asc",
};

function driveFile(pathname: string, activityAt: string): DriveRecentsItem {
  return {
    kind: "drive-file",
    name: pathname.split("/").pop() ?? pathname,
    fileUrl: `https://example.com/${pathname}`,
    pathname,
    size: 100,
    activityAt,
  };
}

function taskOutput(taskFileId: string, activityAt: string): DriveRecentsItem {
  return {
    kind: "task-output",
    name: "output.pdf",
    fileUrl: "https://example.com/output.pdf",
    size: 200,
    activityAt,
    taskFileId,
    taskId: "task-1",
    taskName: "Task",
    projectId: null,
    projectName: null,
  };
}

describe("driveRecentsDriveFileNameMatchesSearch", () => {
  it("matches case-insensitive substrings", () => {
    expect(driveRecentsDriveFileNameMatchesSearch("Report.pdf", "port")).toBe(
      true,
    );
    expect(driveRecentsDriveFileNameMatchesSearch("Report.pdf", "PORT")).toBe(
      true,
    );
    expect(
      driveRecentsDriveFileNameMatchesSearch("Report.pdf", "invoice"),
    ).toBe(false);
  });

  it("treats blank search as match-all", () => {
    expect(driveRecentsDriveFileNameMatchesSearch("Report.pdf", "  ")).toBe(
      true,
    );
  });
});

describe("compareDriveRecentsItems", () => {
  it("sorts by activityAt descending", () => {
    const newer = driveFile("drive/users/u/a.pdf", "2026-08-20T10:00:00.000Z");
    const older = driveFile("drive/users/u/b.pdf", "2026-08-19T10:00:00.000Z");

    expect(compareDriveRecentsItems(newer, older)).toBeLessThan(0);
    expect(compareDriveRecentsItems(older, newer)).toBeGreaterThan(0);
  });

  it("uses stable tie-breakers for equal timestamps", () => {
    const drive = driveFile("drive/users/u/a.pdf", "2026-08-20T10:00:00.000Z");
    const task = taskOutput("tf-1", "2026-08-20T10:00:00.000Z");

    expect(compareDriveRecentsItems(drive, task)).not.toBe(0);
    expect(compareDriveRecentsItems(task, drive)).not.toBe(0);
  });

  it("keeps activityAt primary when secondary is name", () => {
    const newerB = driveFile("drive/users/u/b.pdf", "2026-08-20T10:00:00.000Z");
    const olderA = driveFile("drive/users/u/a.pdf", "2026-08-19T10:00:00.000Z");

    expect(
      compareDriveRecentsItems(newerB, olderA, {
        activityOrder: "desc",
        secondary: "name",
        secondaryOrder: "asc",
      }),
    ).toBeLessThan(0);
  });

  it("applies name secondary within equal activityAt", () => {
    const a = driveFile("drive/users/u/a.pdf", "2026-08-20T10:00:00.000Z");
    const b = driveFile("drive/users/u/b.pdf", "2026-08-20T10:00:00.000Z");

    expect(
      compareDriveRecentsItems(a, b, {
        activityOrder: "desc",
        secondary: "name",
        secondaryOrder: "asc",
      }),
    ).toBeLessThan(0);
  });

  it("flips activityAt with sortOrder asc", () => {
    const newer = driveFile("drive/users/u/a.pdf", "2026-08-20T10:00:00.000Z");
    const older = driveFile("drive/users/u/b.pdf", "2026-08-19T10:00:00.000Z");

    expect(
      compareDriveRecentsItems(older, newer, {
        activityOrder: "asc",
        secondary: null,
        secondaryOrder: "asc",
      }),
    ).toBeLessThan(0);
  });
});

describe("drive recents cursor", () => {
  it("round-trips a compact signed cursor payload", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });

    expect(encoded.length).toBeLessThan(512);

    const decoded = decodeDriveRecentsCursor(encoded, {
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });
    expect(decoded.lastItem?.kind).toBe("drive-file");
    expect(decoded.lastItem?.activityAt).toBe(item.activityAt);
    if (decoded.lastItem?.kind === "drive-file") {
      expect(decoded.lastItem.pathname).toBe("drive/users/u/report.pdf");
    }
  });

  it("rejects cursors signed for a different workspace prefix", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });

    expect(() =>
      decodeDriveRecentsCursor(encoded, {
        cursorSecret: CURSOR_SECRET,
        cursorBinding: {
          prefix: "drive/users/other/",
          searchQuery: "",
          sortFingerprint: "desc:none:asc",
        },
      }),
    ).toThrow("Invalid pagination cursor");
  });

  it("rejects legacy cursors that embed pendingItems records", () => {
    const legacyPayload = Buffer.from(
      JSON.stringify({
        payload: JSON.stringify({
          v: 3,
          activityAt: "2026-08-20T10:00:00.000Z",
          kind: "drive-file",
          id: "drive/users/u/report.pdf",
          pendingItems: [
            driveFile("drive/users/u/older.pdf", "2026-08-19T10:00:00.000Z"),
          ],
        }),
        signature: "not-valid",
      }),
      "utf8",
    ).toString("base64url");

    expect(() =>
      decodeDriveRecentsCursor(legacyPayload, {
        cursorSecret: CURSOR_SECRET,
        cursorBinding: CURSOR_BINDING,
      }),
    ).toThrow("Invalid pagination cursor");
  });

  it("rejects legacy cursors that embed pendingRefs or source cursors", () => {
    const legacyPayload = Buffer.from(
      JSON.stringify({
        payload: JSON.stringify({
          v: 3,
          activityAt: "2026-08-20T10:00:00.000Z",
          kind: "drive-file",
          id: "drive/users/u/report.pdf",
          pendingRefs: [
            {
              kind: "drive-file",
              id: "drive/users/u/older.pdf",
              activityAt: "2026-08-19T10:00:00.000Z",
            },
          ],
          driveBlobCursor: "blob-cursor",
        }),
        signature: "not-valid",
      }),
      "utf8",
    ).toString("base64url");

    expect(() =>
      decodeDriveRecentsCursor(legacyPayload, {
        cursorSecret: CURSOR_SECRET,
        cursorBinding: CURSOR_BINDING,
      }),
    ).toThrow("Invalid pagination cursor");
  });

  it("detects items older than cursor position", () => {
    const cursorItem = driveFile(
      "drive/users/u/newest.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const older = driveFile(
      "drive/users/u/older.pdf",
      "2026-08-19T10:00:00.000Z",
    );

    expect(isRecentsItemOlderThanCursor(older, cursorItem)).toBe(true);
    expect(isRecentsItemOlderThanCursor(cursorItem, cursorItem)).toBe(false);
  });
});

describe("fetchDriveRecentsPage", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  function taskRow(id: string, updatedAt: string): DriveTaskOutputRecentsRow {
    return {
      id,
      name: "output.pdf",
      fileUrl: "https://example.com/output.pdf",
      size: 200,
      updatedAt: new Date(updatedAt),
      taskId: "task-1",
      taskName: "Task",
      projectId: null,
      projectName: null,
    };
  }

  it("keeps global recency order across multiple drive and task batches", async () => {
    let drivePage = 0;
    listMock.mockImplementation(async () => {
      drivePage += 1;
      if (drivePage === 1) {
        return {
          blobs: [
            {
              url: "https://blob.example/old-drive.pdf",
              pathname: "drive/users/u/old-drive.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
            },
          ],
          hasMore: true,
          cursor: "blob-page-2",
        };
      }

      return {
        blobs: [
          {
            url: "https://blob.example/new-drive.pdf",
            pathname: "drive/users/u/new-drive.pdf",
            size: 100,
            uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
          },
        ],
        hasMore: false,
      };
    });

    let taskPage = 0;
    const fetchTaskOutputs = vi.fn(
      async (): Promise<{
        rows: DriveTaskOutputRecentsRow[];
        hasMore: boolean;
        nextCursor: string | null;
      }> => {
        taskPage += 1;
        if (taskPage === 1) {
          return {
            rows: [taskRow("tf_mid", "2026-08-20T12:00:00.000Z")],
            hasMore: false,
            nextCursor: null,
          };
        }
        return { rows: [], hasMore: false, nextCursor: null };
      },
    );

    const page = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 3,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
    });

    expect(page.items.map((item) => recentsItemKey(item))).toEqual([
      "drive-file:new-drive.pdf",
      "task-output:tf_mid",
      "drive-file:old-drive.pdf",
    ]);
  });

  it("filters drive filenames in-memory while preserving recency order", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/report.pdf",
          pathname: "drive/users/u/report.pdf",
          size: 100,
          uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          url: "https://blob.example/notes.pdf",
          pathname: "drive/users/u/notes.pdf",
          size: 100,
          uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      ],
      hasMore: false,
    });

    const fetchTaskOutputs = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextCursor: null,
    }));

    const page = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 10,
      searchQuery: "report",
      cursorSecret: CURSOR_SECRET,
      cursorBinding: {
        prefix: PREFIX,
        searchQuery: "report",
        sortFingerprint: "desc:none:asc",
      },
      fetchTaskOutputs,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe("drive-file");
    expect(page.items[0]?.name).toBe("report.pdf");
  });

  it("paginates by re-scanning with a compact activity cursor", async () => {
    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor === "blob-page-2") {
        return {
          blobs: [
            {
              url: "https://blob.example/b-mid.pdf",
              pathname: "drive/users/u/b-mid.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
            },
          ],
          hasMore: true,
          cursor: "blob-page-3",
        };
      }
      if (options?.cursor === "blob-page-3") {
        return {
          blobs: [
            {
              url: "https://blob.example/a-new.pdf",
              pathname: "drive/users/u/a-new.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
            },
          ],
          hasMore: false,
        };
      }

      return {
        blobs: [
          {
            url: "https://blob.example/c-old.pdf",
            pathname: "drive/users/u/c-old.pdf",
            size: 100,
            uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
          },
        ],
        hasMore: true,
        cursor: "blob-page-2",
      };
    });

    const fetchTaskOutputs = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextCursor: null,
    }));

    const firstPage = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 1,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.name).toBe("a-new.pdf");
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.nextCursor?.length).toBeLessThan(512);

    const secondPage = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.name).toBe("b-mid.pdf");
    expect(secondPage.hasMore).toBe(true);
    expect(secondPage.nextCursor?.length).toBeLessThan(512);

    const thirdPage = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 1,
      cursor: secondPage.nextCursor ?? undefined,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
    });

    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.items[0]?.name).toBe("c-old.pdf");
    expect(thirdPage.hasMore).toBe(false);
  });

  it("keeps cursors compact across many pages without dropping items", async () => {
    const files = Array.from({ length: 155 }, (_, index) => {
      const rank = String(index).padStart(3, "0");
      return {
        url: `https://blob.example/f-${rank}.pdf`,
        pathname: `drive/users/u/f-${rank}.pdf`,
        size: 100,
        uploadedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      };
    });

    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor) {
        return {
          blobs: [],
          hasMore: false,
        };
      }

      return {
        blobs: files,
        hasMore: true,
        cursor: "blob-page-2",
      };
    });

    const fetchTaskOutputs = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextCursor: null,
    }));

    const limit = 50;
    const seenNames = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < 4; page += 1) {
      const pageResult = await fetchDriveRecentsPage({
        prefix: PREFIX,
        token: "test-token",
        limit,
        cursor,
        cursorSecret: CURSOR_SECRET,
        cursorBinding: CURSOR_BINDING,
        fetchTaskOutputs,
      });

      expect(pageResult.nextCursor?.length ?? 0).toBeLessThan(512);

      for (const item of pageResult.items) {
        seenNames.add(item.name);
      }

      if (!pageResult.hasMore) {
        expect(page).toBeGreaterThan(0);
        break;
      }

      cursor = pageResult.nextCursor ?? undefined;
    }

    expect(seenNames.size).toBe(155);
  });

  it("continues scanning blob pages when the newest match appears on page three", async () => {
    let drivePage = 0;
    listMock.mockImplementation(async () => {
      drivePage += 1;
      if (drivePage === 1) {
        return {
          blobs: [
            {
              url: "https://blob.example/aaa-old.pdf",
              pathname: "drive/users/u/aaa-old.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
            },
            {
              url: "https://blob.example/aab-old.pdf",
              pathname: "drive/users/u/aab-old.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-19T12:00:00.000Z"),
            },
          ],
          hasMore: true,
          cursor: "blob-page-2",
        };
      }
      if (drivePage === 2) {
        return {
          blobs: [
            {
              url: "https://blob.example/aac-mid.pdf",
              pathname: "drive/users/u/aac-mid.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
            },
          ],
          hasMore: true,
          cursor: "blob-page-3",
        };
      }

      return {
        blobs: [
          {
            url: "https://blob.example/zzz-newest.pdf",
            pathname: "drive/users/u/zzz-newest.pdf",
            size: 100,
            uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
          },
        ],
        hasMore: false,
      };
    });

    const fetchTaskOutputs = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextCursor: null,
    }));

    const page = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 2,
      searchQuery: "pdf",
      cursorSecret: CURSOR_SECRET,
      cursorBinding: {
        prefix: PREFIX,
        searchQuery: "pdf",
        sortFingerprint: "desc:none:asc",
      },
      fetchTaskOutputs,
    });

    expect(page.items.map((item) => item.name)).toEqual([
      "zzz-newest.pdf",
      "aac-mid.pdf",
    ]);
    expect(drivePage).toBe(3);
  });

  it("surfaces a newer blob past the old pending-ref cap on a later page", async () => {
    const olderFiles = Array.from({ length: 120 }, (_, index) => {
      const rank = String(index).padStart(3, "0");
      return {
        url: `https://blob.example/aaa-${rank}.pdf`,
        pathname: `drive/users/u/aaa-${rank}.pdf`,
        size: 100,
        uploadedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      };
    });

    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor === "blob-page-2") {
        return {
          blobs: [
            {
              url: "https://blob.example/zzz-newest.pdf",
              pathname: "drive/users/u/zzz-newest.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
            },
          ],
          hasMore: false,
        };
      }

      return {
        blobs: olderFiles,
        hasMore: true,
        cursor: "blob-page-2",
      };
    });

    const fetchTaskOutputs = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextCursor: null,
    }));

    const page = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 10,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
    });

    expect(page.items[0]?.name).toBe("zzz-newest.pdf");
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(page.nextCursor?.length).toBeLessThan(512);
  });
});

function recentsItemKey(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") {
    return `drive-file:${item.name}`;
  }
  return `task-output:${item.taskFileId}`;
}
