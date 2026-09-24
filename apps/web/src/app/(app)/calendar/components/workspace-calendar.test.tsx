import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { Activity, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TaskSchedule,
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import CalendarError from "../error";
import CalendarLoading from "../loading";
import {
  getCalendarItemDateKey,
  WorkspaceCalendar,
} from "./workspace-calendar";

const {
  calendarRealtimeBridgeMock,
  filterDropdownMenuMock,
  getProjectCalendarMock,
  getWorkspaceCalendarMock,
  listTaskSchedulesMock,
  pushMock,
  refreshMock,
} = vi.hoisted(() => ({
  calendarRealtimeBridgeMock: vi.fn(),
  filterDropdownMenuMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  listTaskSchedulesMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/ably/calendar-realtime-bridge", () => ({
  CalendarRealtimeBridge: (props: unknown) => {
    calendarRealtimeBridgeMock(props);
    return null;
  },
}));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter({ locale: "en-US" });
  return {
    useFormatter: () => formatter,
    useTranslations: () => (key: string, values?: Record<string, string>) =>
      key === "event.accessibleName"
        ? `${values?.task}, ${values?.source}`
        : key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdCalendar: getProjectCalendarMock,
    getWorkspaceCalendar: getWorkspaceCalendarMock,
    listTaskSchedules: listTaskSchedulesMock,
  },
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
}));

vi.mock("@/app/tasks/actions", () => ({
  loadTaskScheduleDialogOptions: vi.fn(),
}));

const ITEMS: WorkspaceCalendarItem[] = [
  {
    id: "run-1",
    kind: "RUN",
    scheduleId: "schedule-1",
    scheduleRevision: 3,
    canChangeRun: true,
    taskId: null,
    taskName: "Prepare release notes",
    taskStatus: null,
    taskAssigneeId: "coworker-1",
    taskOwnerId: "user-1",
    scheduledAt: new Date("2026-08-18T09:00:00.000Z"),
    originalScheduledAt: new Date("2026-08-18T09:00:00.000Z"),
    state: "PLANNED",
    sourceId: "project:project-1",
    sourceWorkspaceId: "workspace-1",
    sourceType: "PROJECT",
    sourceProjectId: "project-1",
    sourceAccuracy: "INFERRED",
    timeAccuracy: "APPROXIMATE",
  },
];

const LEGACY_ITEM: WorkspaceCalendarItem = {
  ...ITEMS[0],
  id: "run-legacy-1",
  taskName: "Review imported schedule",
  sourceId: "legacy:calendar-1",
  sourceProjectId: null,
  sourceType: "LEGACY_UNKNOWN",
};

const CALENDAR_PAGE = {
  pagination: {
    cursor: null,
    limit: 100,
    total: 101,
    nextCursor: "cursor-2",
  },
  range: {
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-09-01T00:00:00.000Z"),
  },
};

function buildSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: "schedule-1",
    workspaceId: "workspace-1",
    organizationId: null,
    ownerId: "user-1",
    creatorUserId: "user-1",
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state: "ACTIVE",
    rule: {
      expr: "0 9 * * *",
      timezone: "UTC",
      intervalDays: null,
      anchorAt: new Date("2026-08-01T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    },
    ruleEffectiveFrom: new Date("2026-08-01T09:00:00.000Z"),
    releasedCount: 0,
    nextRunAt: new Date("2026-08-19T09:00:00.000Z"),
    revision: 0,
    name: "Daily standup notes",
    description: null,
    projectId: null,
    visibility: "PUBLIC",
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    updatedAt: new Date("2026-08-01T09:00:00.000Z"),
    ...overrides,
  };
}

const ROSTER = [
  { id: "user-1", name: "Ada", kind: "user" as const },
  { id: "user-2", name: "Grace Hopper", kind: "user" as const },
];

const SOURCES: WorkspaceCalendarSource[] = [
  {
    sourceId: "workspace:workspace-1",
    sourceType: "WORKSPACE",
    displayName: "Ada's workspace",
    logoUrl: null,
    paletteToken: "blue",
    isSchedulable: true,
  },
  {
    sourceId: "project:project-1",
    sourceType: "PROJECT",
    displayName: "Release planning",
    logoUrl: "https://example.com/release-planning.png",
    paletteToken: "violet",
    isSchedulable: true,
  },
  {
    sourceId: "legacy:calendar-1",
    sourceType: "LEGACY_UNKNOWN",
    displayName: "Imported calendar",
    logoUrl: null,
    paletteToken: "amber",
    isSchedulable: false,
  },
];

