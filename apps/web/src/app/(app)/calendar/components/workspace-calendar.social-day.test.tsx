import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialComposeProvider } from "@/app/social/components/social-compose-context";
import { composeSlotForDay } from "./social-calendar-day";
import { WorkspaceCalendar } from "./workspace-calendar";

/**
 * Social's day grid, drawn by the real FullCalendar: a busy day folds into
 * "+N more", and every day still to come offers a "+" that opens the
 * composer on that day.
 */

vi.mock("@/lib/ably/calendar-realtime-bridge", () => ({
  CalendarRealtimeBridge: () => null,
}));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useLocale: () => "en",
    useTranslations:
      () => (key: string, values?: Record<string, string | number>) =>
        values && ("date" in values || "count" in values || "week" in values)
          ? `${key}:${values.date ?? values.count ?? values.week}`
          : key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: vi.fn(),
    getWorkspaceCalendar: vi.fn(),
  },
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => <div data-testid="calendar-filters" />,
}));

const POST: SocialPostCalendarItem = {
  kind: "socialPost",
  revision: 1,
  id: "social:post-1",
  postId: "post-1",
  provider: "x",
  text: "Launch news",
  status: "SCHEDULED",
  externalHandle: "team",
  avatarUrl: null,
  projectName: "Release planning",
  scheduledByName: "Ada",
  scheduledByImage: null,
  attachmentCount: 0,
  previewMedia: null,
  threadPartCount: 1,
  publishedThreadPartCount: 0,
  failedThreadPartPosition: null,
  partiallyPublished: false,
  scheduledAt: new Date("2030-01-16T09:00:00.000Z"),
  lastAttempt: null,
  sourceId: "project:project-1",
  sourceProjectId: "project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
};

function busyDay(count: number): SocialPostCalendarItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...POST,
    id: `social:post-${index}`,
    postId: `post-${index}`,
    text: `Post ${index}`,
    scheduledAt: new Date(`2030-01-16T${10 + index}:00:00.000Z`),
  }));
}

function renderSocialCalendar({
  items = [POST],
  searchParams,
  onUrlUpdate,
  compose = true,
}: {
  items?: SocialPostCalendarItem[];
  searchParams: string;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
  compose?: boolean;
}) {
  const calendar = (
    <WorkspaceCalendar
      includeSocialPosts
      initialDate="2030-01-16"
      items={items}
      lockedProjectId="project-1"
      socialPostsOnly
    />
  );
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      {compose ? (
        <SocialComposeProvider>{calendar}</SocialComposeProvider>
      ) : (
        calendar
      )}
    </NuqsTestingAdapter>,
  );
}

