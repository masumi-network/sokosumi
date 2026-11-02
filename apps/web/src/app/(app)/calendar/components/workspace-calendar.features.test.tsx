import type {
  ContactFollowUpCalendarItem,
  MarketingPieceCalendarItem,
  NewsletterIssueCalendarItem,
  SocialPostCalendarItem,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Calendar's features: each one is a filter on it. These pin how the
 * Show filter chooses them through the URL, and how the three kinds that open
 * elsewhere (Newsletter issues, Contact follow-ups, Marketing pieces) are
 * drawn and linked.
 */

interface FullCalendarProps {
  eventContent?: (info: {
    event: { id: string; title: string; start?: Date | null };
  }) => ReactNode;
  events?: Array<{
    id: string;
    title: string;
    start: string;
    allDay?: boolean;
    startEditable?: boolean;
  }>;
}

const { fullCalendarMock, filterDropdownMenuMock } = vi.hoisted(() => ({
  fullCalendarMock: vi.fn(),
  filterDropdownMenuMock: vi.fn(),
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
vi.mock("@fullcalendar/react/themes/classic", () => ({ default: {} }));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useLocale: () => "en",
    useTranslations: () => (key: string, values?: Record<string, string>) =>
      key === "event.accessibleName"
        ? `${values?.task}, ${values?.source}`
        : key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpenWithDefaults: vi.fn() }),
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: vi.fn(),
    getWorkspaceCalendar: vi.fn(),
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
  quotedPostId: null,
  needsAttentionReason: null,
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

const ISSUE: NewsletterIssueCalendarItem = {
  kind: "newsletterIssue",
  id: "newsletter:issue-1",
  scheduledAt: new Date("2030-01-04T08:00:00.000Z"),
  issueId: "issue-1",
  subject: "January roundup",
  status: "SCHEDULED",
  projectName: "Release planning",
  sourceId: "project:project-1",
  sourceProjectId: "project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
};

const FOLLOW_UP: ContactFollowUpCalendarItem = {
  kind: "contactFollowUp",
  id: "followup:contact-1",
  scheduledAt: new Date("2030-01-05T00:00:00.000Z"),
  contactId: "contact-1",
  name: "Grace Hopper",
  organization: "Navy",
  avatarUrl: null,
  nextStep: "Send the quote",
  date: "2030-01-05",
  allDay: true,
  sourceId: "workspace:workspace-1",
  sourceProjectId: null,
  sourceWorkspaceId: "workspace-1",
  sourceType: "WORKSPACE",
};

const PIECE: MarketingPieceCalendarItem = {
  kind: "marketingPiece",
  id: "marketing:strategy-1:entry-1",
  scheduledAt: new Date("2030-01-06T10:00:00.000Z"),
  strategyId: "strategy-1",
  entryId: "entry-1",
  title: "Launch article",
  channel: "blog",
  format: "article",
  status: "draft",
  fileId: "file-1",
  projectName: "Release planning",
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

const ALL = [RUN, POST, ISSUE, FOLLOW_UP, PIECE];

function renderCalendar(
  props: Partial<ComponentProps<typeof WorkspaceCalendar>> = {},
  searchParams = "?timezone=UTC&view=week&date=2030-01-03",
  onUrlUpdate?: (event: UrlUpdateEvent) => void,
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <WorkspaceCalendar
        initialDate="2030-01-03"
        items={ALL}
        newsletterEnabled
        {...props}
      />
    </NuqsTestingAdapter>,
  );
}

function renderedEvents() {
  const props = fullCalendarMock.mock.lastCall?.[0] as FullCalendarProps;
  return props.events ?? [];
}

function renderedTitles(): string[] {
  return renderedEvents().map((event) => event.title);
}

async function openShowFilter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("calendar-show"));
  return screen.getByRole("menu");
}

