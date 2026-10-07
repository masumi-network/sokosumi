import { TaskPriority } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskPriorityIcon } from "./task-priority-icon";

function bars(container: HTMLElement) {
  return Array.from(container.querySelectorAll("rect")).map((rect) =>
    rect.getAttribute("opacity"),
  );
}

describe("TaskPriorityIcon", () => {
  it.each([
    [TaskPriority.LOW, ["1", "0.3", "0.3"]],
    [TaskPriority.MEDIUM, ["1", "1", "0.3"]],
    [TaskPriority.HIGH, ["1", "1", "1"]],
  ])("%s fills the matching number of bars", (priority, expected) => {
    const { container } = render(<TaskPriorityIcon priority={priority} />);

    expect(bars(container)).toEqual(expected);
  });

  it("NONE is three muted dashes", () => {
    const { container } = render(
      <TaskPriorityIcon priority={TaskPriority.NONE} />,
    );

    expect(container.querySelectorAll("rect")).toHaveLength(3);
    expect(container.querySelector("svg")).toHaveClass("text-muted-foreground");
  });

  it("URGENT is a single destructive shape", () => {
    const { container } = render(
      <TaskPriorityIcon priority={TaskPriority.URGENT} />,
    );

    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(container.querySelector("svg")).toHaveClass("text-destructive");
  });

  it("is decorative unless it has a label", () => {
    const { container, rerender } = render(
      <TaskPriorityIcon priority={TaskPriority.HIGH} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    rerender(<TaskPriorityIcon priority={TaskPriority.HIGH} label="High" />);
    expect(container.querySelector("svg")).toHaveAttribute("role", "img");
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-label",
      "High",
    );
  });
});
