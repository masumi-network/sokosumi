import type {
  SocialPostCalendarItem,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  dateClick?: (info: { date: Date; allDay: boolean }) => void;
  eventContent?: (info: {
    event: { id: string; title: string; start?: Date | null };
  }) => ReactNode;
  events?: Array<{ id: string; title: string; start: string }>;
  initialView?: string;
  slotMaxTime?: string;
  slotMinTime?: string;
}

const {
  compose,
  filterDropdownMenuMock,
  fullCalendarMock,
  getProjectCalendarMock,
  getWorkspaceCalendarMock,
} = vi.hoisted(() => ({
  compose: { current: null as null | { openAt: ReturnType<typeof vi.fn> } },
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
}));

vi.mock("@/app/social/components/social-compose-context", () => ({
  useSocialCompose: () => compose.current,
}));

vi.mock("@/lib/actions/project/action", () => ({
  scheduleProjectSocialPost: vi.fn(),
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
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

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

function lastCalendarProps(): FullCalendarProps {
  return fullCalendarMock.mock.lastCall?.[0] as FullCalendarProps;
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
    compose.current = null;
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

    it("opens on the week timeline on a desktop", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC",
      );

      expect(screen.getByTestId("calendar-week")).toBeInTheDocument();
      expect(lastCalendarProps().initialView).toBe("timeGridWeek");
    });

    it("keeps the workspace calendar's week a day grid", () => {
      renderCalendar({ includeSocialPosts: true }, "?timezone=UTC&view=week");

      expect(lastCalendarProps().initialView).toBe("dayGridWeek");
    });

    it("opens on the list on a phone", async () => {
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
          expect(screen.getByTestId("calendar-list")).toBeInTheDocument(),
        );
        expect(screen.queryByTestId("calendar-agenda")).not.toBeInTheDocument();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("offers list, week and month, and opens an old agenda link on the list", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=agenda",
      );

      expect(screen.getByTestId("calendar-list")).toBeInTheDocument();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "view.list",
        "view.week",
        "view.month",
      ]);
    });

    it("ignores a list view on the workspace calendar", () => {
      renderCalendar({ includeSocialPosts: true }, "?timezone=UTC&view=list");

      expect(screen.queryByTestId("calendar-list")).not.toBeInTheDocument();
      expect(screen.getByTestId("calendar-week")).toBeInTheDocument();
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

    it("places week posts on the timeline with their words and a square preview", () => {
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
      expect(chip).toHaveTextContent("Launch news");
      expect(chip).toHaveTextContent("@team");
      expect(chip).not.toHaveTextContent("compactLabel");
      expect(
        screen.getByTestId("calendar-social-post-thumb"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("social-post-provider-icon"),
      ).toBeInTheDocument();
    });

    it("leaves a text-only week post without a media tile", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=week",
      );

      expect(screen.getByTestId("calendar-social-post")).toHaveTextContent(
        "Launch news",
      );
      expect(
        screen.queryByTestId("calendar-social-post-thumb"),
      ).not.toBeInTheDocument();
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
  });

  describe("Social's schedule", () => {
    const social = { includeSocialPosts: true, socialPostsOnly: true };

    it("lists every day of the week, each post under its day in the calendar's zone", () => {
      renderCalendar(
        {
          ...social,
          items: [
            // 02:00 UTC on the 3rd is still the evening of the 2nd in LA.
            { ...POST, scheduledAt: new Date("2030-01-03T02:00:00.000Z") },
          ],
        },
        "?timezone=America/Los_Angeles&view=list&date=2030-01-03",
      );

      const list = screen.getByTestId("calendar-list");
      expect(within(list).getAllByRole("region")).toHaveLength(7);
      const day = screen.getByTestId("calendar-list-day-2030-01-02");
      expect(within(day).getByTestId("calendar-list-row")).toHaveTextContent(
        "Launch news",
      );
      expect(
        screen.getByTestId("calendar-list-day-2030-01-03"),
      ).toHaveTextContent("list.empty");
    });

    it("offers Reschedule on posts that can move, and opens the time dialog", async () => {
      const user = userEvent.setup();
      renderCalendar(
        {
          ...social,
          items: [
            POST,
            {
              ...POST,
              id: "social:published",
              postId: "published",
              status: "PUBLISHED",
              text: "Old news",
            },
          ],
        },
        "?timezone=UTC&view=list&date=2030-01-03",
      );

      const buttons = screen.getAllByRole("button", {
        name: "list.reschedule",
      });
      expect(buttons).toHaveLength(1);
      await user.click(buttons[0]);

      expect(
        screen.getByRole("dialog", { name: "socialMove.title" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("socialMove.label")).toHaveValue(
        "2030-01-03T09:00",
      );
    });

    it("starts a post on a day of the list at 9:00 in the calendar's zone", async () => {
      const user = userEvent.setup();
      compose.current = { openAt: vi.fn() };
      renderCalendar(
        { ...social, items: [] },
        "?timezone=Europe/Prague&view=list&date=2030-01-03",
      );

      const day = screen.getByTestId("calendar-list-day-2030-01-04");
      await user.click(
        within(day).getByRole("button", { name: "list.createOn" }),
      );

      expect(compose.current.openAt).toHaveBeenCalledWith(
        new Date("2030-01-04T08:00:00.000Z"),
      );
    });

    it("offers no Add post where no composer can open", () => {
      renderCalendar(
        { ...social, items: [] },
        "?timezone=UTC&view=list&date=2030-01-03",
      );

      expect(
        screen.queryByRole("button", { name: "list.createOn" }),
      ).not.toBeInTheDocument();
    });

    it("starts a post at the timeline slot, or the morning of a month day", () => {
      compose.current = { openAt: vi.fn() };
      renderCalendar(social, "?timezone=UTC&view=week&date=2030-01-03");

      act(() =>
        lastCalendarProps().dateClick?.({
          date: new Date("2030-01-03T14:00:00.000Z"),
          allDay: false,
        }),
      );
      expect(compose.current.openAt).toHaveBeenLastCalledWith(
        new Date("2030-01-03T14:00:00.000Z"),
      );

      renderCalendar(social, "?timezone=UTC&view=month&date=2030-01-03");
      act(() =>
        lastCalendarProps().dateClick?.({
          date: new Date("2030-01-05T00:00:00.000Z"),
          allDay: true,
        }),
      );
      expect(compose.current.openAt).toHaveBeenLastCalledWith(
        new Date("2030-01-05T09:00:00.000Z"),
      );
    });

    it("widens the timeline to hold an early post", () => {
      renderCalendar(
        {
          ...social,
          items: [
            { ...POST, scheduledAt: new Date("2030-01-03T04:00:00.000Z") },
          ],
        },
        "?timezone=UTC&view=week",
      );

      expect(lastCalendarProps()).toMatchObject({
        slotMinTime: "04:00:00",
        slotMaxTime: "22:00:00",
      });
    });

    it("drops the repeated project name once the calendar is locked to it", () => {
      renderCalendar(social, "?timezone=UTC&view=month");
      expect(screen.getByTestId("calendar-social-post")).toHaveTextContent(
        "Release planning",
      );

      renderCalendar(
        { ...social, lockedProjectId: "project-1" },
        "?timezone=UTC&view=month",
      );
      expect(
        screen.getAllByTestId("calendar-social-post").at(-1),
      ).not.toHaveTextContent("Release planning");
    });
  });
});
