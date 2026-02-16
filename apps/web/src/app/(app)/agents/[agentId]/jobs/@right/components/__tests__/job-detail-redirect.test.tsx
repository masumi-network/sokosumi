import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";

import JobDetailRedirect from "@/app/agents/[agentId]/jobs/@right/components/job-detail-redirect";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

describe("JobDetailRedirect", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("does not redirect on viewport widths below lg", async () => {
    mockMatchMedia(false);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  it("redirects when viewport width is lg or above", async () => {
    mockMatchMedia(true);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/agents/agent-1/jobs/job-1");
    });
  });
});
