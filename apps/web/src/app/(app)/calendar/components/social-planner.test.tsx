import type {
  SocialPostCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { ComponentProps } from "react";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Social's planner: the month overview beside the selected day, the week as
 * day lanes, the status summary that filters, dragging a post to another day,
 * and planning a post for a day.
 */

const {
  fullCalendarMock,
  refreshMock,
  scheduleProjectSocialPostMock,
  setComposeOpenMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  fullCalendarMock: vi.fn(),
  refreshMock: vi.fn(),
  scheduleProjectSocialPostMock: vi.fn(),
  setComposeOpenMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

let composeAvailable = true;

vi.mock("@/lib/ably/calendar-realtime-bridge", () => ({
  CalendarRealtimeBridge: () => null,
}));

vi.mock("@fullcalendar/react", () => ({
  default: (props: unknown) => {
    fullCalendarMock(props);
    return null;
  },
}));
vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/interaction", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/classic", () => ({ default: {} }));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useLocale: () => "en",
    useTranslations:
      () => (key: string, values?: Record<string, string | number>) =>
        values ? `${key} ${JSON.stringify(values)}` : key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, info: vi.fn() },
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpenWithDefaults: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: () => <div data-testid="calendar-filters" />,
}));

vi.mock("@/app/social/components/social-compose-context", () => ({
  useSocialCompose: () =>
    composeAvailable
      ? { open: false, scheduledAt: null, setOpen: setComposeOpenMock }
      : null,
}));

vi.mock("@/lib/actions/project/action", () => ({
  scheduleProjectSocialPost: scheduleProjectSocialPostMock,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: vi.fn(),
    getWorkspaceCalendar: vi.fn(),
  },
}));

import { moveToDay, planTimeForDay } from "./social-planner";
import { WorkspaceCalendar } from "./workspace-calendar";

const POST: SocialPostCalendarItem = {
  kind: "socialPost",
  revision: 4,
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
  scheduledAt: new Date("2030-01-08T09:00:00.000Z"),
  lastAttempt: null,
  sourceId: "project:project-1",
  sourceProjectId: "project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
};

const PUBLISHED: SocialPostCalendarItem = {
  ...POST,
  id: "social:post-2",
  postId: "post-2",
  text: "Shipped notes",
  status: "PUBLISHED",
  provider: "linkedin",
};

const FAILED: SocialPostCalendarItem = {
  ...POST,
  id: "social:post-3",
  postId: "post-3",
  text: "Broken news",
  status: "FAILED",
  scheduledAt: new Date("2030-01-15T14:30:00.000Z"),
};

const SOURCES: WorkspaceCalendarSource[] = [
  {
    sourceId: "project:project-1",
    sourceType: "PROJECT",
    displayName: "Release planning",
    logoUrl: null,
    paletteToken: "violet",
    isSchedulable: true,
  },
];

function renderPlanner(
  props: Partial<ComponentProps<typeof WorkspaceCalendar>> = {},
  searchParams = "?timezone=UTC&view=month",
  onUrlUpdate?: (event: UrlUpdateEvent) => void,
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <WorkspaceCalendar
        includeSocialPosts
        initialDate="2030-01-02"
        items={[POST, PUBLISHED, FAILED]}
        lockedProjectId="project-1"
        socialPostsOnly
        sources={SOURCES}
        {...props}
      />
    </NuqsTestingAdapter>,
  );
}

function day(dayNumber: number) {
  const days = screen.getAllByTestId("planner-day");
  const found = days.find(
    (button) =>
      button.querySelector("span > span")?.textContent === String(dayNumber),
  );
  if (!found) throw new Error(`No day ${dayNumber}`);
  return found;
}

function panel() {
  return screen.getByTestId("planner-day-panel");
}

