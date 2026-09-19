import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TaskStatusBadge,
  TaskStatusInline,
} from "@/app/tasks/components/task-status-badge";
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

  /**
   * The badge used to take a `live={false}` and hold the glyph still. A
   * stopped `LoaderCircle` is an arc with a gap in it, so at rest it read as a
   * rendering fault rather than as a status. A history row draws the inline
   * form instead: a dot, which was never moving, and the status word.
   */
  it("draws the historic form as a dot and a word, with no glyph", () => {
    const { container } = render(
      <TaskStatusInline status={TaskStatus.RUNNING} />,
    );

    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("Running");
    expect(container.querySelector("span[aria-hidden]")).toHaveClass(
      "rounded-full",
      "bg-status-working",
    );
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
