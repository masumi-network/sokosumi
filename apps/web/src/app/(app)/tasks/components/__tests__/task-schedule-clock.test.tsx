import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskScheduleClock } from "@/app/tasks/components/task-schedule-clock";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

describe("TaskScheduleClock", () => {
  it("renders a clock with the schedule label when metadata has a one-time schedule", () => {
    const metadata = JSON.stringify({
      version: 1,
      mode: "once",
      scheduledAt: "2026-06-24T12:00:00.000Z",
      runAt: "2026-06-25T09:00:00.000Z",
    });

    render(<TaskScheduleClock metadata={metadata} />);

    expect(
      screen.getByRole("button", { name: "footer.oneTimeAt" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no schedule metadata", () => {
    const { container } = render(<TaskScheduleClock metadata={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
