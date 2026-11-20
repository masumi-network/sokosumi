import { render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERNAL_TRAFFIC_COOKIE } from "@/lib/analytics/internal-traffic";

import { useInternalTrafficGate } from "./use-internal-traffic-gate";

function clearInternalTrafficCookie() {
  document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=; path=/; max-age=0`;
}

function GateProbe() {
  const enabled = useInternalTrafficGate();
  return <output data-testid="gate">{String(enabled)}</output>;
}

describe("useInternalTrafficGate", () => {
  beforeEach(() => {
    clearInternalTrafficCookie();
    window.history.replaceState(null, "", "/?internal=0");
    renderHook(() => useInternalTrafficGate()).unmount();
    clearInternalTrafficCookie();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "cookie");
    clearInternalTrafficCookie();
    window.history.replaceState(null, "", "/?internal=0");
    renderHook(() => useInternalTrafficGate()).unmount();
    clearInternalTrafficCookie();
    window.history.replaceState(null, "", "/");
  });

  it("enables tags for regular visitors and leaves the URL untouched", () => {
    window.history.replaceState(null, "", "/billing?tab=credits");

    const { result } = renderHook(() => useInternalTrafficGate());

    expect(result.current).toBe(true);
    expect(window.location.pathname + window.location.search).toBe(
      "/billing?tab=credits",
    );
  });

  it("disables tags, sets the opt-out cookie, and strips internal=1 from the URL", () => {
    const state = { from: "test" };
    window.history.replaceState(
      state,
      "",
      "/billing?internal=1&tab=credits#top",
    );

    const { result } = renderHook(() => useInternalTrafficGate());

    expect(result.current).toBe(false);
    expect(document.cookie).toContain(`${INTERNAL_TRAFFIC_COOKIE}=1`);
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/billing?tab=credits#top");
    expect(window.history.state).toEqual(state);
  });

  it("opts back in and strips internal=0 from the URL", () => {
    document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=1; path=/`;
    window.history.replaceState(null, "", "/billing?internal=0&tab=credits");

    const { result } = renderHook(() => useInternalTrafficGate());

    expect(result.current).toBe(true);
    expect(document.cookie).not.toContain(`${INTERNAL_TRAFFIC_COOKIE}=1`);
    expect(window.location.pathname + window.location.search).toBe(
      "/billing?tab=credits",
    );
  });

  it("keeps the opt-out across StrictMode replays and remounts when cookie writes are rejected", () => {
    const setter = vi.fn();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: setter,
    });
    window.history.replaceState(null, "", "/billing?internal=1&tab=credits");

    const first = render(
      <StrictMode>
        <GateProbe />
      </StrictMode>,
    );

    expect(setter).toHaveBeenCalled();
    expect(first.getByTestId("gate")).toHaveTextContent("false");
    expect(window.location.pathname + window.location.search).toBe(
      "/billing?tab=credits",
    );

    first.unmount();

    const remounted = render(<GateProbe />);
    expect(remounted.getByTestId("gate")).toHaveTextContent("false");
    remounted.unmount();

    window.history.replaceState(null, "", "/billing?internal=0&tab=credits");
    const optedBackIn = render(<GateProbe />);
    expect(optedBackIn.getByTestId("gate")).toHaveTextContent("true");
  });
});
