import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installJobsPanesRow } from "@/app/agents/[agentId]/jobs/components/__tests__/jobs-panes-harness";
import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";
import { JOBS_TWO_PANE_MIN_WIDTH } from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";

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

vi.mock("@/components/jobs/job-details/job-details", () => ({
  default: () => <div data-testid="job-details">Job Details</div>,
}));

const ONE_PANE = JOBS_TWO_PANE_MIN_WIDTH - 1;
const TWO_PANES = JOBS_TWO_PANE_MIN_WIDTH;

let panes: ReturnType<typeof installJobsPanesRow> | null = null;

/** The modal stands in for the right pane, so it shows only when that pane cannot. */
function renderWithPanesWidth(width: number) {
  panes = installJobsPanesRow(width);

  return render(
    <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />,
  );
}

describe("JobDetailsModal", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  afterEach(() => {
    panes?.cleanup();
    panes = null;
  });

  it("renders modal content when the panes row fits one pane", async () => {
    renderWithPanesWidth(ONE_PANE);

    expect(await screen.findByTestId("job-details")).toBeInTheDocument();
  });

  it("does not render modal content when the right pane fits", async () => {
    renderWithPanesWidth(TWO_PANES);

    await waitFor(() => {
      expect(screen.queryByTestId("job-details")).not.toBeInTheDocument();
    });
  });

  it("renders modal content when a wide window still leaves one pane", async () => {
    // 1024px window minus an expanded 224px sidebar and the row gutters.
    renderWithPanesWidth(1024 - 224 - 32);

    expect(await screen.findByTestId("job-details")).toBeInTheDocument();
  });

  it("closes modal and routes back to jobs root", async () => {
    renderWithPanesWidth(ONE_PANE);

    await screen.findByTestId("job-details");

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
    });
  });

  it("closes modal on swipe right", async () => {
    renderWithPanesWidth(ONE_PANE);

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
