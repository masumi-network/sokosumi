import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jobDetailsLoaderMock = vi.fn();
const jobDetailsModalMock = vi.fn();

vi.mock("@/app/agents/[agentId]/jobs/_lib/job-details-loader", () => ({
  JobDetailsLoader: ({
    agentId,
    jobId,
    children,
  }: {
    agentId: string;
    jobId: string;
    children: (props: { job: { id: string } }) => React.ReactNode;
  }) => {
    jobDetailsLoaderMock({ agentId, jobId });
    return (
      <div data-testid="job-details-loader">
        {children({ job: { id: "job-1" } })}
      </div>
    );
  },
}));

vi.mock("@/app/agents/[agentId]/jobs/components/job-details-modal", () => ({
  JobDetailsModal: (props: unknown) => {
    jobDetailsModalMock(props);
    return <div data-testid="job-details-modal" />;
  },
}));

describe("JobDetailsModalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the shared job details view as a modal", async () => {
    const { default: JobDetailsModalPage } = await import("./page");

    render(
      await JobDetailsModalPage({
        params: Promise.resolve({
          agentId: "agent-1",
          jobId: "job-1",
        }),
      }),
    );

    expect(jobDetailsLoaderMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      jobId: "job-1",
    });
    expect(jobDetailsModalMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      job: { id: "job-1" },
    });
    expect(screen.getByTestId("job-details-loader")).toBeInTheDocument();
    expect(screen.getByTestId("job-details-modal")).toBeInTheDocument();
  });
});
