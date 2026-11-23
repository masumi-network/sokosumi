import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { describe, expect, it } from "vitest";

import { useWorkspaceCalendarRenderEpoch } from "./use-workspace-calendar-render-epoch";

function EpochProbe() {
  const hasActivatedRef = useRef(false);
  const epoch = useWorkspaceCalendarRenderEpoch(hasActivatedRef);
  return <span data-testid="epoch">{epoch}</span>;
}

describe("useWorkspaceCalendarRenderEpoch", () => {
  it("stays at 0 on initial StrictMode mount and increments on Activity reactivation", async () => {
    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <EpochProbe />
        </Activity>
      </StrictMode>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("epoch")).toHaveTextContent("0");

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <EpochProbe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <EpochProbe />
        </Activity>
      </StrictMode>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("epoch")).toHaveTextContent("1");
  });
});
