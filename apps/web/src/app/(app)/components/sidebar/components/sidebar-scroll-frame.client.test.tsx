import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarScrollFrame } from "./sidebar-scroll-frame.client";

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
  return { viewport, room, navigation: screen.getByRole("button") };
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