function createDataTransfer() {
  return { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
}

/** Each event commits before the next, as a browser renders between them. */
async function dragCardToDay(card: HTMLElement, target: HTMLElement) {
  const dataTransfer = createDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  await act(async () => {
    fireEvent.drop(target, { dataTransfer });
  });
}

describe("SocialPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composeAvailable = true;
  });

  it("replaces the chip grid with a month overview beside the selected day", () => {
    renderPlanner();

    expect(fullCalendarMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("planner-month-overview")).toBeInTheDocument();
    // January 2030 has 31 days and today is not in it, so the first day with
    // posts opens.
    expect(screen.getAllByTestId("planner-day")).toHaveLength(31);
    expect(panel()).toHaveAttribute("data-day", "2030-01-08");
    expect(day(8)).toHaveAttribute("aria-pressed", "true");
    expect(day(8)).toHaveAttribute("tabindex", "0");
    expect(day(9)).toHaveAttribute("tabindex", "-1");
    const cards = within(panel()).getAllByTestId("calendar-social-post");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Launch news"),
      expect.stringContaining("Shipped notes"),
    ]);
  });

  it("marks each day with its post count and a status segment per post", () => {
    renderPlanner();

    expect(day(8)).toHaveAccessibleName(/"count":2/);
    expect(
      within(day(8)).getByTestId("planner-day-status-bar").children,
    ).toHaveLength(2);
    expect(
      within(day(8)).getAllByTestId("social-post-provider-icon"),
    ).toHaveLength(2);
    // A day ahead with nothing on it is an open day, drawn dashed.
    expect(day(9)).toHaveAttribute("data-open-day", "true");
    expect(day(8)).not.toHaveAttribute("data-open-day");
  });

  it("opens the day from the URL and writes a picked day back to it", async () => {
    const onUrlUpdate = vi.fn();
    const user = userEvent.setup();
    renderPlanner({}, "?timezone=UTC&view=month&date=2030-01-15", onUrlUpdate);

    expect(panel()).toHaveAttribute("data-day", "2030-01-15");
    expect(
      within(panel()).getByTestId("calendar-social-post"),
    ).toHaveTextContent("Broken news");

    await user.click(day(8));

    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("date")).toBe(
      "2030-01-08",
    );
    expect(panel()).toHaveAttribute("data-day", "2030-01-08");
  });

  it("walks the days with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPlanner({}, "?timezone=UTC&view=month&date=2030-01-08");

    day(8).focus();
    await user.keyboard("{ArrowRight}");
    expect(day(9)).toHaveFocus();
    expect(panel()).toHaveAttribute("data-day", "2030-01-09");

    await user.keyboard("{ArrowDown}");
    expect(day(16)).toHaveFocus();

    await user.keyboard("{Home}");
    expect(day(1)).toHaveFocus();
  });

  it("counts every status in the period and filters by the one pressed", async () => {
    const onUrlUpdate = vi.fn();
    const user = userEvent.setup();
    renderPlanner(
      {},
      "?timezone=UTC&view=month&postStatus=FAILED",
      onUrlUpdate,
    );

    // The counts ignore the status filter, so the other states stay visible
    // as choices while one is pressed.
    expect(screen.getByTestId("planner-status-SCHEDULED")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("planner-status-PUBLISHED")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("planner-status-FAILED")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("planner-status-CANCELED")).toBeNull();
    expect(screen.getByTestId("planner-post-count")).toHaveTextContent(
      '"count":1',
    );

    await user.click(screen.getByTestId("planner-status-FAILED"));
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("postStatus")).toBe(
      null,
    );

    await user.click(screen.getByTestId("planner-status-SCHEDULED"));
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("postStatus")).toBe(
      "SCHEDULED",
    );
  });

  it("counts the open days ahead", () => {
    renderPlanner();

    // 31 days ahead, two of them with posts.
    expect(screen.getByTestId("planner-open-days")).toHaveTextContent(
      '"count":29',
    );
  });

  it("names the project only where several projects share the calendar", () => {
    const { unmount } = renderPlanner();
    expect(within(panel()).queryAllByText("Release planning")).toHaveLength(0);
    unmount();

    renderPlanner({ lockedProjectId: undefined });
    expect(within(panel()).getAllByText("Release planning")).toHaveLength(2);
  });

  it("lays the week out as seven lanes and marks the open ones", () => {
    renderPlanner({}, "?timezone=UTC&view=week&date=2030-01-08");

    const lanes = screen.getAllByTestId("planner-day-lane");
    expect(lanes).toHaveLength(7);
    // Sun 6 … Sat 12; Tuesday the 8th holds both posts.
    expect(
      within(lanes[2]).getAllByTestId("calendar-social-post"),
    ).toHaveLength(2);
    expect(lanes[3]).toHaveTextContent("openDay");
    expect(
      within(lanes[3]).getByRole("button", { name: /planFor/ }),
    ).toBeInTheDocument();
  });

  it("lets only scheduled, failed and missed posts be dragged", () => {
    renderPlanner({}, "?timezone=UTC&view=week&date=2030-01-08");

    const [scheduled, published] = screen.getAllByTestId(
      "calendar-social-post",
    );
    expect(scheduled).toHaveAttribute("draggable", "true");
    expect(scheduled).toHaveAttribute("aria-describedby");
    expect(within(scheduled).getByTestId("planner-post-grip")).toBeVisible();
    expect(published).not.toHaveAttribute("draggable");
    expect(within(published).queryByTestId("planner-post-grip")).toBeNull();
  });

  it("moves a dragged post to the dropped day at the same time, at once", async () => {
    let resolve: (value: { ok: true; value: { id: string } }) => void =
      () => {};
    scheduleProjectSocialPostMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderPlanner({}, "?timezone=UTC&view=month&date=2030-01-08");

    const card = within(panel()).getAllByTestId("calendar-social-post")[0];
    await dragCardToDay(card, day(10));

    expect(scheduleProjectSocialPostMock).toHaveBeenCalledWith({
      projectId: "project-1",
      postId: "post-1",
      scheduledAt: "2030-01-10T09:00:00.000Z",
      revision: 4,
    });
    // The move shows before Core answers, and the planner follows the post.
    expect(panel()).toHaveAttribute("data-day", "2030-01-10");
    expect(
      within(panel()).getByTestId("calendar-social-post"),
    ).toHaveTextContent("Launch news");

    await act(async () => resolve({ ok: true, value: { id: "post-1" } }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("rolls a refused drop back and says why", async () => {
    scheduleProjectSocialPostMock.mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Social post cannot be scheduled" },
    });
    renderPlanner({}, "?timezone=UTC&view=week&date=2030-01-08");

    const lanes = screen.getAllByTestId("planner-day-lane");
    const card = within(lanes[2]).getAllByTestId("calendar-social-post")[0];
    await dragCardToDay(card, lanes[4]);

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Social post cannot be scheduled",
        { duration: Infinity, closeButton: true },
      ),
    );
    expect(
      within(lanes[2]).getAllByTestId("calendar-social-post"),
    ).toHaveLength(2);
    expect(
      within(lanes[4]).queryAllByTestId("calendar-social-post"),
    ).toHaveLength(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reloads after a conflicted drop", async () => {
    scheduleProjectSocialPostMock.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
      },
    });
    renderPlanner({}, "?timezone=UTC&view=week&date=2030-01-08");

    const lanes = screen.getAllByTestId("planner-day-lane");
    const card = within(lanes[2]).getAllByTestId("calendar-social-post")[0];
    await dragCardToDay(card, lanes[4]);

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(toastErrorMock).toHaveBeenCalledWith("conflict", {
      duration: Infinity,
      closeButton: true,
    });
  });

  it("refuses a drop on a past day", async () => {
    const past = {
      ...POST,
      scheduledAt: new Date("2020-01-08T09:00:00.000Z"),
      status: "MISSED" as const,
    };
    renderPlanner(
      { initialDate: "2020-01-02", items: [past] },
      "?timezone=UTC&view=week&date=2020-01-08",
    );

    // Sun 5 … Sat 11 January 2020; the post is on Wednesday the 8th.
    const lanes = screen.getAllByTestId("planner-day-lane");
    const card = within(lanes[3]).getByTestId("calendar-social-post");
    await dragCardToDay(card, lanes[5]);

    expect(scheduleProjectSocialPostMock).not.toHaveBeenCalled();
    // Past days offer no planning either.
    expect(screen.queryByRole("button", { name: /planFor/ })).toBeNull();
  });

  it("plans a post for the selected day at 9:00 in the calendar zone", async () => {
    const user = userEvent.setup();
    renderPlanner({}, "?timezone=Europe/Berlin&view=month&date=2030-01-09");

    await user.click(within(panel()).getByRole("button", { name: /planFor/ }));

    expect(setComposeOpenMock).toHaveBeenCalledWith(true, {
      scheduledAt: new Date("2030-01-09T08:00:00.000Z"),
    });
  });

  it("offers no planning on the all-projects view, which has no composer", () => {
    composeAvailable = false;
    renderPlanner({ lockedProjectId: undefined });

    expect(screen.queryByRole("button", { name: /planFor/ })).toBeNull();
    expect(panel()).toHaveTextContent("Launch news");
  });
});

describe("moveToDay", () => {
  it("keeps the wall-clock time across a daylight saving change", () => {
    // 09:00 in Berlin on Saturday 28 March 2026 (CET), moved past the switch.
    expect(
      moveToDay(
        new Date("2026-03-28T08:00:00.000Z"),
        "2026-03-30",
        "Europe/Berlin",
      ).toISOString(),
    ).toBe("2026-03-30T07:00:00.000Z");
  });
});

describe("planTimeForDay", () => {
  it("starts a later day at 9:00", () => {
    const now = Temporal.ZonedDateTime.from(
      "2026-10-26T15:20:00+01:00[Europe/Prague]",
    );
    expect(
      planTimeForDay("2026-10-28", "Europe/Prague", now).toISOString(),
    ).toBe("2026-10-28T08:00:00.000Z");
  });

  it("starts today at the next whole hour at least an hour out", () => {
    const now = Temporal.ZonedDateTime.from(
      "2026-10-26T15:20:00+01:00[Europe/Prague]",
    );
    expect(
      planTimeForDay("2026-10-26", "Europe/Prague", now).toISOString(),
    ).toBe("2026-10-26T16:00:00.000Z");
  });
});
