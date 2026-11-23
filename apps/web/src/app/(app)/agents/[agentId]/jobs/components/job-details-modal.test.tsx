import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
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
function renderWithPanesWidth(width: number, job: object = {}) {
  panes = installJobsPanesRow(width);

  return render(
    <JobDetailsModal agentId="agent-1" job={job as never} readOnly={false} />,
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

  it("names the dialog after the job", async () => {
    renderWithPanesWidth(ONE_PANE, { name: "Quarterly report" });

    expect(
      await screen.findByRole("dialog", { name: "Quarterly report" }),
    ).toBeInTheDocument();
  });

  it("keeps its own width above the small breakpoint", async () => {
    renderWithPanesWidth(ONE_PANE);

    // The shared dialog caps itself at `sm:max-w-lg`, which clipped the
    // job's Properties column on a tablet.
    expect(await screen.findByRole("dialog")).toHaveClass("sm:max-w-3xl");
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
  it("opens again when the reader taps the same job after closing it", async () => {
    panes = installJobsPanesRow(ONE_PANE);
    // Next keeps the closed modal's route in Activity and shows it again on
    // the next tap, with the state it had when it closed.
    const modal = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <JobDetailsModal agentId="agent-1" job={{} as never} readOnly={false} />
      </Activity>
    );
    const { rerender } = render(modal("visible"));

    fireEvent.click(await screen.findByRole("button", { name: /back/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    rerender(modal("hidden"));
    rerender(modal("visible"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
