import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTaskSchedulesShowAllFocus } from "./use-task-schedules-show-all-focus";

function ShowAllHarness({
  onControls,
}: {
  onControls?: (
    controls: ReturnType<typeof useTaskSchedulesShowAllFocus>,
  ) => void;
}) {
  const allTabRef = useRef<HTMLButtonElement | null>(null);
  const controls = useTaskSchedulesShowAllFocus(allTabRef);
  onControls?.(controls);
  return (
    <button ref={allTabRef} type="button">
      All
    </button>
  );
}

describe("useTaskSchedulesShowAllFocus", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("focuses the All tab when remounted at the armed URL and drops the request when leaving elsewhere or clearing", () => {
    const captured: {
      controls: ReturnType<typeof useTaskSchedulesShowAllFocus> | null;
    } = { controls: null };
    window.history.replaceState(null, "", "/schedules?scheduleState=ENDED");

    const first = render(
      <ShowAllHarness
        onControls={(next) => {
          captured.controls = next;
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).not.toHaveFocus();

    captured.controls?.armShowAllFocus("/schedules");
    window.history.replaceState(null, "", "/schedules");
    first.unmount();

    const second = render(
      <ShowAllHarness
        onControls={(next) => {
          captured.controls = next;
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveFocus();

    // Arm, then leave to a different URL -> unmount drops the request.
    captured.controls?.armShowAllFocus("/schedules");
    window.history.replaceState(null, "", "/tasks");
    second.unmount();

    window.history.replaceState(null, "", "/schedules");
    const third = render(
      <ShowAllHarness
        onControls={(next) => {
          captured.controls = next;
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).not.toHaveFocus();

    // Explicit clear drops the armed request even when landing at the URL.
    captured.controls?.armShowAllFocus("/schedules");
    captured.controls?.clearShowAllFocus();
    third.unmount();

    const fourth = render(<ShowAllHarness />);
    expect(screen.getByRole("button", { name: "All" })).not.toHaveFocus();
    fourth.unmount();
  });

  it("focuses exactly once under StrictMode arrival and respects Activity hide/reveal", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const captured: {
      controls: ReturnType<typeof useTaskSchedulesShowAllFocus> | null;
    } = { controls: null };
    window.history.replaceState(null, "", "/schedules?scheduleState=ENDED");

    const first = render(
      <ShowAllHarness
        onControls={(next) => {
          captured.controls = next;
        }}
      />,
    );
    captured.controls?.armShowAllFocus("/schedules");
    window.history.replaceState(null, "", "/schedules");
    first.unmount();

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ShowAllHarness
            onControls={(next) => {
              captured.controls = next;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    // Run 1 consumes showAllDestination and focuses once; StrictMode replay sees null.
    expect(screen.getByRole("button", { name: "All" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Arm for /schedules, hide while on /tasks -> cleanup drops it so reveal does not focus.
    screen.getByRole("button", { name: "All" }).blur();
    captured.controls?.armShowAllFocus("/schedules");
    window.history.replaceState(null, "", "/tasks");
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ShowAllHarness
            onControls={(next) => {
              captured.controls = next;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    window.history.replaceState(null, "", "/schedules");
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ShowAllHarness
            onControls={(next) => {
              captured.controls = next;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);

    unmount();
  });
});
