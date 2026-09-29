import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import JobDetailRedirect from "@/app/agents/[agentId]/jobs/@right/components/job-detail-redirect";
import { installJobsPanesRow } from "@/app/agents/[agentId]/jobs/components/__tests__/jobs-panes-harness";
import { JOBS_TWO_PANE_MIN_WIDTH } from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

const NARROW = JOBS_TWO_PANE_MIN_WIDTH - 1;
const WIDE = JOBS_TWO_PANE_MIN_WIDTH;

let panes: ReturnType<typeof installJobsPanesRow> | null = null;

describe("JobDetailRedirect", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  afterEach(() => {
    panes?.cleanup();
    panes = null;
  });

  it("does not redirect while the panes row is too narrow for two panes", async () => {
    panes = installJobsPanesRow(NARROW);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  it("redirects once the panes row is wide enough", async () => {
    panes = installJobsPanesRow(WIDE);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/agents/agent-1/jobs/job-1");
    });
  });

  it("redirects when the panes row grows past the threshold", async () => {
    panes = installJobsPanesRow(NARROW);
    const { setWidth } = panes;

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });

    act(() => {
      setWidth(WIDE);
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/agents/agent-1/jobs/job-1");
    });
  });

  it("stays put when the window is wide but the sidebar leaves too little room", async () => {
    // 1024px window, 224px expanded sidebar: the old viewport media query said
    // two panes fit here, and the detail pane came out 432px wide.
    panes = installJobsPanesRow(1024 - 224 - 32);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
