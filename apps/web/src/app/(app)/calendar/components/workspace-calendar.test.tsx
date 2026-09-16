import {
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
import { describe, expect, it, vi } from "vitest";
import type {
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
  filterDropdownMenuMock,
  getProjectCalendarMock,
  getWorkspaceCalendarMock,
  pushMock,
  refreshMock,
} = vi.hoisted(() => ({
  filterDropdownMenuMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
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
  },
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="calendar-filters" />;
  },
}));

const ITEMS: WorkspaceCalendarItem[] = [
  {
    id: "occurrence-1",
    taskId: "task-1",
    canEditSchedule: true,
    canMutateOccurrence: true,
    scheduleRevision: 3,
    taskName: "Prepare release notes",
    taskStatus: "QUEUED",
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
  id: "occurrence-legacy-1",
  taskId: "task-legacy-1",
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

  it("places the schedule action at the right edge of the toolbar", () => {
    render(
      <NuqsTestingAdapter searchParams="?timezone=UTC">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          sources={SOURCES}
        />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByRole("button", { name: "create.title" })).toHaveClass(
      "ml-auto",
    );
  });

  it("shows a plus icon before the schedule action label", () => {
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
      screen.getByRole("button", { name: "create.title" }).firstElementChild,
    ).toHaveClass("lucide-plus");
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

  it("scrolls the agenda to today's day header", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    try {
      render(
        <NuqsTestingAdapter
          searchParams={`?view=agenda&date=${today}&timezone=UTC`}
        >
          <WorkspaceCalendar
            initialDate={today}
            items={[
              {
                ...ITEMS[0],
                scheduledAt: new Date(`${today}T09:00:00.000Z`),
                originalScheduledAt: new Date(`${today}T09:00:00.000Z`),
              },
            ]}
          />
        </NuqsTestingAdapter>,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.instances[0]).toHaveAttribute(
        "data-date",
        today,
      );
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("scrolls the agenda to the next day header when today has no events", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const today = Temporal.Now.plainDateISO("UTC");
    const tomorrow = today.add({ days: 1 }).toString();

    try {
      render(
        <NuqsTestingAdapter
          searchParams={`?view=agenda&date=${today.toString()}&timezone=UTC`}
        >
          <WorkspaceCalendar
            initialDate={today.toString()}
            items={[
              {
                ...ITEMS[0],
                scheduledAt: new Date(`${tomorrow}T09:00:00.000Z`),
                originalScheduledAt: new Date(`${tomorrow}T09:00:00.000Z`),
              },
            ]}
          />
        </NuqsTestingAdapter>,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.instances[0]).toHaveAttribute(
        "data-date",
        tomorrow,
      );
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("offers Today at the top of the agenda and Back to top once scrolled", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("scrollY", 0);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    try {
      render(
        <NuqsTestingAdapter
          searchParams={`?view=agenda&date=${today}&timezone=UTC`}
        >
          <WorkspaceCalendar
            initialDate={today}
            items={[
              {
                ...ITEMS[0],
                scheduledAt: new Date(`${today}T09:00:00.000Z`),
                originalScheduledAt: new Date(`${today}T09:00:00.000Z`),
              },
            ]}
          />
        </NuqsTestingAdapter>,
      );

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockClear();
      await user.click(screen.getByRole("button", { name: "agenda.today" }));
      expect(scrollIntoView.mock.instances[0]).toHaveAttribute(
        "data-date",
        today,
      );

      vi.stubGlobal("scrollY", 400);
      fireEvent.scroll(window);
      await user.click(
        await screen.findByRole("button", { name: "agenda.backToTop" }),
      );
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0 }),
      );
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.unstubAllGlobals();
    }
  });

  // globals.css hides the agenda's list-item dot with a structural selector
  // because FullCalendar joins class-name options across theme and user
  // layers. Pin the DOM shape that selector relies on.
  it("keeps the agenda dot as the first child before the event card", () => {
    const { container } = render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    const dots = container.querySelectorAll(
      '[data-view="agenda"] [role="listitem"]:not([aria-label]) > :first-child:not(:only-child)',
    );
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.querySelector('[data-testid="calendar-event"]')).toBeNull();
      expect(
        dot.nextElementSibling?.querySelector('[data-testid="calendar-event"]'),
      ).not.toBeNull();
    }
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
    const { container } = render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("calendar-week")).toHaveAttribute(
      "data-view",
      "week",
    );
    expect(
      container.querySelector("[class~='bg-primary-quaternary']"),
    ).toHaveClass("bg-primary-quaternary");
    expect(screen.queryByText("all-day")).not.toBeInTheDocument();
  });

  it("fetches the next page when pagination.nextCursor changes on the same items reference", async () => {
    getWorkspaceCalendarMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    const { rerender } = render(
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
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
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&timezone=UTC">
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
          id: "occurrence-2",
          taskId: "task-2",
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
      <NuqsTestingAdapter searchParams="?view=agenda&date=2026-08-18&status=QUEUED&sourceId=legacy%3Acalendar-1">
        <WorkspaceCalendar
          items={ITEMS}
          initialDate="2026-08-18"
          {...CALENDAR_PAGE}
        />
      </NuqsTestingAdapter>,
    );

    expect(
      await screen.findAllByRole("button", { name: /Publish release notes/ }),
    ).toHaveLength(1);
    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      cursor: "cursor-2",
      limit: 100,
      scope: "workspace",
      assigneeId: undefined,
      status: "QUEUED",
      sourceId: "legacy:calendar-1",
    });
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
