import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMobile: false,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  parseSidebarStateCookieHeader,
  parseSidebarWidthCookieHeader,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_USER_WIDTH_VAR,
} from "@/lib/ui-preferences/sidebar-state";

import { SidebarEdgeHandle } from "./sidebar-edge-handle.client";

function clearCookies() {
  for (const name of ["sidebar_state", "sidebar_width"]) {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

function renderHandle(defaultOpen = true) {
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <SidebarEdgeHandle />
    </SidebarProvider>,
  );
}

/** By slot, not role: a hidden sidebar takes the strip out of the tree. */
function handle() {
  const node = document.querySelector<HTMLElement>(
    '[data-slot="sidebar-edge-handle"]',
  );
  if (!node) throw new Error("no edge handle");
  return node;
}

function drag(from: number, ...to: number[]) {
  fireEvent.pointerDown(handle(), { clientX: from, button: 0, pointerId: 1 });
  for (const x of to) {
    fireEvent.pointerMove(handle(), { clientX: x, pointerId: 1 });
  }
  const last = to.at(-1) ?? from;
  fireEvent.pointerUp(handle(), { clientX: last, pointerId: 1 });
  fireEvent.click(handle());
}

function expectHidden() {
  expect(handle()).toHaveAttribute("aria-hidden", "true");
}

function userWidth() {
  return document.documentElement.style.getPropertyValue(
    SIDEBAR_USER_WIDTH_VAR,
  );
}

beforeEach(() => {
  mocks.isMobile = false;
  clearCookies();
  document.documentElement.style.removeProperty(SIDEBAR_USER_WIDTH_VAR);
});

afterEach(() => {
  clearCookies();
});

describe("SidebarEdgeHandle", () => {
  it("renders nothing on the phone, which has its own sheet", () => {
    mocks.isMobile = true;
    renderHandle();

    expect(
      document.querySelector('[data-slot="sidebar-edge-handle"]'),
    ).toBeNull();
  });

  it("is a window splitter while shown, with its width as the value", () => {
    renderHandle(true);

    expect(handle()).toHaveAttribute("role", "separator");
    expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    expect(handle()).toHaveAttribute("aria-label", "resize");
    expect(handle()).toHaveAttribute("aria-valuenow", "224");
    expect(handle()).toHaveAttribute(
      "aria-valuemin",
      String(SIDEBAR_MIN_WIDTH),
    );
    expect(handle()).toHaveAttribute(
      "aria-valuemax",
      String(SIDEBAR_MAX_WIDTH),
    );
    expect(handle()).toHaveAttribute("tabindex", "0");
  });

  it("leaves the tab order and the tree while hidden: the header toggle is the control", () => {
    renderHandle(false);

    expect(handle()).toHaveAttribute("aria-hidden", "true");
    expect(handle()).not.toHaveAttribute("role");
    expect(handle()).not.toHaveAttribute("tabindex");
  });

  it("keeps its value in step with a drag and with the arrow keys", () => {
    renderHandle(true);

    drag(224, 260, 300);
    expect(handle()).toHaveAttribute("aria-valuenow", "300");

    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "284");
  });

  it("starts from the stored width", () => {
    document.cookie = "sidebar_width=310; path=/";
    renderHandle(true);

    expect(handle()).toHaveAttribute("aria-valuenow", "310");
  });

  it("hides on Enter, as the window splitter pattern does", () => {
    renderHandle(true);

    fireEvent.keyDown(handle(), { key: "Enter" });

    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(false);
    expectHidden();
  });

  it("hides the sidebar on a click, and shows it on the next", () => {
    renderHandle(true);

    fireEvent.click(handle());
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(false);
    expect(handle()).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(handle());
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(true);
  });

  it("resizes with the pointer and remembers the width", () => {
    renderHandle(true);

    drag(224, 260, 300);

    expect(userWidth()).toBe("300px");
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(300);
    // The click that ends a drag is not a toggle.
    expect(handle()).toHaveAttribute("role", "separator");
  });

  it("clamps the width to the range", () => {
    renderHandle(true);

    drag(224, 600);
    expect(userWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);

    drag(384, 175);
    expect(userWidth()).toBe(`${SIDEBAR_MIN_WIDTH}px`);
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(
      SIDEBAR_MIN_WIDTH,
    );
  });

  it("snaps shut as soon as the pointer crosses the line, keeping the old width", async () => {
    const { container } = renderHandle(true);
    drag(224, 260, 300);
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');

    fireEvent.pointerDown(handle(), { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 200, pointerId: 1 });
    expect(wrapper).toHaveAttribute("data-resizing", "true");
    fireEvent.pointerMove(handle(), { clientX: 100, pointerId: 1 });

    // Before release: shut, and easing is back on so it slides out.
    expect(handle()).toHaveAttribute("aria-hidden", "true");
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(false);
    expect(wrapper).not.toHaveAttribute("data-resizing");

    // The rest of the drag does nothing.
    fireEvent.pointerMove(handle(), { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 400, pointerId: 1 });
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-hidden", "true");
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(300);

    // The width it reopens at is put back once it has slid out.
    await waitFor(() => expect(userWidth()).toBe("300px"));
  });

  it("opens a collapsed sidebar when dragged out past the line", () => {
    renderHandle(false);

    drag(4, 100, 280);

    expect(handle()).toHaveAttribute("role", "separator");
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(true);
    expect(userWidth()).toBe("280px");
  });

  it("leaves a collapsed sidebar shut when the drag stays under the line", () => {
    renderHandle(false);

    drag(4, 60, 100);

    expect(handle()).toHaveAttribute("aria-hidden", "true");
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBeNull();
  });

  it("stops the sidebar's easing while dragging, and lets it go after", () => {
    const { container } = renderHandle(true);
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');

    fireEvent.pointerDown(handle(), { clientX: 224, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 260, pointerId: 1 });
    expect(wrapper).toHaveAttribute("data-resizing", "true");

    fireEvent.pointerUp(handle(), { clientX: 260, pointerId: 1 });
    expect(wrapper).not.toHaveAttribute("data-resizing");
  });

  it("resizes with the arrow keys while shown", () => {
    renderHandle(true);

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(userWidth()).toBe("240px");

    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(userWidth()).toBe("208px");
  });
  it("does not swallow the next click after a cancelled drag", () => {
    renderHandle(true);

    fireEvent.pointerDown(handle(), { clientX: 224, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 260, pointerId: 1 });
    // A cancel is not followed by a click.
    fireEvent.pointerCancel(handle(), { clientX: 260, pointerId: 1 });

    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the stored width back at once when it reopens mid-slide", () => {
    renderHandle(true);
    drag(224, 260, 300);
    fireEvent.pointerDown(handle(), { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 100, pointerId: 1 });
    fireEvent.click(handle());
    expect(userWidth()).toBe("200px");

    // The strip, pressed inside the slide-out window: no waiting on the timer.
    fireEvent.click(handle());

    expect(handle()).toHaveAttribute("role", "separator");
    expect(userWidth()).toBe("300px");
  });

  it("puts the stored width back when a press lands mid-slide", () => {
    renderHandle(true);
    drag(224, 260, 300);
    fireEvent.pointerDown(handle(), { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 100, pointerId: 1 });
    fireEvent.click(handle());

    fireEvent.pointerDown(handle(), { clientX: 4, button: 0, pointerId: 1 });

    expect(userWidth()).toBe("300px");
  });

  it("leaves no timer behind when it unmounts mid-slide", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHandle(true);
      drag(224, 260, 300);
      fireEvent.pointerDown(handle(), {
        clientX: 300,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(handle(), { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 100, pointerId: 1 });
      unmount();
      document.documentElement.style.setProperty(
        SIDEBAR_USER_WIDTH_VAR,
        "123px",
      );

      vi.advanceTimersByTime(500);

      expect(userWidth()).toBe("123px");
    } finally {
      vi.useRealTimers();
    }
  });
});
