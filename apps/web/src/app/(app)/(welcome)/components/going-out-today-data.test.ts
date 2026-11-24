import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getWorkspaceCalendar = vi.fn();
const isNewsletterEnabled = vi.fn();

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (...args: unknown[]) => getWorkspaceCalendar(...args),
  },
}));
vi.mock("@/lib/newsletter-access.server", () => ({
  isNewsletterEnabled: () => isNewsletterEnabled(),
}));

import { expectConsole } from "@sokosumi/utils/test-console";
import {
  GOING_OUT_LIMIT,
  goingOutRow,
  loadGoingOutToday,
} from "./going-out-today-data";

const at = new Date("2026-11-24T09:30:00Z");

function entry(fields: Record<string, unknown>): WorkspaceCalendarEntry {
  // Only the fields Going out today reads.
  return { scheduledAt: at, ...fields } as WorkspaceCalendarEntry;
}

describe("goingOutRow", () => {
  it("opens a Social post's preview in its Project, with its own status", () => {
    expect(
      goingOutRow(
        entry({
          kind: "socialPost",
          id: "c1",
          postId: "p1",
          sourceProjectId: "proj",
          text: "Launch day",
          status: "NEEDS_APPROVAL",
          provider: "linkedin",
        }),
      ),
    ).toEqual({
      id: "c1",
      kind: "social",
      at,
      title: "Launch day",
      status: "NEEDS_APPROVAL",
      href: "/social?projectId=proj&postId=p1",
    });
  });

  it("opens a newsletter issue in its Project", () => {
    expect(
      goingOutRow(
        entry({
          kind: "newsletterIssue",
          id: "c2",
          issueId: "i1",
          sourceProjectId: "proj",
          subject: "November news",
          status: "SCHEDULED",
        }),
      ),
    ).toMatchObject({
      kind: "newsletter",
      title: "November news",
      status: "SCHEDULED",
      href: "/newsletter/issues/i1?projectId=proj",
    });
  });

  it("opens a released run's Task, with the Task's status", () => {
    expect(
      goingOutRow(
        entry({
          kind: "RUN_AT",
          id: "c3",
          taskId: "t1",
          scheduleId: null,
          taskName: "Weekly report",
          taskStatus: "QUEUED",
          state: "RELEASED",
        }),
      ),
    ).toMatchObject({
      kind: "task",
      title: "Weekly report",
      status: "QUEUED",
      href: "/tasks/t1",
    });
  });

  it("opens a planned run's Schedule, as planned", () => {
    expect(
      goingOutRow(
        entry({
          kind: "RUN",
          id: "c4",
          taskId: null,
          scheduleId: "s1",
          taskName: "Daily digest",
          taskStatus: null,
          state: "PLANNED",
        }),
      ),
    ).toMatchObject({
      kind: "task",
      status: "PLANNED",
      href: "/schedules/s1",
    });
  });

  it("skips kinds that do not go out", () => {
    expect(
      goingOutRow(entry({ kind: "contactFollowUp", id: "c5" })),
    ).toBeNull();
  });
});

describe("loadGoingOutToday", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks the Calendar for today's posts, issues and runs in the reader's zone", async () => {
    isNewsletterEnabled.mockResolvedValue(true);
    getWorkspaceCalendar.mockResolvedValue({
      items: [
        entry({
          kind: "socialPost",
          id: "c1",
          postId: "p1",
          sourceProjectId: "proj",
          text: "Launch day",
          status: "SCHEDULED",
        }),
      ],
      pagination: { total: 8, nextCursor: "x", cursor: null, limit: 5 },
    });

    const page = await loadGoingOutToday({
      today: "2026-11-24",
      timeZone: "Europe/Berlin",
      scope: "workspace",
    });

    expect(page).toMatchObject({
      total: 8,
      rows: [{ id: "c1" }],
      // The Calendar opens on the same day, scope and kinds the list counts.
      calendarHref:
        "/calendar?types=tasks%2Csocial%2Cnewsletter&date=2026-11-24&scope=workspace&view=week",
    });
    expect(getWorkspaceCalendar).toHaveBeenCalledWith({
      from: new Date("2026-11-23T23:00:00Z"),
      to: new Date("2026-11-24T23:00:00Z"),
      types: "tasks,social,newsletter",
      timeZone: "Europe/Berlin",
      scope: "workspace",
      limit: GOING_OUT_LIMIT,
    });
  });

  it("leaves newsletters out where the workspace has none", async () => {
    isNewsletterEnabled.mockResolvedValue(false);
    getWorkspaceCalendar.mockResolvedValue({ items: [], pagination: null });

    await expect(
      loadGoingOutToday({
        today: "2026-11-24",
        timeZone: "UTC",
        scope: "owned",
      }),
    ).resolves.toEqual({
      rows: [],
      total: 0,
      calendarHref:
        "/calendar?types=tasks%2Csocial&date=2026-11-24&scope=owned&view=week",
    });
    expect(getWorkspaceCalendar.mock.calls[0]?.[0]).toMatchObject({
      types: "tasks,social",
    });
  });

  it("ends the day at the next midnight, even when today's midnight was skipped", async () => {
    // Havana springs forward at midnight on 2026-03-08: the day starts at
    // 01:00 local and still ends at midnight before March 9.
    isNewsletterEnabled.mockResolvedValue(false);
    getWorkspaceCalendar.mockResolvedValue({ items: [], pagination: null });

    await loadGoingOutToday({
      today: "2026-03-08",
      timeZone: "America/Havana",
      scope: "owned",
    });

    expect(getWorkspaceCalendar.mock.calls[0]?.[0]).toMatchObject({
      from: new Date("2026-03-08T05:00:00Z"),
      to: new Date("2026-03-09T04:00:00Z"),
    });
  });

  it("is null when Core fails, so Home stays up", async () => {
    isNewsletterEnabled.mockResolvedValue(false);
    getWorkspaceCalendar.mockRejectedValue(new Error("down"));
    expectConsole("warn", "Going out today failed");

    await expect(
      loadGoingOutToday({
        today: "2026-11-24",
        timeZone: "UTC",
        scope: "owned",
      }),
    ).resolves.toBeNull();
  });
});
