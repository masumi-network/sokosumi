import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarScrollFrame } from "./sidebar-scroll-frame.client";

let resize: () => void;
beforeEach(() => {
  resize = () => {};
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(
    function (callback) {
      const observer = {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
      resize = () => callback([], observer);
      return observer;
    },
  );
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  render(
    <SidebarScrollFrame>
      <button type="button">Navigation</button>
      <div data-slot="sidebar-content">
        <div data-slot="scroll-area-viewport" style={{ lineHeight: "24px" }}>
          <a href="/chat">Room</a>
        </div>
      </div>
    </SidebarScrollFrame>,
  );
  const room = screen.getByRole("link", { name: "Room" });
  const viewport = room.parentElement!;
  Object.defineProperties(viewport, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 200 },
  });
  const navigation = screen.getByRole("button");
  const frame = navigation.parentElement!;
  Object.defineProperty(frame, "clientHeight", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(navigation, "offsetHeight", {
    value: 550,
    configurable: true,
  });
  act(() => resize());
  return { viewport, room, navigation, frame };
}

function wheel(target: HTMLElement, options: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 50,
    ...options,
  });
  // Happy DOM WheelEvent extends UIEvent and omits MouseEvent modifiers.
  Object.defineProperties(event, {
    ctrlKey: { value: options.ctrlKey ?? false },
    shiftKey: { value: options.shiftKey ?? false },
  });
  fireEvent(target, event);
  return event;
}

describe("Sidebar wheel forwarding", () => {
  it("pins at 55% and restores full scrolling above the limit", () => {
    const { frame, navigation, viewport } = setup();
    expect(frame).toHaveAttribute("data-fixed-navigation", "true");
    Object.defineProperty(navigation, "offsetHeight", { value: 551 });
    act(() => resize());
    expect(frame).toHaveAttribute("data-fixed-navigation", "false");
    expect(wheel(navigation).defaultPrevented).toBe(false);
    expect(viewport.scrollTop).toBe(0);
  });

  it("scrolls the rooms over fixed navigation and contains scrolling at the edge", () => {
    const { viewport, navigation } = setup();
    expect(wheel(navigation).defaultPrevented).toBe(true);
    expect(viewport.scrollTop).toBe(50);
    viewport.scrollTop = 800;
    expect(wheel(navigation).defaultPrevented).toBe(true);
  });

  it("preserves native room scrolling, zoom and sideways gestures", () => {
    const { viewport, room, navigation } = setup();
    for (const [target, options] of [
      [room, {}],
      [navigation, { ctrlKey: true }],
      [navigation, { shiftKey: true }],
      [navigation, { deltaX: 100 }],
    ] satisfies [HTMLElement, WheelEventInit][]) {
      expect(
        wheel(target, options).defaultPrevented,
        JSON.stringify(options),
      ).toBe(false);
      expect(viewport.scrollTop).toBe(0);
    }
  });

  it("converts line and page wheel units", () => {
    const { viewport, navigation } = setup();
    wheel(navigation, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 2 });
    expect(viewport.scrollTop).toBe(48);
    wheel(navigation, { deltaMode: WheelEvent.DOM_DELTA_PAGE, deltaY: 1 });
    expect(viewport.scrollTop).toBe(248);
  });

  it("leaves the page alone when rooms fit without scrolling", () => {
    const { viewport, navigation } = setup();
    Object.defineProperty(viewport, "scrollHeight", { value: 100 });
    expect(wheel(navigation).defaultPrevented).toBe(false);
  });
});
