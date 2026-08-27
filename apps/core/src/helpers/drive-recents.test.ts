import { describe, expect, it } from "vitest";

import {
  compareDriveRecentsItems,
  decodeDriveRecentsCursor,
  encodeDriveRecentsCursor,
  isRecentsItemOlderThanCursor,
} from "@/helpers/drive-recents";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";

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
