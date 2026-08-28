import { describe, expect, it } from "vitest";

import { buildDriveRecentsDayGroups } from "@/app/drive/components/drive-recents-list.utils";
import type { DriveRecentsItem } from "@/lib/clients/generated/core";

function driveFile(activityAt: string, pathname: string): DriveRecentsItem {
  return {
    kind: "drive-file",
    name: pathname.split("/").pop() ?? pathname,
    fileUrl: `https://example.com/${pathname}`,
    pathname,
    size: 100,
    activityAt: new Date(activityAt),
  };
}

describe("buildDriveRecentsDayGroups", () => {
  it("groups recents by humanized day key", () => {
    const newer = driveFile(
      "2026-02-13T08:00:00.000Z",
      "drive/users/u/today.pdf",
    );
    const older = driveFile(
      "2026-02-12T08:00:00.000Z",
      "drive/users/u/yesterday.pdf",
    );

    const groups = buildDriveRecentsDayGroups([older, newer], "en");

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(
      groups.some((group) =>
        group.items.some(
          (item) =>
            item.kind === "drive-file" && item.pathname.endsWith("today.pdf"),
        ),
      ),
    ).toBe(true);
    expect(
      groups.some((group) =>
        group.items.some(
          (item) =>
            item.kind === "drive-file" &&
            item.pathname.endsWith("yesterday.pdf"),
        ),
      ),
    ).toBe(true);
  });
});
