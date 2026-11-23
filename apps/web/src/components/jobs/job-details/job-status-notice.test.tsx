import type { Job } from "@sokosumi/core-client";
import { SokosumiJobStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStatusNotice } from "@/components/jobs/job-details/job-status-notice";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/jobs/job-details/refund-request", () => ({
  canRenderRefundRequest: () => true,
  default: () => <button type="button">refund</button>,
}));

function jobWith(status: SokosumiJobStatus): Job {
  return { status } as Job;
}

describe("JobStatusNotice", () => {
  it.each([
    [SokosumiJobStatus.FAILED, "failed"],
    [SokosumiJobStatus.PAYMENT_FAILED, "paymentFailed"],
    [SokosumiJobStatus.REFUND_RESOLVED, "refunded"],
  ])("explains a %s job", (status, key) => {
    render(<JobStatusNotice job={jobWith(status)} canManage={false} />);

    const notice = screen.getByRole("note");
    expect(notice).toHaveTextContent(`${key}.title`);
    expect(notice).toHaveTextContent(`${key}.description`);
  });

  it.each([
    SokosumiJobStatus.COMPLETED,
    SokosumiJobStatus.PROCESSING,
    SokosumiJobStatus.STARTED,
  ])("says nothing for a %s job", (status) => {
    const { container } = render(
      <JobStatusNotice job={jobWith(status)} canManage />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers the refund on a failed job its viewer manages", () => {
    render(
      <JobStatusNotice job={jobWith(SokosumiJobStatus.FAILED)} canManage />,
    );

    expect(screen.getByRole("button", { name: "refund" })).toBeInTheDocument();
  });

  it("offers no refund to a viewer who cannot manage the job", () => {
    render(
      <JobStatusNotice
        job={jobWith(SokosumiJobStatus.FAILED)}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
