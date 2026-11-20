import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it } from "vitest";
import { markPageOnScreen } from "@/lib/navigation/navigation-start";
import { startNavigation } from "@/test/pending-navigation";
import { usePendingNavigation } from "./use-pending-navigation";

function Probe() {
  const pending = usePendingNavigation();
  return (
    <output data-testid="probe">
      {pending ? `${pending.pathname}:${String(pending.onScreen)}` : "idle"}
    </output>
  );
}

describe("usePendingNavigation", () => {
  it("reports the pending destination while a navigation transition is in flight and resets on arrival", async () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("idle");

    markPageOnScreen("/calendar");
    const arrive = await startNavigation("/calendar?view=week");
    try {
      expect(screen.getByTestId("probe")).toHaveTextContent("/calendar:true");
    } finally {
      await arrive();
    }

    expect(screen.getByTestId("probe")).toHaveTextContent("idle");
  });

  it("unsubscribes on React Activity hide and re-subscribes on reveal", async () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );

    const hiddenArrive = await startNavigation("/tasks");
    await hiddenArrive();

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    const visibleArrive = await startNavigation("/tasks");
    try {
      expect(screen.getByTestId("probe")).toHaveTextContent("/tasks:false");
    } finally {
      await visibleArrive();
    }

    expect(screen.getByTestId("probe")).toHaveTextContent("idle");
  });
});
