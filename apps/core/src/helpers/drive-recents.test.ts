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
const headMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => ({
  list: listMock,
  head: headMock,
}));

const CURSOR_SECRET = "test-cursor-secret";
const PREFIX = "drive/users/u/";
const CURSOR_BINDING = { prefix: PREFIX, searchQuery: "" };

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

function fetchTaskOutputsByIds(
  rows: DriveTaskOutputRecentsRow[],
): (ids: string[]) => Promise<DriveTaskOutputRecentsRow[]> {
  return async (ids) => rows.filter((row) => ids.includes(row.id));
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
});

describe("drive recents cursor", () => {
  it("round-trips signed cursor payload", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      driveBlobCursor: "blob-cursor",
      taskFileCursor: "task-cursor",
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });

    const decoded = decodeDriveRecentsCursor(encoded, {
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });
    expect(decoded.lastItem?.kind).toBe("drive-file");
    expect(decoded.lastItem?.activityAt).toBe(item.activityAt);
    expect(decoded.driveBlobCursor).toBe("blob-cursor");
    expect(decoded.taskFileCursor).toBe("task-cursor");
    expect(decoded.pendingRefs).toEqual([]);
  });

  it("round-trips pending refs without embedding full records", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const pendingPath = "drive/users/u/older.pdf";
    const pending = driveFile(pendingPath, "2026-08-19T10:00:00.000Z");
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      driveBlobCursor: "blob-cursor",
      taskFileCursor: null,
      pendingRefs: [
        {
          kind: "drive-file",
          id: pendingPath,
          activityAt: pending.activityAt,
        },
      ],
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });

    expect(encoded.length).toBeLessThan(2048);

    const decoded = decodeDriveRecentsCursor(encoded, {
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });
    expect(decoded.pendingRefs).toEqual([
      {
        kind: "drive-file",
        id: pendingPath,
        activityAt: pending.activityAt,
      },
    ]);
  });

  it("rejects cursors signed for a different workspace prefix", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      driveBlobCursor: null,
      taskFileCursor: null,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
    });

    expect(() =>
      decodeDriveRecentsCursor(encoded, {
        cursorSecret: CURSOR_SECRET,
        cursorBinding: {
          prefix: "drive/users/other/",
          searchQuery: "",
        },
      }),
    ).toThrow("Invalid pagination cursor");
  });

  it("rejects legacy cursors that embed pendingItems records", () => {
    const legacyPayload = Buffer.from(
      JSON.stringify({
        payload: JSON.stringify({
          v: 2,
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
    headMock.mockReset();
    headMock.mockImplementation(async (pathname: string) => ({
      url: `https://blob.example/${pathname}`,
      pathname,
      size: 100,
      uploadedAt: new Date("2026-08-19T10:00:00.000Z"),
    }));
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
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
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
      cursorBinding: { prefix: PREFIX, searchQuery: "report" },
      fetchTaskOutputs,
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe("drive-file");
    expect(page.items[0]?.name).toBe("report.pdf");
  });

  it("preserves buffered eligible items across paginated pages", async () => {
    let drivePage = 0;
    listMock.mockImplementation(async () => {
      drivePage += 1;
      if (drivePage === 1) {
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
      }
      if (drivePage === 2) {
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
    });

    headMock.mockImplementation(async (pathname: string) => {
      const uploadedAtByPath: Record<string, string> = {
        "drive/users/u/b-mid.pdf": "2026-08-20T12:00:00.000Z",
        "drive/users/u/c-old.pdf": "2026-08-18T12:00:00.000Z",
      };
      return {
        url: `https://blob.example/${pathname}`,
        pathname,
        size: 100,
        uploadedAt: new Date(
          uploadedAtByPath[pathname] ?? "2026-08-19T10:00:00.000Z",
        ),
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
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.name).toBe("a-new.pdf");
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.nextCursor?.length).toBeLessThan(2048);

    const secondPage = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.name).toBe("b-mid.pdf");
    expect(secondPage.hasMore).toBe(true);

    const thirdPage = await fetchDriveRecentsPage({
      prefix: PREFIX,
      token: "test-token",
      limit: 1,
      cursor: secondPage.nextCursor ?? undefined,
      cursorSecret: CURSOR_SECRET,
      cursorBinding: CURSOR_BINDING,
      fetchTaskOutputs,
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
    });

    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.items[0]?.name).toBe("c-old.pdf");
    expect(thirdPage.hasMore).toBe(false);
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
      cursorBinding: { prefix: PREFIX, searchQuery: "pdf" },
      fetchTaskOutputs,
      fetchTaskOutputsByIds: fetchTaskOutputsByIds([]),
    });

    expect(page.items.map((item) => item.name)).toEqual([
      "zzz-newest.pdf",
      "aac-mid.pdf",
    ]);
    expect(drivePage).toBe(3);
  });
});

function recentsItemKey(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") {
    return `drive-file:${item.name}`;
  }
  return `task-output:${item.taskFileId}`;
}
