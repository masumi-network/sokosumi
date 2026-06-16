import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { getJobStatusDotColorClass } from "@/components/jobs/job-status-styles";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("JobStatusBadge", () => {
  it("renders a pill badge with label by default", () => {
    const { container } = render(
      <JobStatusBadge
        status={SokosumiJobStatus.COMPLETED}
        jobType={JobType.FREE}
      />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("rounded-sm", "px-2.5", "py-1");
  });

  it("uses distinct dot colors for completed and processing jobs", () => {
    expect(getJobStatusDotColorClass(SokosumiJobStatus.COMPLETED)).toBe(
      "bg-stone-500",
    );
    expect(getJobStatusDotColorClass(SokosumiJobStatus.PROCESSING)).toBe(
      "bg-emerald-500",
    );
  });

  it("renders dot-only version when variant is dot", () => {
    const { container } = render(
      <JobStatusBadge
        status={SokosumiJobStatus.COMPLETED}
        jobType={JobType.FREE}
        variant="dot"
      />,
    );

    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(
      container.querySelector("span[aria-label='completed']"),
    ).toBeInTheDocument();
  });

  it("applies status text color to warning icon", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.INPUT_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3",
      "text-destructive",
    );
  });
});
