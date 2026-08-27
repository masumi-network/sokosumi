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
}));

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
});

describe("drive recents cursor", () => {
  it("round-trips cursor payload", () => {
    const item = driveFile(
      "drive/users/u/report.pdf",
      "2026-08-20T10:00:00.000Z",
    );
    const encoded = encodeDriveRecentsCursor({
      lastItem: item,
      driveBlobCursor: "blob-cursor",
      taskFileCursor: "task-cursor",
    });

    const decoded = decodeDriveRecentsCursor(encoded);
    expect(decoded.lastItem?.kind).toBe("drive-file");
    expect(decoded.lastItem?.activityAt).toBe(item.activityAt);
    expect(decoded.driveBlobCursor).toBe("blob-cursor");
    expect(decoded.taskFileCursor).toBe("task-cursor");
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
      prefix: "drive/users/u/",
      token: "test-token",
      limit: 3,
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
      prefix: "drive/users/u/",
      token: "test-token",
      limit: 10,
      searchQuery: "report",
      fetchTaskOutputs,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe("drive-file");
    expect(page.items[0]?.name).toBe("report.pdf");
  });
});

function recentsItemKey(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") {
    return `drive-file:${item.name}`;
  }
  return `task-output:${item.taskFileId}`;
}
