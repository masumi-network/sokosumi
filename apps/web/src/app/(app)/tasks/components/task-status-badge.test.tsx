import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TaskStatus } from "@/lib/clients/generated/core";

describe("TaskStatusBadge", () => {
  it("applies the warning ramp to the approval-required icon", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.APPROVAL_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3.5",
      "text-semantic-warning",
    );
  });

  it("applies the attention ramp to the input-required icon", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.INPUT_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3.5",
      "text-semantic-warning",
    );
  });

  it("applies the attention ramp to the out-of-credits icon", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.OUT_OF_CREDITS} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3.5",
      "text-semantic-warning",
    );
  });
});
