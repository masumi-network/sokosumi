import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCoworkerStreamOverlayClearOnDisable } from "./use-coworker-stream-overlay-clear-on-disable";

function Probe({
  enabled,
  overlayCreatedAtByMessageIdRef,
}: {
  enabled: boolean;
  overlayCreatedAtByMessageIdRef: { current: Map<string, number> };
}) {
  useCoworkerStreamOverlayClearOnDisable(
    enabled,
    overlayCreatedAtByMessageIdRef,
  );
  return null;
}

describe("useCoworkerStreamOverlayClearOnDisable", () => {
  it("keeps cached overlay timestamps while enabled and clears them when disabled", () => {
    const map = new Map<string, number>([["m1", 1_000]]);
    const ref = { current: map };

    const { rerender, unmount } = render(
      <Probe enabled={true} overlayCreatedAtByMessageIdRef={ref} />,
    );
    expect(map.size).toBe(1);

    rerender(<Probe enabled={false} overlayCreatedAtByMessageIdRef={ref} />);
    expect(map.size).toBe(0);

    unmount();
  });
});
