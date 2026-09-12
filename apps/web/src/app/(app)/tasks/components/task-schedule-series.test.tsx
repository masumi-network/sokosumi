import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskScheduleSeries } from "@/app/tasks/components/task-schedule-series";

const labels = {
  title: "Schedule",
  calendar: "Calendar",
  repeats: "Repeats",
  timezone: "Time zone",
  nextRun: "Next run",
  removed: "This schedule was removed. Past runs stay below.",
};

function renderSeries(
  overrides: Partial<React.ComponentProps<typeof TaskScheduleSeries>> = {},
) {
  return render(
    <TaskScheduleSeries
      labels={labels}
      calendar={{
        name: "Q3 launch",
        href: "/projects/project_1/calendar",
        sourceLabel: "Project",
      }}
      recurrenceLabel="Daily (09:00)"
      timezone="Europe/Berlin"
      nextRunLabel="Sep 10, 9:00 AM"
      isActive
      {...overrides}
    />,
  );
}

describe("TaskScheduleSeries", () => {
  it("names the Calendar source and links to it", () => {
    renderSeries();

    const calendar = screen.getByRole("link", { name: /Q3 launch/ });
    expect(calendar).toHaveAttribute("href", "/projects/project_1/calendar");
    expect(screen.getByText("Project")).toBeInTheDocument();
  });

  it("shows the recurrence rule, its time zone, and the next run", () => {
    renderSeries();

    expect(
      screen.getByRole("heading", { name: "Schedule" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Daily (09:00)")).toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
    expect(screen.getByText("Sep 10, 9:00 AM")).toBeInTheDocument();
    expect(
      screen.queryByText("This schedule was removed. Past runs stay below."),
    ).toBeNull();
  });

  it("pairs every label with its value in a definition list", () => {
    renderSeries();

    for (const [label, value] of [
      ["Repeats", "Daily (09:00)"],
      ["Time zone", "Europe/Berlin"],
      ["Next run", "Sep 10, 9:00 AM"],
    ]) {
      const term = screen.getByText(label);
      expect(term.tagName).toBe("DT");
      expect(
        within(term.parentElement as HTMLElement).getByText(value),
      ).toBeInTheDocument();
    }
  });

  it("says the series was removed and drops the rule rows, keeping the source", () => {
    renderSeries({
      isActive: false,
      recurrenceLabel: null,
      timezone: null,
      nextRunLabel: null,
      calendar: {
        name: "Acme Corp",
        href: "/calendar",
        sourceLabel: "Workspace",
      },
    });

    expect(
      screen.getByText("This schedule was removed. Past runs stay below."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(screen.queryByText("Repeats")).toBeNull();
    expect(screen.queryByText("Next run")).toBeNull();
  });

  it("renders the occurrence tabs it is given", () => {
    renderSeries({ children: <p>occurrences slot</p> });

    expect(screen.getByText("occurrences slot")).toBeInTheDocument();
  });
});
