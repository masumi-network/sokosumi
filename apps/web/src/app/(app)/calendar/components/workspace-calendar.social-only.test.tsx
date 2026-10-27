import type {
  SocialPostCalendarItem,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Social-only view of the calendar.
 *
 * Scheduled posts share the calendar with task runs, which is right for
 * planning a week and wrong for planning a feed: a busy workspace buries six
 * posts under sixty runs. These pin the two ways the posts come forward — a
 * toggle on the workspace calendar, and the lock Social's own page sets — and
 * that neither one leaves a task filter behind that would empty the grid.
 */

interface FullCalendarProps {
  eventContent?: (info: {
    event: { id: string; title: string; start?: Date | null };
  }) => ReactNode;
  events?: Array<{ id: string; title: string; start: string }>;
}

const {
  filterDropdownMenuMock,
  fullCalendarMock,
  getProjectCalendarMock,
  getWorkspaceCalendarMock,
  refreshMock,
  scheduleSocialPostMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  refreshMock: vi.fn(),
  scheduleSocialPostMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/ably/calendar-realtime-bridge", () => ({
  CalendarRealtimeBridge: () => null,
}));

vi.mock("@fullcalendar/react", () => ({
  default: (props: FullCalendarProps) => {
    fullCalendarMock(props);
    return (
      <div>
        {props.events?.map((event) => (
          <div key={event.id}>
            {props.eventContent?.({
              event: { ...event, start: new Date(event.start) },
            }) ?? event.title}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/interaction", () => ({ default: {} }));
vi.mock("@fullcalendar/react/list", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/classic", () => ({ default: {} }));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useLocale: () => "en",
    useTranslations: () => (key: string, values?: Record<string, string>) => {
      if (key === "event.accessibleName") {
        return `${values?.task}, ${values?.source}`;
      }
      if (key === "timezone.showing") return `Times in ${values?.zone}`;
      return key;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock, info: vi.fn() } }));

vi.mock("@/lib/actions/project/action", () => ({
  scheduleProjectSocialPost: scheduleSocialPostMock,
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpenWithDefaults: vi.fn() }),
}));

// The real dropdown reads the sections through a command palette; this file is
// about which sections it is handed.
vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: ComponentProps<"span">) => (
    <span {...props}>{children}</span>
  ),
  AvatarFallback: ({ children, ...props }: ComponentProps<"span">) => (
    <span {...props}>{children}</span>
  ),
  AvatarImage: (props: ComponentProps<"img">) => <img {...props} />,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: getProjectCalendarMock,
    getWorkspaceCalendar: getWorkspaceCalendarMock,
  },
}));

import { WorkspaceCalendar } from "./workspace-calendar";

const RUN: WorkspaceCalendarItem = {
  id: "run-1",
  kind: "RUN",
  scheduleId: "schedule-1",
  scheduleRevision: 3,
  canChangeRun: false,
  taskId: "task-1",
  taskName: "Prepare release notes",
  taskStatus: "COMPLETED",
  taskAssigneeId: "coworker-1",
  taskOwnerId: "user-1",
  scheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  originalScheduledAt: new Date("2030-01-02T09:00:00.000Z"),
  state: "RELEASED",
  sourceId: "project:project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
  sourceProjectId: "project-1",
};

const POST: SocialPostCalendarItem = {
  kind: "socialPost",
  threadPartCount: 1,
  publishedThreadPartCount: 0,
  failedThreadPartPosition: null,
  partiallyPublished: false,
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
  scheduledAt: new Date("2030-01-03T09:00:00.000Z"),
  lastAttempt: null,
  sourceId: "project:project-1",
  sourceProjectId: "project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
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

function renderCalendar(
  props: Partial<ComponentProps<typeof WorkspaceCalendar>> = {},
  searchParams = "?timezone=UTC&view=week",
  onUrlUpdate?: (event: UrlUpdateEvent) => void,
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <WorkspaceCalendar
        coworkers={[{ id: "coworker-1", name: "Ada" }]}
        initialDate="2030-01-02"
        items={[RUN, POST]}
        sources={SOURCES}
        {...props}
      />
    </NuqsTestingAdapter>,
  );
}

