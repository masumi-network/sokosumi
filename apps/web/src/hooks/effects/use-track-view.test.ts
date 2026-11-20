import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  viewAgentMock,
  viewCreditsMock,
  viewLoginAreaMock,
  viewRegisterAreaMock,
} = vi.hoisted(() => ({
  viewAgentMock: vi.fn(),
  viewCreditsMock: vi.fn(),
  viewLoginAreaMock: vi.fn(),
  viewRegisterAreaMock: vi.fn(),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewAgent: viewAgentMock,
    viewCredits: viewCreditsMock,
    viewLoginArea: viewLoginAreaMock,
    viewRegisterArea: viewRegisterAreaMock,
  },
}));

import { useTrackView } from "./use-track-view";

describe("useTrackView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires a mount-only view event once and ignores rerenders", () => {
    const { rerender } = renderHook(
      ({ event }: { event: "view_login_area" | "view_register_area" }) =>
        useTrackView(event),
      { initialProps: { event: "view_login_area" } },
    );

    expect(viewLoginAreaMock).toHaveBeenCalledTimes(1);
    expect(viewRegisterAreaMock).not.toHaveBeenCalled();

    rerender({ event: "view_login_area" });
    rerender({ event: "view_register_area" });

    expect(viewLoginAreaMock).toHaveBeenCalledTimes(1);
    expect(viewRegisterAreaMock).not.toHaveBeenCalled();
  });

  it("fires view_credits and view_register_area on mount", () => {
    renderHook(() => useTrackView("view_credits"));
    renderHook(() => useTrackView("view_register_area"));

    expect(viewCreditsMock).toHaveBeenCalledTimes(1);
    expect(viewRegisterAreaMock).toHaveBeenCalledTimes(1);
  });

  it("fires view_agent with properties on mount and whenever key changes", () => {
    const firstAgent = { id: "agent-1", name: "Alpha" };
    const secondAgent = { id: "agent-2", name: "Beta" };

    const { rerender } = renderHook(
      ({ agent }: { agent: { id: string; name: string } }) =>
        useTrackView("view_agent", { agentName: agent.name }, agent),
      { initialProps: { agent: firstAgent } },
    );

    expect(viewAgentMock).toHaveBeenCalledTimes(1);
    expect(viewAgentMock).toHaveBeenLastCalledWith("Alpha");

    // Same key reference does not re-fire
    rerender({ agent: firstAgent });
    expect(viewAgentMock).toHaveBeenCalledTimes(1);

    // New key reference re-fires with updated properties
    rerender({ agent: secondAgent });
    expect(viewAgentMock).toHaveBeenCalledTimes(2);
    expect(viewAgentMock).toHaveBeenLastCalledWith("Beta");
  });
});
