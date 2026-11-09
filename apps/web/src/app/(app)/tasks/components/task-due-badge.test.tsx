import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createFormats } from "@/i18n/time-format";
import en from "@/messages/en.json";
import { TaskDueBadge } from "./task-due-badge";

// 03:00 UTC on Nov 10 is still Nov 9 in Los Angeles.
const NOW = new Date("2026-11-10T03:00:00.000Z");

function intl(children: ReactNode, timeZone = "UTC") {
  return (
    <NextIntlClientProvider
      locale="en"
      timeZone={timeZone}
      now={NOW}
      formats={createFormats()}
      messages={{ App: { Tasks: { Due: en.App.Tasks.Due } } }}
    >
      {children}
    </NextIntlClientProvider>
  );
}

describe("TaskDueBadge", () => {
  it("shows the due day while it has not passed", () => {
    render(intl(<TaskDueBadge dueOn="2026-11-20" status="RUNNING" />));

    expect(screen.getByText("Due Nov 20")).toHaveAttribute(
      "datetime",
      "2026-11-20",
    );
  });

  it("says Overdue once the day has passed and the work is unfinished", () => {
    render(intl(<TaskDueBadge dueOn="2026-11-09" status="INPUT_REQUIRED" />));

    expect(screen.getByText("Overdue · Nov 9")).toBeInTheDocument();
  });

  it("judges the day in the reader's time zone", () => {
    render(
      intl(
        <TaskDueBadge dueOn="2026-11-09" status="RUNNING" />,
        "America/Los_Angeles",
      ),
    );

    expect(screen.getByText("Due Nov 9")).toBeInTheDocument();
  });

  it("never says Overdue on completed work", () => {
    render(intl(<TaskDueBadge dueOn="2026-11-01" status="COMPLETED" />));

    expect(screen.getByText("Due Nov 1")).toBeInTheDocument();
  });
});
