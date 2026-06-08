import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobStatusBadge } from "@/components/jobs/job-status-badge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("JobStatusBadge", () => {
  it("renders dot and label by default", () => {
    const { container } = render(
      <JobStatusBadge
        status={SokosumiJobStatus.COMPLETED}
        jobType={JobType.FREE}
      />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(
      container.querySelector("span[aria-hidden='true']"),
    ).toBeInTheDocument();
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
});
