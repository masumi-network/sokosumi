import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";

const replaceMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () =>
    ({
      toString: () => "",
    }) as URLSearchParams,
}));

vi.mock("@/components/jobs", () => ({
  JobDetails: () => <div data-testid="job-details">Job Details</div>,
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("JobDetailsModal", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  it("renders modal content on viewports below lg", async () => {
    mockMatchMedia(true);

    render(
      <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />,
    );

    expect(await screen.findByTestId("job-details")).toBeInTheDocument();
  });

  it("does not render modal content on lg and above", () => {
    mockMatchMedia(false);

    render(
      <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />,
    );

    expect(screen.queryByTestId("job-details")).not.toBeInTheDocument();
  });

  it("closes modal and routes back to jobs root", async () => {
    mockMatchMedia(true);

    render(
      <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
    });
  });

  it("closes modal on swipe right", async () => {
    mockMatchMedia(true);

    render(
      <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />,
    );

    const modalSurface = await screen.findByTestId("job-details-modal-surface");

    fireEvent.touchStart(modalSurface, {
      changedTouches: [{ clientX: 20, clientY: 120 }],
    });
    fireEvent.touchEnd(modalSurface, {
      changedTouches: [{ clientX: 140, clientY: 130 }],
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
    });
  });
});
