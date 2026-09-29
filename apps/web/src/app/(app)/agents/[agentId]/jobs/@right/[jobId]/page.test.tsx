import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jobDetailsLoaderMock = vi.fn();
const jobDetailsMock = vi.fn();

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

vi.mock("@/components/jobs/job-details/job-details", () => ({
  default: (props: unknown) => {
    jobDetailsMock(props);
    return <div data-testid="job-details" />;
  },
}));

describe("JobDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the shared job details view as a full-height pane", async () => {
    const { default: JobDetailsPage } = await import("./page");

    render(
      await JobDetailsPage({
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
    expect(jobDetailsMock).toHaveBeenCalledWith({
      className: "h-full",
      job: { id: "job-1" },
    });
    expect(screen.getByTestId("job-details-loader")).toBeInTheDocument();
    expect(screen.getByTestId("job-details")).toBeInTheDocument();
  });
});
