import { TaskStatus } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";

describe("TaskStatusBadge", () => {
  it("applies status text color to warning icons", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.APPROVAL_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3",
      "text-amber-600",
      "dark:text-amber-400",
    );
  });

  it("applies destructive text color to input required warning icon", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.INPUT_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3",
      "text-destructive",
    );
  });

  it("applies destructive text color to out of credits warning icon", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.OUT_OF_CREDITS} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3",
      "text-destructive",
    );
  });
});