describe("Social calendar days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("folds a busy month day into three chips and a +N more", () => {
    renderSocialCalendar({
      items: busyDay(5),
      searchParams: "?timezone=UTC&view=month&date=2030-01-16",
    });

    expect(screen.getAllByTestId("calendar-social-post")).toHaveLength(3);
    expect(screen.getByText("socialPost.more:2")).toBeInTheDocument();
  });

  it("numbers each month row by the ISO week of its Monday", () => {
    renderSocialCalendar({
      searchParams: "?timezone=UTC&view=month&date=2027-01-16",
    });

    // The grid starts its rows on Sunday. Sun Dec 27 2026's row is ISO week
    // 53 (its Monday is Dec 28); Sun Jan 3 2027's row is week 1.
    const numbers = screen.getAllByTestId("calendar-week-number");
    expect(numbers.map((number) => number.textContent)).toEqual([
      "53",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    for (const number of numbers) {
      expect(number).toHaveAttribute("aria-hidden", "true");
    }
    // The row, not the decorative number, carries the localised name.
    expect(
      screen.getByRole("row", { name: "weekNumber:53" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: "weekNumber:1" })).getByText("1", {
        selector: "[data-testid=calendar-week-number]",
      }),
    ).toBeInTheDocument();
  });

  it("draws today as a circle behind its day number, top-left", () => {
    vi.useFakeTimers({
      now: new Date("2030-01-16T12:00:00.000Z"),
      toFake: ["Date"],
    });
    try {
      renderSocialCalendar({
        searchParams: "?timezone=UTC&view=month&date=2030-01-16",
      });
      const today = document.querySelector('[data-date="2030-01-16"]');
      expect(today).toHaveAttribute("aria-current", "date");
      expect(within(today as HTMLElement).getByText("16")).toHaveClass(
        "rounded-full",
        "bg-primary",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["UTC", "2030-01-16T09:00:00.000Z"],
    ["Pacific/Auckland", "2030-01-15T20:00:00.000Z"],
    ["America/Los_Angeles", "2030-01-16T17:00:00.000Z"],
  ])(
    "opens the composer on 09:00 of the day whose + was pressed, in %s",
    async (timeZone, instant) => {
      const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
      renderSocialCalendar({
        searchParams: `?timezone=${timeZone}&view=month&date=2030-01-16`,
        onUrlUpdate,
      });

      fireEvent.click(screen.getByRole("button", { name: "newOnDay:Jan 16" }));

      // The composer reads its slot on the viewer's clock; the instant is
      // 09:00 on the calendar's.
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
      const composeAt = new URLSearchParams(
        onUrlUpdate.mock.lastCall?.[0].queryString,
      ).get("composeAt");
      expect(new Date(composeAt ?? "").toISOString()).toBe(instant);
    },
  );

  it("offers a + on each day of the week in its header", () => {
    renderSocialCalendar({
      searchParams: "?timezone=UTC&view=week&date=2030-01-16",
    });

    const adds = screen.getAllByTestId("calendar-day-add");
    expect(adds).toHaveLength(7);
    expect(adds[0]).toHaveAccessibleName("newOnDay:Jan 13");
    const header = screen.getAllByRole("columnheader")[3];
    expect(
      within(header).getByRole("button", {
        name: "newOnDay:Jan 16",
      }),
    ).toBeInTheDocument();
  });

  it("offers no + where there is no composer to open", () => {
    renderSocialCalendar({
      compose: false,
      searchParams: "?timezone=UTC&view=month&date=2030-01-16",
    });

    expect(screen.queryByTestId("calendar-day-add")).not.toBeInTheDocument();
  });

  it("marks a movable chip and tells assistive tech it can be dragged", () => {
    renderSocialCalendar({
      items: [POST, { ...POST, id: "social:done", status: "PUBLISHED" }],
      searchParams: "?timezone=UTC&view=week&date=2030-01-16",
    });

    const [scheduled, published] = screen.getAllByTestId(
      "calendar-social-post",
    );
    expect(scheduled).toHaveAttribute("data-movable", "true");
    expect(scheduled).toHaveAccessibleDescription("dragHint");
    expect(published).not.toHaveAttribute("data-movable");
    expect(published).not.toHaveAccessibleDescription();
    // Only the movable post offers the keyboard and touch way to move it.
    expect(
      screen.getAllByTestId("calendar-social-post-reschedule"),
    ).toHaveLength(1);
  });

  it("leaves the project off the chips of one project's calendar", () => {
    renderSocialCalendar({
      searchParams: "?timezone=UTC&view=week&date=2030-01-16",
    });

    const chip = screen.getByTestId("calendar-social-post");
    expect(chip).toHaveTextContent("Launch news");
    expect(chip).not.toHaveTextContent("Release planning");
  });
});

describe("composeSlotForDay", () => {
  const now = new Date("2030-01-16T10:20:00.000Z");
  /** The slot as an instant: the composer parses it on the viewer's clock. */
  const slot = (dayKey: string, timeZone: string, at = now) =>
    new Date(composeSlotForDay(dayKey, timeZone, at)).toISOString();

  it("starts a later day at nine in the calendar's zone", () => {
    expect(slot("2030-01-17", "UTC")).toBe("2030-01-17T09:00:00.000Z");
    expect(slot("2030-01-17", "Europe/Prague")).toBe(
      "2030-01-17T08:00:00.000Z",
    );
  });

  it("starts today on the next whole hour at least 15 minutes out", () => {
    expect(slot("2030-01-16", "UTC")).toBe("2030-01-16T11:00:00.000Z");
    expect(
      slot("2030-01-16", "UTC", new Date("2030-01-16T10:50:00.000Z")),
    ).toBe("2030-01-16T12:00:00.000Z");
  });

  it("rounds to a whole hour on the calendar's clock, not the viewer's", () => {
    // 15:50 in Kolkata (UTC+5:30): the next whole hour there is 17:00.
    expect(slot("2030-01-16", "Asia/Kolkata")).toBe("2030-01-16T11:30:00.000Z");
  });
});
