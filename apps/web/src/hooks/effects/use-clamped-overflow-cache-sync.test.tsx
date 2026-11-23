import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type ClampedOverflowState,
  useClampedOverflowCacheSync,
} from "./use-clamped-overflow-cache-sync";

function Probe({
  states,
  cacheKey,
  current,
}: {
  states: Map<string, ClampedOverflowState> | null;
  cacheKey: string;
  current: ClampedOverflowState;
}) {
  useClampedOverflowCacheSync(states, cacheKey, current);
  return null;
}

describe("useClampedOverflowCacheSync", () => {
  it("writes the latest overflow state into the cache map and tolerates a null map", () => {
    const states = new Map<string, ClampedOverflowState>();
    const first: ClampedOverflowState = {
      cacheKey: "msg-1",
      resetKey: "v1",
      expanded: false,
      overflows: true,
    };
    const second: ClampedOverflowState = {
      cacheKey: "msg-1",
      resetKey: "v1",
      expanded: true,
      overflows: true,
    };

    const { rerender, unmount } = render(
      <Probe states={states} cacheKey="msg-1" current={first} />,
    );
    expect(states.get("msg-1")).toBe(first);

    rerender(<Probe states={states} cacheKey="msg-1" current={second} />);
    expect(states.get("msg-1")).toBe(second);

    rerender(<Probe states={null} cacheKey="msg-2" current={second} />);
    expect(states.has("msg-2")).toBe(false);

    unmount();
  });
});
