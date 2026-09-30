import type {
  SocialPostCalendarItem,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
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
} = vi.hoisted(() => ({
  filterDropdownMenuMock: vi.fn(),
  fullCalendarMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
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
    useTranslations: () => (key: string, values?: Record<string, string>) => {
      if (key === "event.accessibleName") {
        return `${values?.task}, ${values?.source}`;
      }
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
  id: "social:post-1",
  postId: "post-1",
  provider: "x",
  text: "Launch news",
  status: "SCHEDULED",
  externalHandle: "team",
  projectName: "Release planning",
  scheduledByName: "Ada",
  scheduledByImage: null,
  attachmentCount: 0,
  previewMedia: null,
  scheduledAt: new Date("2030-01-03T09:00:00.000Z"),
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

  it("hides the filters that cannot apply to a post", () => {
    renderCalendar(
      { includeSocialPosts: true, activeOrganizationId: "org-1" },
      "?timezone=UTC&view=week&socialOnly=true",
    );

    const ids = filterSectionIds();
    // Scope and source still narrow posts; coworker, human and status do not.
    expect(ids).toContain("source");
    expect(ids).toContain("timezone");
    expect(ids).not.toContain("status");
    expect(ids).not.toContain("coworker");
    expect(ids).not.toContain("human");
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

    it("opens on the week on a phone", async () => {
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
          expect(screen.getByTestId("calendar-week")).toBeInTheDocument(),
        );
        expect(screen.queryByTestId("calendar-agenda")).not.toBeInTheDocument();
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

    it("keeps a view the reader picked", () => {
      renderCalendar(
        { includeSocialPosts: true, socialPostsOnly: true },
        "?timezone=UTC&view=week",
      );

      expect(screen.getByTestId("calendar-week")).toBeInTheDocument();
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
});