describe("WorkspaceCalendar features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("the new kinds", () => {
    it("opens a Newsletter issue on its issue page", () => {
      renderCalendar();

      const link = screen.getByRole("link", {
        name: "January roundup, show.newsletter",
      });
      expect(link).toHaveAttribute("href", "/newsletter/issues/issue-1");
      expect(link).toHaveTextContent("8:00 AM");
    });

    it("places a Contact follow-up on its day, all day, and opens the contact", () => {
      renderCalendar();

      const link = screen.getByRole("link", {
        name: "Grace Hopper, show.contacts",
      });
      expect(link).toHaveAttribute("href", "/contacts?contact=contact-1");
      expect(link).toHaveTextContent("event.allDay");
      expect(link).toHaveTextContent("Send the quote");
      expect(renderedEvents().find((e) => e.id === FOLLOW_UP.id)).toMatchObject(
        { allDay: true, start: "2030-01-05" },
      );
    });

    it("opens a Marketing piece in its Project file once it is written", () => {
      renderCalendar();

      expect(
        screen.getByRole("link", { name: "Launch article, show.marketing" }),
      ).toHaveAttribute("href", "/drive/files/file-1");
    });

    it("shows a Marketing piece with no file yet, without a link", () => {
      renderCalendar({ items: [{ ...PIECE, fileId: null }] });

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      // Still announced, by the name a linked piece has.
      expect(
        screen.getByRole("group", { name: "Launch article, show.marketing" }),
      ).toBeInTheDocument();
    });

    it("names the Project of a Project's entries, as a Run does, and a Workspace's follow-up none", () => {
      renderCalendar({ sources: SOURCES, items: [ISSUE, FOLLOW_UP, PIECE] });

      for (const name of [
        "January roundup, show.newsletter",
        "Launch article, show.marketing",
      ]) {
        const link = screen.getByRole("link", { name });
        expect(link).toHaveTextContent("Release planning");
        expect(
          within(link).getByTestId("calendar-source-marker"),
        ).toBeInTheDocument();
      }
      const followUp = screen.getByRole("link", {
        name: "Grace Hopper, show.contacts",
      });
      expect(
        within(followUp).queryByTestId("calendar-source-marker"),
      ).not.toBeInTheDocument();
    });

    it("moves only Runs and Social posts", () => {
      renderCalendar({ items: [ISSUE, FOLLOW_UP, PIECE] });

      expect(renderedEvents().map((event) => event.startEditable)).toEqual([
        false,
        false,
        false,
      ]);
    });

    it("lists them in the agenda from today on", () => {
      const past = {
        ...ISSUE,
        id: "newsletter:old",
        subject: "Old issue",
        scheduledAt: new Date("2020-01-04T08:00:00.000Z"),
      };
      renderCalendar(
        { items: [past, ISSUE, FOLLOW_UP, PIECE] },
        "?timezone=UTC&view=agenda",
      );

      const agenda = screen.getByTestId("calendar-agenda");
      expect(within(agenda).getByText("January roundup")).toBeInTheDocument();
      expect(within(agenda).getByText("Grace Hopper")).toBeInTheDocument();
      expect(within(agenda).getByText("Launch article")).toBeInTheDocument();
      expect(within(agenda).queryByText("Old issue")).not.toBeInTheDocument();
    });
  });

  describe("the Show filter", () => {
    it("shows every feature when the URL names none", () => {
      renderCalendar();

      expect(renderedTitles()).toEqual([
        "Prepare release notes",
        "Launch news",
        "January roundup",
        "Grace Hopper",
        "Launch article",
      ]);
    });

    it("checks the features the URL names, the ones the page asked Core for", async () => {
      const user = userEvent.setup();
      renderCalendar(
        { items: [ISSUE, FOLLOW_UP] },
        "?timezone=UTC&view=week&types=newsletter,contacts",
      );

      expect(renderedTitles()).toEqual(["January roundup", "Grace Hopper"]);
      await openShowFilter(user);
      expect(
        screen
          .getAllByRole("menuitemcheckbox", { checked: true })
          .map((item) => item.textContent),
      ).toEqual(["show.newsletter", "show.contacts"]);
    });

    it("hides the other kinds while a Task filter is set, as Core does", () => {
      renderCalendar({}, "?timezone=UTC&view=week&assigneeId=coworker-1");

      expect(renderedTitles()).toEqual(["Prepare release notes"]);
    });

    it("follows the Project in the URL", () => {
      renderCalendar({}, "?timezone=UTC&view=week&projectId=project-1");

      // The follow-up belongs to the workspace, not to a Project.
      expect(renderedTitles()).not.toContain("Grace Hopper");
      expect(renderedTitles()).toContain("January roundup");
    });

    it("writes the choice to the URL, one feature at a time", async () => {
      const onUrlUpdate = vi.fn();
      const user = userEvent.setup();
      renderCalendar({}, "?timezone=UTC&view=week", onUrlUpdate);

      await openShowFilter(user);
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.tasks" }),
      );

      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("types")).toBe(
        "social,newsletter,contacts,marketing",
      );
    });

    it("drops the param once every feature is on again", async () => {
      const onUrlUpdate = vi.fn();
      const user = userEvent.setup();
      renderCalendar({}, "?timezone=UTC&view=week&types=social", onUrlUpdate);

      await openShowFilter(user);
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.tasks" }),
      );
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.newsletter" }),
      );
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.contacts" }),
      );
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.marketing" }),
      );

      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has("types")).toBe(
        false,
      );
    });

    it("keeps the last feature on", async () => {
      const user = userEvent.setup();
      renderCalendar({}, "?timezone=UTC&view=week&types=social");

      await openShowFilter(user);

      expect(
        screen.getByRole("menuitemcheckbox", { name: "show.social" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("offers Newsletter only where the workspace has it", async () => {
      const user = userEvent.setup();
      renderCalendar({ newsletterEnabled: false });

      await openShowFilter(user);

      expect(
        screen.queryByRole("menuitemcheckbox", { name: "show.newsletter" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent),
      ).toEqual([
        "show.tasks",
        "show.social",
        "show.contacts",
        "show.marketing",
      ]);
    });

    it("is named, and reached and opened from the keyboard", async () => {
      const user = userEvent.setup();
      renderCalendar();

      const show = screen.getByRole("button", { name: "show.label" });
      for (
        let presses = 0;
        presses < 12 && document.activeElement !== show;
        presses++
      ) {
        await user.tab();
      }
      expect(show).toHaveFocus();

      await user.keyboard("{Enter}");

      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(
        screen.getByRole("menuitemcheckbox", { name: "show.tasks" }),
      ).toBeInTheDocument();
    });

    it("clears the task filters Social alone would be emptied by", async () => {
      const onUrlUpdate = vi.fn();
      const user = userEvent.setup();
      renderCalendar(
        {},
        "?timezone=UTC&view=agenda&status=COMPLETED&assigneeId=coworker-1&types=social,contacts",
        onUrlUpdate,
      );

      await openShowFilter(user);
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.contacts" }),
      );

      const search = onUrlUpdate.mock.lastCall?.[0].searchParams;
      expect(search?.get("types")).toBe("social");
      expect(search?.get("status")).toBeNull();
      expect(search?.get("assigneeId")).toBeNull();
      // Social has no agenda list.
      expect(search?.get("view")).toBeNull();
    });

    it("clears the post filters once Social is no longer alone", async () => {
      const onUrlUpdate = vi.fn();
      const user = userEvent.setup();
      renderCalendar(
        {},
        "?timezone=UTC&view=week&types=social&postStatus=FAILED&provider=x",
        onUrlUpdate,
      );

      await openShowFilter(user);
      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "show.tasks" }),
      );

      const search = onUrlUpdate.mock.lastCall?.[0].searchParams;
      expect(search?.get("postStatus")).toBeNull();
      expect(search?.get("provider")).toBeNull();
    });
  });

  describe("views", () => {
    function viewNames() {
      return within(screen.getByTestId("calendar-views"))
        .getAllByRole("radio")
        .map((radio) => radio.textContent);
    }

    it("offers the agenda for every mix but Social posts alone", () => {
      const { unmount } = renderCalendar({}, "?timezone=UTC&types=social");
      expect(viewNames()).toEqual(["view.month", "view.week"]);
      unmount();

      renderCalendar({}, "?timezone=UTC&types=social,newsletter");
      expect(viewNames()).toEqual(["view.month", "view.week", "view.agenda"]);
    });

    it("offers the agenda for any other feature alone", () => {
      renderCalendar({}, "?timezone=UTC&types=newsletter");

      expect(viewNames()).toContain("view.agenda");
    });
  });
});
