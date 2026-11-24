import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceCalendar = vi.fn();
const isNewsletterEnabled = vi.fn();

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (...args: unknown[]) => getWorkspaceCalendar(...args),
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace.split(".").at(-1)}.${key}`,
  getFormatter: async () => ({ dateTime: () => "10:30" }),
}));
vi.mock("@/lib/newsletter-access.server", () => ({
  isNewsletterEnabled: () => isNewsletterEnabled(),
}));

import { expectConsole } from "@sokosumi/utils/test-console";
import {
  GOING_OUT_LIMIT,
  type GoingOutPage,
  GoingOutToday,
  goingOutRow,
  loadGoingOutToday,
} from "./going-out-today";

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

    expect(page).toMatchObject({ total: 8, rows: [{ id: "c1" }] });
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
    ).resolves.toEqual({ rows: [], total: 0 });
    expect(getWorkspaceCalendar.mock.calls[0]?.[0]).toMatchObject({
      types: "tasks,social",
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

describe("GoingOutToday", () => {
  afterEach(() => cleanup());

  async function renderGoingOut(feed: GoingOutPage | null) {
    const { container } = render(
      await GoingOutToday({ feed: Promise.resolve(feed), today: "2026-11-24" }),
    );
    return container;
  }

  const page: GoingOutPage = {
    rows: [
      {
        id: "c1",
        kind: "social",
        at,
        title: "Launch day",
        status: "NEEDS_APPROVAL",
        href: "/social?projectId=proj&postId=p1",
      },
      {
        id: "c2",
        kind: "task",
        at,
        title: "Daily digest",
        status: "PLANNED",
        href: "/schedules/s1",
      },
    ],
    total: 2,
  };

  it("lists each row with its time, kind and own status, linking to it", async () => {
    await renderGoingOut(page);

    expect(
      screen.getByRole("heading", { name: "GoingOut.title" }),
    ).toBeTruthy();
    const post = screen.getByRole("link", { name: /Launch day/ });
    expect(post.getAttribute("href")).toBe("/social?projectId=proj&postId=p1");
    expect(post.textContent).toContain("10:30");
    expect(post.textContent).toContain("GoingOut.kinds.social");
    // Waiting for approval is said, not shown as going out for sure.
    expect(post.textContent).toContain("status.NEEDS_APPROVAL");
    expect(
      screen.getByRole("link", { name: /Daily digest/ }).textContent,
    ).toContain("GoingOut.planned");
  });

  it("links to the rest of the day on the Calendar", async () => {
    await renderGoingOut(page);

    expect(
      screen
        .getByRole("link", { name: "GoingOut.seeAll" })
        .getAttribute("href"),
    ).toBe("/calendar?date=2026-11-24&view=week");
  });

  it("renders nothing on a quiet day or when the read failed", async () => {
    expect((await renderGoingOut({ rows: [], total: 0 })).innerHTML).toBe("");
    expect((await renderGoingOut(null)).innerHTML).toBe("");
  });
});
