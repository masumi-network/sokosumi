import { TaskStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskStatusAge } from "./task-status-age";

const NOW = new Date("2026-11-14T12:00:00.000Z");

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useNow: () => NOW,
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({ date }: { date: string }) => <time>{date}</time>,
}));

describe("TaskStatusAge", () => {
  it("says how long a waiting Task has been in its status", () => {
    render(
      <TaskStatusAge
        status={TaskStatus.INPUT_REQUIRED}
        statusSince="2026-11-14T11:58:00.000Z"
      />,
    );

    expect(screen.getByText("label")).toHaveClass("sr-only");
    expect(screen.queryByText("stuck")).toBeNull();
    expect(screen.getByText("2026-11-14T11:58:00.000Z")).toBeTruthy();
  });

  it("says Stuck after three days in one status", () => {
    render(
      <TaskStatusAge
        status={TaskStatus.READY}
        statusSince="2026-11-08T09:00:00.000Z"
      />,
    );

    expect(screen.getByText("stuck")).not.toHaveClass("sr-only");
  });

  it("shows nothing for Tasks that are not waiting", () => {
    const { container } = render(
      <TaskStatusAge
        status={TaskStatus.COMPLETED}
        statusSince="2026-11-01T09:00:00.000Z"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
