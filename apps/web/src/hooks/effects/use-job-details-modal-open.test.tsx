import { act, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useJobDetailsModalOpen } from "./use-job-details-modal-open";

describe("useJobDetailsModalOpen", () => {
  it("starts open and closes on demand", () => {
    const captured: {
      latest: ReturnType<typeof useJobDetailsModalOpen> | null;
    } = { latest: null };

    function Probe() {
      captured.latest = useJobDetailsModalOpen();
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(captured.latest?.open).toBe(true);

    act(() => {
      captured.latest?.close();
    });
    expect(captured.latest?.open).toBe(false);

    unmount();
  });

  it("opens again when its hidden route is shown again", () => {
    const captured: {
      latest: ReturnType<typeof useJobDetailsModalOpen> | null;
    } = { latest: null };

    function Probe() {
      captured.latest = useJobDetailsModalOpen();
      return null;
    }

    const tree = (mode: "visible" | "hidden") => (
      <StrictMode>
        <Activity mode={mode}>
          <Probe />
        </Activity>
      </StrictMode>
    );

    const { rerender, unmount } = render(tree("visible"));
    act(() => {
      captured.latest?.close();
    });
    expect(captured.latest?.open).toBe(false);

    rerender(tree("hidden"));
    // Stays closed while hidden, so no dialog shows over the jobs list.
    expect(captured.latest?.open).toBe(false);

    rerender(tree("visible"));
    expect(captured.latest?.open).toBe(true);

    unmount();
  });
});
