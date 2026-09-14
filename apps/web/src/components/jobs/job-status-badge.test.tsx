import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { getJobStatusDotColorClass } from "@/components/jobs/job-status-styles";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("JobStatusBadge", () => {
  it("renders a pill badge with label by default", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.COMPLETED} />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("rounded-sm", "px-2.5", "py-1");
  });

  it("uses distinct dot colors for completed and processing jobs", () => {
    expect(getJobStatusDotColorClass(SokosumiJobStatus.COMPLETED)).toBe(
      "bg-semantic-success",
    );
    expect(getJobStatusDotColorClass(SokosumiJobStatus.PROCESSING)).toBe(
      "bg-status-active",
    );
  });

  it("renders dot-only version when variant is dot", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.COMPLETED} variant="dot" />,
    );

    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(
      container.querySelector("span[aria-label='completed']"),
    ).toBeInTheDocument();
  });

  /**
   * The compact variant has no fill behind it, so the glyph cannot wear
   * `marker`, which is the colour of the label ON the fill. For the failure
   * role that label is near-white and measured 1.06:1 on --card-background.
   * COMPLETED cannot catch this, because its marker and its surface colour
   * are the same token; only a solid-fill role can.
   */
  it("colours the compact failure mark against the surface, not the fill", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.FAILED} variant="dot" />,
    );

    const glyph = container.querySelector("svg");
    expect(glyph).toHaveClass("text-semantic-destructive-solid");
    expect(glyph).not.toHaveClass("text-semantic-destructive-foreground");
  });

  it("applies the attention ramp to the input-required icon", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.INPUT_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3.5",
      "text-semantic-warning",
    );
  });
});