describe("WorkspaceCalendar", () => {
  beforeEach(() => {
    vi.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(
      Temporal.PlainDate.from("2026-08-18"),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("clears Calendar details and pagination immediately when access is revoked", () => {
    // The next page never answers, so the drain stays in flight for the test.
    getWorkspaceCalendarMock.mockReturnValue(new Promise(() => {}));
    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar
          currentUserId="user-1"
          initialDate="2026-08-18"
          items={ITEMS}
          pagination={CALENDAR_PAGE.pagination}
          range={CALENDAR_PAGE.range}
          sources={SOURCES}
          workspaceId="workspace-1"
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-event")).toHaveLength(1);
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-2" }),
    );

    const bridgeProps = calendarRealtimeBridgeMock.mock.calls.at(-1)?.[0] as {
      onAccessRevoked: () => void;
    };
    act(() => {
      bridgeProps.onAccessRevoked();
    });

    expect(screen.queryByTestId("calendar-event")).not.toBeInTheDocument();
    // Revoking dropped the cursor, so the drain asks for nothing more.
    expect(getWorkspaceCalendarMock).toHaveBeenCalledTimes(1);
  });

  it("renders Calendar items received after the initial client render", async () => {
    const { rerender } = render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar
          items={[]}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      screen.queryByRole("button", { name: /Prepare release notes/ }),
    ).not.toBeInTheDocument();

    rerender(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      await screen.findAllByRole("button", { name: /Prepare release notes/ }),
    ).toHaveLength(1);
  });

  it("never commits a stale/clickable item for a frame when a fresh server page arrives", () => {
    // Bypasses RTL's act()-wrapped render/rerender on purpose: act() flushes
    // passive effects synchronously, so a useEffect-based prop sync would
    // always look correct through it, masking exactly the transient commit
    // this test exists to catch. `flushSync` forces a synchronous commit
    // without flushing passive effects (verified empirically against a
    // minimal repro in this repo's test environment), so it can observe
    // whatever DOM React actually paints before any effect runs.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Tree({ items }: { items: WorkspaceCalendarItem[] }) {
      return (
        <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
          <WorkspaceCalendar
            items={items}
            initialDate="2026-08-18"
            sources={SOURCES}
          />
        </NuqsTestingAdapter>
      );
    }

    try {
      flushSync(() => {
        root.render(<Tree items={ITEMS} />);
      });

      expect(
        within(container).getAllByRole("button", {
          name: /Prepare release notes/,
        }).length,
      ).toBeGreaterThan(0);

      // Simulate `router.refresh()` delivering a fresh server page where the
      // task was cleared/rescheduled out of view — a brand-new `items` array.
      flushSync(() => {
        root.render(<Tree items={[]} />);
      });

      // Assert immediately after the synchronous commit, before any passive
      // effect can run: the cleared item must already be gone, not still
      // rendered (and clickable) for one commit.
      expect(
        within(container).queryAllByRole("button", {
          name: /Prepare release notes/,
        }),
      ).toHaveLength(0);
    } finally {
      root.unmount();
      container.remove();
    }
  });

  it("recreates the Calendar view when a cached Activity route is reactivated", async () => {
    refreshMock.mockClear();

    function ActivityHarness({ mode }: { mode: "hidden" | "visible" }) {
      return (
        <StrictMode>
          <Activity mode={mode}>
            <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
              <WorkspaceCalendar
                items={ITEMS}
                initialDate="2026-08-18"
                sources={SOURCES}
              />
            </NuqsTestingAdapter>
          </Activity>
        </StrictMode>
      );
    }

    const { rerender } = render(<ActivityHarness mode="visible" />);
    const initialCalendar = screen.getByTestId("calendar-agenda");

    // Let StrictMode's synchronous setup -> cleanup -> setup cycle settle
    // (its dangling microtask, if any) before asserting on initial mount.
    await Promise.resolve();

    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("calendar-agenda")).toBe(initialCalendar);

    rerender(<ActivityHarness mode="hidden" />);
    rerender(<ActivityHarness mode="visible" />);

    await waitFor(() =>
      expect(screen.getByTestId("calendar-agenda")).not.toBe(initialCalendar),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not show a schedule task toolbar button", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      screen.queryByRole("button", { name: "create.title" }),
    ).not.toBeInTheDocument();
  });

  it("does not render a page heading", () => {
    render(
      <NuqsTestingAdapter>
        <WorkspaceCalendar items={ITEMS} initialDate="2040-01-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("uses the server-provided date when the URL has no date", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=month">
        <WorkspaceCalendar items={ITEMS} initialDate="2040-01-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("January 2040")).toBeInTheDocument();
  });

  it("uses semantic theme tokens for FullCalendar", () => {
    render(
      <NuqsTestingAdapter>
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("calendar-week")).toHaveClass(
      "workspace-calendar-theme",
      "bg-background",
      "overflow-x-auto",
      "-mx-4",
      "rounded-none",
      "border-0",
      "border-border",
      "md:mx-0",
      "md:rounded-xl",
      "md:border",
    );
  });

  it("disables forward navigation beyond the supplied calendar horizon", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=month">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          latestDate="2026-08-18"
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
  });

  it("groups offset-boundary timestamps by the calendar timezone", () => {
    expect(getCalendarItemDateKey(new Date("2026-08-18T00:30:00.000Z"))).toBe(
      "2026-08-18",
    );
    expect(
      getCalendarItemDateKey(
        new Date("2026-08-18T00:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-08-17");
  });

  it("renders agenda source details without the approximate-time label", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES.map((source) =>
            source.sourceType === "PROJECT"
              ? { ...source, isSchedulable: false }
              : source,
          )}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("calendar-agenda")).toBeInTheDocument();
    expect(screen.getByText("Release planning")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-source-marker")).toBeInTheDocument();
    expect(screen.getByLabelText("accuracy.inferred")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("accuracy.approximate"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Prepare release notes/ })[0],
    ).toBeInTheDocument();
  });

  it.each(["month", "week", "agenda"] as const)(
    "marks inferred items in the %s view",
    (view) => {
      render(
        <NuqsTestingAdapter searchParams={`?view=${view}&date=2026-08-18`}>
          <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
        </NuqsTestingAdapter>,
      );

      expect(screen.getByLabelText("accuracy.inferred")).toBeInTheDocument();
    },
  );

  it("uses the task-style scope filter", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?timezone=UTC"
      >
        <WorkspaceCalendar
          activeOrganizationId="org-1"
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES.map((source) =>
            source.sourceType === "PROJECT"
              ? { ...source, isSchedulable: false }
              : source,
          )}
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        onChange: (value: string | null) => void;
        options?: Array<{
          avatarLabel: string;
          image: string | null;
          label: string;
          value: string;
        }>;
      }>;
    };
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "source",
      "coworker",
      "human",
      "status",
      "timezone",
    ]);
    expect(
      props.sections.find((section) => section.id === "source")?.options,
    ).toEqual([
      {
        avatarLabel: "Ada's workspace",
        image: null,
        label: "Ada's workspace",
        value: "workspace:workspace-1",
      },
      {
        avatarLabel: "Release planning",
        image: "https://example.com/release-planning.png",
        label: "Release planning",
        value: "project:project-1",
      },
      {
        avatarLabel: "Imported calendar",
        image: null,
        label: "Imported calendar",
        value: "legacy:calendar-1",
      },
    ]);

    props.sections.find((section) => section.id === "scope")?.onChange("owned");
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));

    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    expect(new URLSearchParams(updates.at(-1)).get("scope")).toBe("owned");
  });

  it("provides profile pictures for coworker and human filter options", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          coworkers={[
            {
              id: "coworker-1",
              name: "Release Coworker",
              image: "https://example.com/coworker.png",
              kind: "coworker",
            },
            {
              id: "user-1",
              name: "Ada Lovelace",
              image: "https://example.com/ada.png",
              kind: "user",
            },
          ]}
          items={ITEMS}
          initialDate="2026-08-18"
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        options: Array<{
          avatarLabel?: string;
          image?: string;
          label: string;
          value: string;
        }>;
      }>;
    };

    expect(
      props.sections.find((section) => section.id === "coworker")?.options,
    ).toEqual([
      {
        avatarLabel: "Release Coworker",
        image: "https://example.com/coworker.png",
        label: "Release Coworker",
        value: "coworker-1",
      },
    ]);
    expect(
      props.sections.find((section) => section.id === "human")?.options,
    ).toEqual([
      {
        avatarLabel: "Ada Lovelace",
        image: "https://example.com/ada.png",
        label: "Ada Lovelace",
        value: "user-1",
      },
    ]);
  });

  it("preserves the selected scope when filtering by coworker", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        searchParams="?timezone=UTC&scope=owned"
        onUrlUpdate={onUrlUpdate}
      >
        <WorkspaceCalendar
          activeOrganizationId="org-1"
          coworkers={[{ id: "coworker-1", name: "Ada" }]}
          items={ITEMS}
          initialDate="2026-08-18"
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        onChange: (value: string | null) => void;
      }>;
    };
    props.sections
      .find((section) => section.id === "coworker")
      ?.onChange("coworker-1");

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    const updatedSearchParams = new URLSearchParams(updates.at(-1));
    expect(updatedSearchParams.get("scope")).toBe("owned");
    expect(updatedSearchParams.get("assigneeId")).toBe("coworker-1");
  });

  it("persists the selected status in the Calendar URL", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?timezone=UTC"
      >
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        onChange: (value: string | null) => void;
      }>;
    };
    props.sections
      .find((section) => section.id === "status")
      ?.onChange("READY");

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    expect(updates).toContain("timezone=UTC&status=READY");
  });

  it.each(["workspace:workspace-1", "legacy:calendar-1"])(
    "stores the selected non-Project source %s in the Calendar URL",
    async (sourceId) => {
      const onUrlUpdate = vi.fn();
      render(
        <NuqsTestingAdapter
          onUrlUpdate={onUrlUpdate}
          searchParams="?timezone=UTC&projectId=project-1"
        >
          <WorkspaceCalendar
            initialDate="2026-08-18"
            items={[...ITEMS, LEGACY_ITEM]}
            sources={SOURCES}
          />
        </NuqsTestingAdapter>,
      );

      const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
        sections: Array<{
          id: string;
          onChange: (value: string | null) => void;
        }>;
      };
      const sourceSection = props.sections.find(
        (section) => section.id === "source",
      );
      expect(sourceSection).toBeDefined();

      sourceSection?.onChange(sourceId);

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
      expect(
        onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("sourceId"),
      ).toBe(sourceId);
      expect(
        onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("projectId"),
      ).toBeNull();
    },
  );

  it("stores Project source selections in the Calendar URL", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?timezone=UTC&sourceId=legacy%3Acalendar-1"
      >
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={ITEMS}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        onChange: (value: string | null) => void;
      }>;
    };
    props.sections
      .find((section) => section.id === "source")
      ?.onChange("project:project-1");

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    expect(
      onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("projectId"),
    ).toBe("project-1");
    expect(
      onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("sourceId"),
    ).toBeNull();
  });

  it("clears both Calendar source query filters when selecting all sources", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?timezone=UTC&projectId=project-1&sourceId=legacy%3Acalendar-1"
      >
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={ITEMS}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{
        id: string;
        onChange: (value: string | null) => void;
      }>;
    };
    props.sections.find((section) => section.id === "source")?.onChange(null);

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    expect(
      onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("projectId"),
    ).toBeNull();
    expect(
      onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("sourceId"),
    ).toBeNull();
  });

  it("persists view and date in the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        searchParams="?view=month&date=2026-08-18"
        onUrlUpdate={onUrlUpdate}
      >
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("tab", { name: "view.week" }));
    await user.click(screen.getByRole("button", { name: "next" }));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    const updatedQuery = updates.join("&");
    expect(updatedQuery).toContain("view=week");
    expect(updatedQuery).toContain("date=2026-");
  });

  it("uses the timezone from the URL", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=America%2FNew_York">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{ id: string; value: string | null }>;
    };
    expect(
      props.sections.find((section) => section.id === "timezone")?.value,
    ).toBe("America/New_York");
  });

  it("persists the detected timezone when the URL has none", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get("timezone")).toBe(
      getDefaultTimezone(),
    );
  });

  it("replaces an invalid timezone with the detected timezone", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?timezone=Invalid%2FTimezone"
      >
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get("timezone")).toBe(
      getDefaultTimezone(),
    );
  });

  it("defaults the mobile Calendar to the agenda view", async () => {
    const mediaQuery: MediaQueryList = {
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal("innerWidth", 767);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQuery),
    );

    try {
      render(
        <NuqsTestingAdapter searchParams="?timezone=UTC">
          <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
        </NuqsTestingAdapter>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("calendar-agenda")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("calendar-week")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows upcoming planned tasks from today across months, without date navigation", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2025-01-01&timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[
            {
              ...ITEMS[0],
              id: "later",
              taskName: "Next month",
              scheduledAt: new Date("2026-09-02T09:00:00Z"),
            },
            {
              ...ITEMS[0],
              id: "past",
              taskName: "Yesterday",
              scheduledAt: new Date("2026-08-17T09:00:00Z"),
            },
            {
              ...ITEMS[0],
              id: "released",
              state: "RELEASED",
              taskName: "Already ran",
            },
            ITEMS[0],
          ]}
        />
      </NuqsTestingAdapter>,
    );
    expect(
      screen.getByRole("heading", { name: "agenda.upcoming" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("calendar-event").map((card) => card.textContent),
    ).toEqual([
      expect.stringContaining("Prepare release notes"),
      expect.stringContaining("Next month"),
    ]);
    expect(
      screen.queryByRole("button", { name: "previous" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "next" }),
    ).not.toBeInTheDocument();
  });

  it("starts on the nearest upcoming day when today is empty", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={[
            { ...ITEMS[0], scheduledAt: new Date("2026-09-02T09:00:00Z") },
          ]}
        />
      </NuqsTestingAdapter>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "September 2, 2026",
    );
    expect(screen.queryByText("August 18, 2026")).not.toBeInTheDocument();
  });

  it("loads ten more Runs only when the agenda boundary becomes visible", async () => {
    let showBoundary = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (
        callback: (entries: { isIntersecting: boolean }[]) => void,
      ) {
        showBoundary = () => callback([{ isIntersecting: true }]);
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      ...ITEMS[0],
      id: `item-${index}`,
      taskName: `Task ${index}`,
    }));
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [
        firstPage[0],
        {
          ...ITEMS[0],
          id: "later",
          taskName: "Next month",
          scheduledAt: new Date("2026-09-02T09:00:00Z"),
        },
      ],
      meta: { pagination: { nextCursor: null } },
    });
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&timezone=UTC">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={firstPage}
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );
    expect(screen.getAllByTestId("calendar-event")).toHaveLength(10);
    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    await act(async () => showBoundary());
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-2", limit: 10 }),
    );
    expect(screen.getAllByTestId("calendar-event")).toHaveLength(11);
    expect(screen.getByText("Next month")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "schedules.loadMore" }),
    ).not.toBeInTheDocument();
  });

  it("keeps loaded agenda items on failure and retries with the project and filters", async () => {
    getProjectCalendarMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: [{ ...ITEMS[0], id: "later", taskName: "Later task" }],
        meta: { pagination: { nextCursor: null } },
      });
    render(
      <NuqsTestingAdapter searchParams="?view=agenda&timezone=UTC&scope=owned&assigneeId=coworker-1">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={ITEMS}
          lockedProjectId="project-1"
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "schedules.loadMore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "pagination.error",
    );
    expect(screen.getByText("Prepare release notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "schedules.loadMore" }));
    await screen.findByText("Later task");
    expect(getProjectCalendarMock).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        scope: "owned",
        assigneeId: "coworker-1",
        limit: 10,
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("defaults to the week view and offers every view switch", () => {
    render(
      <NuqsTestingAdapter searchParams="?date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("calendar-week")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-month")).not.toBeInTheDocument();
    expect(screen.getByTestId("calendar-views")).toHaveTextContent("view.week");
  });

  it("uses event cards without the all-day row in the week view", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("calendar-week")).toHaveAttribute(
      "data-view",
      "week",
    );
    expect(screen.getByTestId("calendar-event")).toHaveClass(
      "bg-background",
      "border",
    );
    expect(screen.queryByText("all-day")).not.toBeInTheDocument();
  });

  it("fetches the next page when pagination.nextCursor changes on the same items reference", async () => {
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    const { rerender } = render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
          pagination={{ limit: 100, nextCursor: null }}
          range={CALENDAR_PAGE.range}
        />
      </NuqsTestingAdapter>,
    );

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();

    // Same `items` reference, but a fresh `pagination` object reporting more
    // pages are now available — the render-time guard must react to this
    // even though `items` itself did not change.
    rerender(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
          pagination={{ limit: 100, nextCursor: "cursor-2" }}
          range={CALENDAR_PAGE.range}
        />
      </NuqsTestingAdapter>,
    );

    await waitFor(() =>
      expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "cursor-2" }),
      ),
    );
  });

  it("loads and renders the next calendar page without being asked", async () => {
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [
        {
          ...LEGACY_ITEM,
          id: "run-2",
          taskName: "Publish release notes",
        },
      ],
      meta: {
        pagination: {
          cursor: "cursor-2",
          limit: 100,
          total: 101,
          nextCursor: null,
        },
      },
    });

    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&sourceId=legacy%3Acalendar-1">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    expect(await screen.findAllByText("Publish release notes")).toHaveLength(1);
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      cursor: "cursor-2",
      limit: 100,
      scope: "workspace",
      assigneeId: undefined,
      status: undefined,
      sourceId: "legacy:calendar-1",
    });
  });

  it.each(["onAccessRevoked", "onResync", "onInvalidated"] as const)(
    "rejects pending pages after %s",
    async (callback) => {
      let resolvePage: ((value: unknown) => void) | undefined;
      getWorkspaceCalendarMock.mockReturnValue(
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
      );
      render(
        <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&timezone=UTC">
          <WorkspaceCalendar
            currentUserId="user-1"
            initialDate="2026-08-18"
            items={ITEMS}
            sources={SOURCES}
            workspaceId="workspace-1"
            {...CALENDAR_PAGE}
          />
        </NuqsTestingAdapter>,
      );

      // The drain already asked for the next page; the answer arrives after
      // access is gone.
      expect(getWorkspaceCalendarMock).toHaveBeenCalledTimes(1);
      const bridgeProps = calendarRealtimeBridgeMock.mock.calls.at(-1)?.[0] as {
        onAccessRevoked: () => void;
        onResync: () => void;
        onInvalidated: () => void;
      };
      act(() => {
        bridgeProps[callback]();
      });
      await act(async () => {
        resolvePage?.({
          data: [
            {
              ...ITEMS[0],
              id: "run-after-revoke",
              taskName: "Secret after revoke",
            },
          ],
          meta: { pagination: { nextCursor: null } },
        });
        await Promise.resolve();
      });

      expect(screen.queryByText(/Secret after revoke/)).not.toBeInTheDocument();
    },
  );

  it("rejects a previous snapshot's pending page after a server refresh", async () => {
    let resolvePage: ((value: unknown) => void) | undefined;
    getWorkspaceCalendarMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    );
    function calendar(
      items: WorkspaceCalendarItem[],
      nextCursor: string | null,
    ) {
      return (
        <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18&timezone=UTC">
          <WorkspaceCalendar
            currentUserId="user-1"
            initialDate="2026-08-18"
            items={items}
            sources={SOURCES}
            workspaceId="workspace-1"
            range={CALENDAR_PAGE.range}
            pagination={{ limit: 100, nextCursor }}
          />
        </NuqsTestingAdapter>
      );
    }
    const view = render(calendar(ITEMS, "cursor-2"));
    expect(getWorkspaceCalendarMock).toHaveBeenCalledOnce();
    view.rerender(calendar([], null));
    await act(async () => {
      resolvePage?.({
        data: [{ ...ITEMS[0], id: "removed-run", taskName: "Removed task" }],
        meta: { pagination: { nextCursor: null } },
      });
    });
    expect(screen.queryByText(/Removed task/)).not.toBeInTheDocument();
  });

  it("loads more Project Calendar items through the Project endpoint", async () => {
    getProjectCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });

    render(
      <NuqsTestingAdapter searchParams="?assigneeId=coworker-1&scope=owned&status=QUEUED&projectId=project-2&sourceId=workspace%3Aworkspace-1">
        <WorkspaceCalendar
          initialDate="2026-08-18"
          items={ITEMS}
          lockedProjectId="project-1"
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    await waitFor(() =>
      expect(getProjectCalendarMock).toHaveBeenCalledWith("project-1", {
        from: new Date("2026-08-01T00:00:00.000Z"),
        to: new Date("2026-09-01T00:00:00.000Z"),
        cursor: "cursor-2",
        limit: 100,
        scope: "owned",
        assigneeId: "coworker-1",
        status: "QUEUED",
      }),
    );
  });

  it("shows an empty state after filters exclude all calendar items", () => {
    render(
      <NuqsTestingAdapter searchParams="?assigneeId=coworker-2">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("empty.title")).toBeInTheDocument();
  });

  it("lists each Task Schedule once in the Schedules view", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=schedules&timezone=UTC">
        <WorkspaceCalendar
          coworkers={ROSTER}
          items={[]}
          initialDate="2026-08-18"
          schedules={[
            buildSchedule({ assigneeUserId: "user-2" }),
            buildSchedule({
              id: "schedule-2",
              name: "Publish every Monday",
              state: "PAUSED",
              nextRunAt: null,
              projectId: "project-1",
            }),
          ]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      screen.getByRole("tab", { name: "view.schedules" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("calendar-schedule-row")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Daily standup notes" }),
    ).toHaveAttribute("href", "/tasks/schedules/schedule-1");
    expect(
      screen.getByRole("link", { name: "Publish every Monday" }),
    ).toHaveAttribute("href", "/tasks/schedules/schedule-2");
    expect(screen.getByText("Release planning")).toBeInTheDocument();
    expect(screen.getByText("state.PAUSED")).toBeInTheDocument();
    expect(screen.getByText("schedules.noNextRun")).toBeInTheDocument();
    expect(screen.getAllByTestId("calendar-source-marker")).toHaveLength(2);
    expect(screen.getByTitle("Grace Hopper, Ada")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-week")).not.toBeInTheDocument();
  });

  it("persists the Schedules view in the Calendar URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();

    render(
      <NuqsTestingAdapter
        onUrlUpdate={onUrlUpdate}
        searchParams="?view=week&date=2026-08-18"
      >
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("tab", { name: "view.schedules" }));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    expect(updates.join("&")).toContain("view=schedules");
  });

  it("keeps only the time zone filter in the Schedules view", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=schedules&timezone=UTC">
        <WorkspaceCalendar
          activeOrganizationId="org-1"
          items={[]}
          initialDate="2026-08-18"
          schedules={[buildSchedule()]}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    const props = filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
      sections: Array<{ id: string }>;
    };
    expect(props.sections.map((section) => section.id)).toEqual(["timezone"]);
  });

  it("shows the schedules empty state without the Run empty state", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=schedules&timezone=UTC">
        <WorkspaceCalendar
          currentUserId="user-1"
          items={[]}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.queryByText("empty.title")).not.toBeInTheDocument();
  });

  it("loads the next Task Schedules page on demand", async () => {
    const user = userEvent.setup();
    listTaskSchedulesMock.mockResolvedValue({
      data: [buildSchedule({ id: "schedule-2", name: "Second schedule" })],
      meta: {
        pagination: {
          cursor: "cursor-2",
          limit: 100,
          total: 2,
          nextCursor: null,
        },
      },
    });

    render(
      <NuqsTestingAdapter searchParams="?view=schedules&timezone=UTC&projectId=project-1">
        <WorkspaceCalendar
          items={[]}
          initialDate="2026-08-18"
          schedules={[buildSchedule()]}
          schedulesPagination={{ limit: 100, nextCursor: "cursor-2" }}
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "schedules.loadMore" }),
    );

    expect(await screen.findByText("Second schedule")).toBeInTheDocument();
    expect(screen.getAllByTestId("calendar-schedule-row")).toHaveLength(2);
    expect(listTaskSchedulesMock).toHaveBeenCalledWith({
      projectId: "project-1",
      cursor: "cursor-2",
      limit: 100,
    });
    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
  });

  it("renders loading and retry states", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const { unmount } = render(<CalendarLoading />);

    expect(screen.getByLabelText("Loading calendar")).toBeInTheDocument();

    unmount();
    render(
      <CalendarError error={new Error("Core unavailable")} reset={reset} />,
    );

    await user.click(screen.getByRole("button", { name: "error.retry" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
