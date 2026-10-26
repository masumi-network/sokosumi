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
        values && ("date" in values || "count" in values)
          ? `${key}:${values.date ?? values.count}`
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

  it.each(["UTC", "Pacific/Auckland", "America/Los_Angeles"])(
    "opens the composer on the day whose + was pressed in %s",
    async (timeZone) => {
      const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
      renderSocialCalendar({
        searchParams: `?timezone=${timeZone}&view=month&date=2030-01-16`,
        onUrlUpdate,
      });

      fireEvent.click(screen.getByRole("button", { name: "newOnDay:Jan 16" }));

      await waitFor(() =>
        expect(onUrlUpdate).toHaveBeenLastCalledWith(
          expect.objectContaining({
            queryString: expect.stringContaining("composeAt=2030-01-16T09:00"),
          }),
        ),
      );
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
  });
});

describe("composeSlotForDay", () => {
  const now = new Date(2030, 0, 16, 10, 20);

  it("starts a later day at nine", () => {
    expect(composeSlotForDay("2030-01-17", now)).toBe("2030-01-17T09:00");
  });

  it("starts today on the next whole hour at least 15 minutes out", () => {
    expect(composeSlotForDay("2030-01-16", now)).toBe("2030-01-16T11:00");
    expect(composeSlotForDay("2030-01-16", new Date(2030, 0, 16, 10, 50))).toBe(
      "2030-01-16T12:00",
    );
  });
});
