import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TaskStatus } from "@/lib/clients/generated/core";

describe("TaskStatusBadge", () => {
  /**
   * The spin is the one part of the badge that makes a claim about time: it
   * says the work is in flight as you read it. A history row shows a status
   * someone set hours ago, so the same glyph has to hold still there.
   */
  it("spins the running glyph while the badge shows the status now", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.RUNNING} />,
    );

    expect(container.querySelector("svg")).toHaveClass("animate-spin");
  });

  it("holds the running glyph still when the badge is not live", () => {
    const { container } = render(
      <TaskStatusBadge status={TaskStatus.RUNNING} live={false} />,
    );

    const glyph = container.querySelector("svg");
    expect(glyph).not.toHaveClass("animate-spin");
    // Same glyph, same box, same colour. Only the motion is gone.
    expect(glyph).toHaveClass("size-3.5", "text-status-working");
  });

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
