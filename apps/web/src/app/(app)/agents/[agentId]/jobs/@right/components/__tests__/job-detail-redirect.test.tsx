import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";

import JobDetailRedirect from "@/app/agents/[agentId]/jobs/@right/components/job-detail-redirect";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(min-width: 1024px)",
    onchange: null,
    addEventListener: jest.fn(
      (eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        if (eventName === "change") {
          listeners.add(listener);
        }
      },
    ),
    removeEventListener: jest.fn(
      (eventName: string, listener: (event: MediaQueryListEvent) => void) => {
        if (eventName === "change") {
          listeners.delete(listener);
        }
      },
    ),
    addListener: jest.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeListener: jest.fn(
      (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatchEvent: jest.fn(),
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue(mediaQueryList),
  });

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches: nextMatches } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
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

  it("redirects when viewport changes from below lg to lg", async () => {
    const { setMatches } = mockMatchMedia(false);

    render(<JobDetailRedirect agentId="agent-1" jobId="job-1" />);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });

    act(() => {
      setMatches(true);
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/agents/agent-1/jobs/job-1");
    });
  });
});
