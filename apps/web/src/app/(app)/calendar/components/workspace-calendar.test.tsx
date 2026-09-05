import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
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
} = vi.hoisted(() => ({
  filterDropdownMenuMock: vi.fn(),
  getProjectCalendarMock: vi.fn(),
  getWorkspaceCalendarMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(value),
  }),
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "event.accessibleName" ? `${values?.task}, ${values?.source}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
    taskName: "Prepare release notes",
    taskStatus: "QUEUED",
    taskAssigneeId: "coworker-1",
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
      <NuqsTestingAdapter>
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

    expect(screen.getAllByTestId("calendar-month")[0]).toHaveClass(
      "workspace-calendar-theme",
    );
  });

  it("sets transparent classic events for the week theme", () => {
    const styles = readFileSync(
      new URL("../../../globals.css", import.meta.url).pathname.slice(1),
      "utf8",
    );

    expect(styles).toMatch(
      /\.workspace-calendar-theme\[data-view="week"\]\s*\{[^}]*--fc-classic-event:\s*transparent;/,
    );
  });

  it("disables forward navigation beyond the supplied calendar horizon", () => {
    render(
      <NuqsTestingAdapter>
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

    expect(screen.getAllByTestId("calendar-agenda")).toHaveLength(2);
    expect(screen.getAllByText("Release planning")).toHaveLength(2);
    expect(screen.getAllByTestId("calendar-source-marker")).toHaveLength(2);
    expect(screen.getAllByText("accuracy.inferred")).toHaveLength(2);
    expect(screen.queryByText("accuracy.approximate")).not.toBeInTheDocument();
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

      expect(screen.getAllByLabelText("accuracy.inferred")).toHaveLength(2);
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
        options?: Array<{ label: string; value: string }>;
      }>;
    };
    expect(props.sections.map((section) => section.id)).toEqual([
      "scope",
      "source",
      "coworker",
      "status",
      "timezone",
    ]);
    expect(
      props.sections.find((section) => section.id === "source")?.options,
    ).toEqual([
      { label: "Ada's workspace", value: "workspace:workspace-1" },
      { label: "Release planning", value: "project:project-1" },
      { label: "Imported calendar", value: "legacy:calendar-1" },
    ]);

    props.sections.find((section) => section.id === "scope")?.onChange("owned");
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));

    const updates = onUrlUpdate.mock.calls.map(([event]) =>
      event.searchParams.toString(),
    );
    expect(new URLSearchParams(updates.at(-1)).get("scope")).toBe("owned");
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

    await user.click(screen.getByRole("button", { name: "view.week" }));
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

  it("defaults the mobile Calendar to month so empty dates can create tasks", async () => {
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
        expect(screen.getAllByTestId("calendar-month")).toHaveLength(2),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("honors an explicit week view on mobile", () => {
    render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-week")).toHaveLength(2);
    expect(screen.queryByTestId("calendar-month")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-calendar-views")).not.toHaveTextContent(
      "view.week",
    );
  });

  it("uses event cards without the all-day row in the week view", () => {
    const { container } = render(
      <NuqsTestingAdapter searchParams="?view=week&date=2026-08-18">
        <WorkspaceCalendar items={ITEMS} initialDate="2026-08-18" />
      </NuqsTestingAdapter>,
    );

    expect(screen.getAllByTestId("calendar-week")[0]).toHaveAttribute(
      "data-view",
      "week",
    );
    expect(container.querySelector("[class~='bg-primary/10']")).toHaveClass(
      "bg-primary/10",
    );
    expect(screen.queryByText("all-day")).not.toBeInTheDocument();
  });

  it("loads and renders the next calendar page", async () => {
    const user = userEvent.setup();
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

    await user.click(
      screen.getByRole("button", { name: "pagination.loadMore" }),
    );

    expect(
      await screen.findAllByRole("button", { name: /Publish release notes/ }),
    ).toHaveLength(2);
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
    const user = userEvent.setup();
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

    await user.click(
      screen.getByRole("button", { name: "pagination.loadMore" }),
    );

    expect(getProjectCalendarMock).toHaveBeenCalledWith("project-1", {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      cursor: "cursor-2",
      limit: 100,
      scope: "owned",
      assigneeId: "coworker-1",
      status: "QUEUED",
    });
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