function renderedEventTitles(): string[] {
  const props = fullCalendarMock.mock.lastCall?.[0] as FullCalendarProps;
  return (props.events ?? []).map((event) => event.title);
}

function renderedPostStart(id: string): string | undefined {
  const props = fullCalendarMock.mock.lastCall?.[0] as FullCalendarProps;
  return props.events?.find((event) => event.id === id)?.start;
}

function stubPhone() {
  vi.stubGlobal("innerWidth", 767);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      () =>
        ({
          matches: true,
          media: "(max-width: 767px)",
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList,
    ),
  );
}

function filterSectionIds(): string[] {
  const props = filterDropdownMenuMock.mock.lastCall?.[0] as {
    sections: { id: string }[];
  };
  return props.sections.map((section) => section.id);
}

describe("WorkspaceCalendar Social-only view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    getProjectCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
  });

  it("offers no toggle where Social posts are not on the calendar", () => {
    renderCalendar();

    // Outside the beta the calendar carries no posts, so a control that
    // filters to them would only ever empty the grid.
    expect(
      screen.queryByTestId("calendar-social-only"),
    ).not.toBeInTheDocument();
  });

  it("shows runs and posts together until the reader asks for posts alone", () => {
    renderCalendar({ includeSocialPosts: true });

    expect(renderedEventTitles()).toEqual([
      "Prepare release notes",
      "Launch news",
    ]);
    expect(screen.getByTestId("calendar-social-only")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("calendar-views")).not.toHaveClass("min-h-11");
  });

  it("drops the runs once the toggle is pressed", () => {
    renderCalendar(
      { includeSocialPosts: true },
      "?timezone=UTC&view=week&socialOnly=true",
    );

    expect(renderedEventTitles()).toEqual(["Launch news"]);
    expect(screen.getByTestId("calendar-social-only")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * A Social post has no assignee and no task status, so the existing filters
   * already drop every post while one of them is set. Pressing the toggle
   * therefore clears them rather than handing back an empty grid.
   */
  it("clears the task filters it would otherwise contradict", async () => {
    const onUrlUpdate = vi.fn();
    const user = userEvent.setup();
    renderCalendar(
      { includeSocialPosts: true },
      "?timezone=UTC&view=week&status=COMPLETED&assigneeId=coworker-1",
      onUrlUpdate,
    );

    await user.click(screen.getByTestId("calendar-social-only"));

    const search = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(search?.get("socialOnly")).toBe("true");
    expect(search?.get("status")).toBeNull();
    expect(search?.get("assigneeId")).toBeNull();
  });

  it("clears the post status when Social-only is turned off", async () => {
    const onUrlUpdate = vi.fn();
    const user = userEvent.setup();
    renderCalendar(
      { includeSocialPosts: true },
      "?timezone=UTC&view=week&socialOnly=true&postStatus=FAILED",
      onUrlUpdate,
    );

    await user.click(screen.getByTestId("calendar-social-only"));

    const search = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(search?.get("socialOnly")).toBeNull();
    expect(search?.get("postStatus")).toBeNull();
  });

  it("hides the filters that cannot apply to a post", () => {
    renderCalendar(
      { includeSocialPosts: true, activeOrganizationId: "org-1" },
      "?timezone=UTC&view=week&socialOnly=true",
    );

    const ids = filterSectionIds();
    // Scope and source still narrow posts; coworker, human and task status
    // do not. Posts have their own status and platform filters.
    expect(ids).toContain("source");
    expect(ids).toContain("timezone");
    expect(ids).toContain("postStatus");
    expect(ids).toContain("provider");
    expect(ids).not.toContain("status");
    expect(ids).not.toContain("coworker");
    expect(ids).not.toContain("human");
  });

  it("narrows posts by post status, not a task status", () => {
    renderCalendar(
      {
        includeSocialPosts: true,
        socialPostsOnly: true,
        items: [
          POST,
          {
            ...POST,
            id: "social:failed",
            postId: "failed",
            text: "Failed news",
            status: "FAILED",
          },
        ],
      },
      "?timezone=UTC&view=week&postStatus=FAILED",
    );

    expect(renderedEventTitles()).toEqual(["Failed news"]);
  });

  it("narrows posts by platform", () => {
    renderCalendar(
      {
        includeSocialPosts: true,
        socialPostsOnly: true,
        items: [
          POST,
          {
            ...POST,
            id: "social:li",
            postId: "li",
            provider: "linkedin",
            text: "LinkedIn news",
          },
        ],
      },
      "?timezone=UTC&view=week&provider=linkedin",
    );

    expect(renderedEventTitles()).toEqual(["LinkedIn news"]);
  });

  it("clears the platform when Social-only is turned off", async () => {
    const onUrlUpdate = vi.fn();
    const user = userEvent.setup();
    renderCalendar(
      { includeSocialPosts: true },
      "?timezone=UTC&view=week&socialOnly=true&provider=x",
      onUrlUpdate,
    );

    await user.click(screen.getByTestId("calendar-social-only"));

    const search = onUrlUpdate.mock.lastCall?.[0].searchParams;
    expect(search?.get("socialOnly")).toBeNull();
    expect(search?.get("provider")).toBeNull();
  });

  it("says the period holds no posts rather than no releases", () => {
    renderCalendar(
      { includeSocialPosts: true, items: [RUN] },
      "?timezone=UTC&view=week&socialOnly=true",
    );

    expect(screen.getByText("empty.socialOnly")).toBeInTheDocument();
  });

  describe("locked to Social", () => {
    it("shows posts alone, with no toggle to undo it", () => {
      renderCalendar({ includeSocialPosts: true, socialPostsOnly: true });

      expect(renderedEventTitles()).toEqual(["Launch news"]);
      expect(
        screen.queryByTestId("calendar-social-only"),
      ).not.toBeInTheDocument();
    });

    it("opens on the month, not the workspace calendar's week", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC",
      );

      expect(screen.getByTestId("calendar-month")).toBeInTheDocument();
    });

    it("opens on a day grid with the chosen day's posts on a phone, not a sideways grid", async () => {
      const mediaQuery = {
        matches: true,
        media: "(max-width: 767px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } satisfies MediaQueryList;
      vi.stubGlobal("innerWidth", 767);
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => mediaQuery),
      );

      try {
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true },
          "?timezone=UTC",
        );

        await waitFor(() =>
          expect(screen.getByTestId("calendar-month")).toBeInTheDocument(),
        );
        expect(screen.queryByTestId("calendar-agenda")).not.toBeInTheDocument();
        expect(fullCalendarMock).not.toHaveBeenCalled();
        // January 2030 starts on a Tuesday: five weeks of seven days.
        expect(screen.getAllByTestId("calendar-mobile-day")).toHaveLength(35);
        expect(screen.getByTestId("calendar-day-list")).toHaveTextContent(
          "dayEmpty",
        );

        await userEvent.click(
          screen.getByRole("button", {
            name: "Thursday, January 3, dayCount",
          }),
        );
        expect(
          screen.getByRole("button", {
            name: "Thursday, January 3, dayCount",
          }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByTestId("calendar-day-list")).toHaveTextContent(
          "Launch news",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("offers month and week, and no agenda list", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=agenda",
      );

      expect(screen.getByTestId("calendar-month")).toBeInTheDocument();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "view.month",
        "view.week",
      ]);
    });

    it("gives the view tabs and filters 44px phone targets", () => {
      renderCalendar({ includeSocialPosts: true, socialPostsOnly: true });

      expect(screen.getByTestId("calendar-views")).toHaveClass("min-h-11");
      for (const tab of screen.getAllByRole("tab")) {
        expect(tab).toHaveClass("min-h-11");
      }
      expect(filterDropdownMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerClassName: "min-h-11 min-w-11 sm:min-h-8 sm:min-w-0",
        }),
      );
    });

    it.each([
      ["2026-10-05", "Central European Summer Time (Prague)"],
      ["2026-01-15", "Central European Standard Time (Prague)"],
    ])(
      "names the time zone for the shown date %s in its legend and picker",
      (date, label) => {
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true },
          `?timezone=Europe/Prague&date=${date}`,
        );

        expect(screen.getByTestId("calendar-timezone")).toHaveTextContent(
          `Times in ${label}`,
        );
        expect(filterDropdownMenuMock).toHaveBeenLastCalledWith(
          expect.objectContaining({
            sections: expect.arrayContaining([
              expect.objectContaining({
                id: "timezone",
                value: "Europe/Prague",
                options: expect.arrayContaining([
                  expect.objectContaining({
                    value: "Europe/Prague",
                    label,
                    shortLabel: date.includes("10-05") ? "GMT+2" : "GMT+1",
                    searchKeywords: ["Europe/Prague"],
                  }),
                ]),
              }),
            ]),
          }),
        );
      },
    );

    it("keeps a view the reader picked", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=week",
      );

      expect(screen.getByTestId("calendar-week")).toBeInTheDocument();
    });

    it("draws the week as rich chips: account, words, media and status", () => {
      renderCalendar(
        {
          includeSocialPosts: true,
          socialPostsOnly: true,
          items: [
            {
              ...POST,
              previewMedia: {
                fileUrl: "https://example.com/a.png",
                kind: "image",
              },
              attachmentCount: 1,
            },
          ],
        },
        "?timezone=UTC&view=week",
      );

      const chip = screen.getByTestId("calendar-social-post");
      expect(chip).toHaveAttribute("data-density", "week");
      expect(chip).toHaveTextContent("Launch news");
      expect(chip).toHaveTextContent("@team");
      expect(chip).toHaveTextContent("Release planning");
      expect(
        screen.getByTestId("calendar-social-post-thumb"),
      ).toBeInTheDocument();
      expect(
        within(chip).getByTestId("social-post-status-SCHEDULED"),
      ).toBeInTheDocument();
    });

    it("lets the week fill the screen and keeps every post of a day", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=week",
      );

      expect(fullCalendarMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ dayMaxEvents: false }),
      );
    });

    it("shows three posts a day on the month, then a +N more", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=month",
      );

      const props = fullCalendarMock.mock.lastCall?.[0] as {
        dayMaxEvents: number;
        moreLinkContent: (info: { num: number }) => string;
        moreLinkHint: (num: number) => string;
      };
      expect(props.dayMaxEvents).toBe(3);
      expect(props.moreLinkContent({ num: 2 })).toBe("socialPost.more");
      expect(props.moreLinkHint(2)).toBe("socialPost.moreHint");
      expect(screen.getByTestId("calendar-social-post")).toHaveAttribute(
        "data-density",
        "month",
      );
    });

    it("leaves the workspace calendar's day cells alone", () => {
      renderCalendar({ includeSocialPosts: true }, "?timezone=UTC&view=month");

      const props = fullCalendarMock.mock.lastCall?.[0] as object;
      expect(props).not.toHaveProperty("dayMaxEvents");
      expect(props).not.toHaveProperty("dayCellTopContent");
    });

    it("leaves mixed week posts as one line without a media tile", () => {
      renderCalendar({ includeSocialPosts: true }, "?timezone=UTC&view=week");

      expect(screen.getByTestId("calendar-social-post")).toHaveTextContent(
        "compactLabel",
      );
      expect(
        screen.queryByTestId("calendar-social-post-thumb"),
      ).not.toBeInTheDocument();
    });

    it("keeps the full post card on the month", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=month",
      );

      expect(screen.getByTestId("calendar-social-post")).toHaveTextContent(
        "Launch news",
      );
    });

    it("ignores a socialOnly=false left in the URL by the workspace calendar", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=week&socialOnly=false",
      );

      expect(renderedEventTitles()).toEqual(["Launch news"]);
    });

    it("offers neither task creation nor the schedules link", () => {
      renderCalendar({
        includeSocialPosts: true,
        lockedProjectId: "project-1",
        socialPostsOnly: true,
      });

      // Social's page is for posts: a Schedule a task affordance here would
      // create something the page cannot then show.
      expect(
        screen.queryByRole("button", { name: "create.fab" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /schedules\.link/ }),
      ).not.toBeInTheDocument();
    });

    describe("status summary", () => {
      const ITEMS: SocialPostCalendarItem[] = [
        POST,
        {
          ...POST,
          id: "social:failed",
          status: "FAILED",
          scheduledAt: new Date("2030-01-04T09:00:00.000Z"),
        },
        {
          ...POST,
          id: "social:published",
          status: "PUBLISHED",
          scheduledAt: new Date("2030-01-05T09:00:00.000Z"),
        },
        {
          ...POST,
          id: "social:february",
          scheduledAt: new Date("2030-02-05T09:00:00.000Z"),
        },
      ];

      it("counts the month's posts by status", () => {
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true, items: ITEMS },
          "?timezone=UTC&view=month&date=2030-01-02",
        );

        const summary = screen.getByTestId("calendar-status-summary");
        const pills = within(summary).getAllByRole("button");
        expect(pills.map((pill) => pill.textContent)).toEqual([
          "SCHEDULED1",
          "PUBLISHED1",
          "FAILED1",
        ]);
        for (const pill of pills) {
          expect(pill).toHaveAttribute("aria-pressed", "false");
        }
      });

      it("presses a pill to set the Filters menu's post status", async () => {
        const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true, items: ITEMS },
          "?timezone=UTC&view=month&date=2030-01-02",
          onUrlUpdate,
        );

        await userEvent.click(
          screen.getByTestId("calendar-status-pill-FAILED"),
        );

        await waitFor(() =>
          expect(onUrlUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({
              queryString: expect.stringContaining("postStatus=FAILED"),
            }),
          ),
        );
      });

      it("keeps the other pills while one is pressed, and lets it go", async () => {
        const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true, items: ITEMS },
          "?timezone=UTC&view=month&date=2030-01-02&postStatus=FAILED",
          onUrlUpdate,
        );

        expect(renderedEventTitles()).toHaveLength(1);
        const failed = screen.getByTestId("calendar-status-pill-FAILED");
        expect(failed).toHaveAttribute("aria-pressed", "true");
        expect(
          screen.getByTestId("calendar-status-pill-SCHEDULED"),
        ).toHaveTextContent("SCHEDULED1");

        await userEvent.click(failed);

        await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
        expect(onUrlUpdate.mock.lastCall?.[0].queryString).not.toContain(
          "postStatus",
        );
      });

      it("stays off the workspace calendar", () => {
        renderCalendar({ includeSocialPosts: true, items: ITEMS });

        expect(
          screen.queryByTestId("calendar-status-summary"),
        ).not.toBeInTheDocument();
      });
    });

    describe("reschedule without a drag", () => {
      const PUBLISHED: SocialPostCalendarItem = {
        ...POST,
        id: "social:published",
        status: "PUBLISHED",
      };

      async function rescheduleTo(value: string) {
        await userEvent.click(
          screen.getByTestId("calendar-social-post-reschedule"),
        );
        const dialog = await screen.findByRole("dialog");
        fireEvent.change(within(dialog).getByLabelText("socialMove.label"), {
          target: { value },
        });
        await userEvent.click(
          within(dialog).getByRole("button", { name: "socialMove.confirm" }),
        );
      }

      it("moves a week chip's post in the calendar's zone, at once", async () => {
        let resolve: (value: unknown) => void = () => {};
        scheduleSocialPostMock.mockReturnValue(
          new Promise((done) => {
            resolve = done;
          }),
        );
        renderCalendar(
          {
            includeSocialPosts: true,
            socialPostsOnly: true,
            items: [POST, PUBLISHED],
          },
          "?timezone=Europe/Prague&view=week&date=2030-01-02",
        );

        // Only the post that can still move offers it.
        expect(
          screen.getAllByTestId("calendar-social-post-reschedule"),
        ).toHaveLength(1);
        await rescheduleTo("2030-01-05T14:30");

        expect(scheduleSocialPostMock).toHaveBeenCalledWith({
          projectId: "project-1",
          postId: "post-1",
          scheduledAt: "2030-01-05T13:30:00.000Z",
          revision: 4,
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        // Drawn at the new time before Core answers, like a drop.
        expect(renderedPostStart(POST.id)).toBe("2030-01-05T13:30:00.000Z");

        resolve({ ok: true, value: {} });
        await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      });

      it("puts the post back and says why when Core refuses", async () => {
        scheduleSocialPostMock.mockResolvedValue({
          ok: false,
          error: { message: "Account disconnected" },
        });
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true, items: [POST] },
          "?timezone=UTC&view=week&date=2030-01-02",
        );

        await rescheduleTo("2030-01-05T14:30");

        await waitFor(() =>
          expect(toastErrorMock).toHaveBeenCalledWith(
            "Account disconnected",
            expect.anything(),
          ),
        );
        expect(renderedPostStart(POST.id)).toBe(POST.scheduledAt.toISOString());
        expect(refreshMock).not.toHaveBeenCalled();
      });

      it("refuses a time already gone without calling Core", async () => {
        renderCalendar(
          { includeSocialPosts: true, socialPostsOnly: true, items: [POST] },
          "?timezone=UTC&view=week&date=2030-01-02",
        );

        await rescheduleTo("2020-01-05T14:30");

        expect(screen.getByRole("alert")).toHaveTextContent("socialMove.past");
        expect(scheduleSocialPostMock).not.toHaveBeenCalled();
      });

      it("offers it in a phone's day list, which has no drag", async () => {
        scheduleSocialPostMock.mockResolvedValue({ ok: true, value: {} });
        stubPhone();
        try {
          renderCalendar(
            { includeSocialPosts: true, socialPostsOnly: true, items: [POST] },
            "?timezone=UTC&date=2030-01-03",
          );
          await userEvent.click(
            await screen.findByRole("button", {
              name: "Thursday, January 3, dayCount",
            }),
          );

          await rescheduleTo("2030-01-05T14:30");

          expect(scheduleSocialPostMock).toHaveBeenCalledWith(
            expect.objectContaining({
              scheduledAt: "2030-01-05T14:30:00.000Z",
            }),
          );
          await waitFor(() => expect(refreshMock).toHaveBeenCalled());
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });

    it("marks a phone day holding a post that needs attention in words and shape", async () => {
      stubPhone();
      try {
        renderCalendar(
          {
            includeSocialPosts: true,
            socialPostsOnly: true,
            items: [POST, { ...POST, id: "social:failed", status: "FAILED" }],
          },
          "?timezone=UTC&date=2030-01-03",
        );

        const day = await screen.findByRole("button", {
          name: "Thursday, January 3, dayCount, dayAttention",
        });
        const marks = day.querySelectorAll("span[aria-hidden] > span");
        // The failed post leads, drawn as a diamond rather than a dot.
        expect(marks[0]).toHaveClass("rotate-45");
        expect(marks[1]).toHaveClass("rounded-full");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
