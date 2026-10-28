import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMobile: false,
  unread: false,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock("@/app/chat/components/use-chat-tab-unread-presence", () => ({
  useChatTabUnreadPresence: () => ({
    showUnreadDot: mocks.unread,
    unreadRoomCount: mocks.unread ? 1 : 0,
  }),
}));

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

function handle() {
  return screen.getByRole("button", { name: /^(hide|show)$/ });
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

function userWidth() {
  return document.documentElement.style.getPropertyValue(
    SIDEBAR_USER_WIDTH_VAR,
  );
}

beforeEach(() => {
  mocks.isMobile = false;
  mocks.unread = false;
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

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names itself for what a click does", () => {
    const { unmount } = renderHandle(true);
    expect(handle()).toHaveAccessibleName("hide");
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    unmount();

    renderHandle(false);
    expect(handle()).toHaveAccessibleName("show");
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("hides the sidebar on a click, and shows it on the next", () => {
    renderHandle(true);

    fireEvent.click(handle());
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(false);
    expect(handle()).toHaveAccessibleName("show");

    fireEvent.click(handle());
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(true);
  });

  it("resizes with the pointer and remembers the width", () => {
    renderHandle(true);

    drag(224, 260, 300);

    expect(userWidth()).toBe("300px");
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(300);
    // The click that ends a drag is not a toggle.
    expect(handle()).toHaveAccessibleName("hide");
  });

  it("clamps the width to the range", () => {
    renderHandle(true);

    drag(224, 600);
    expect(userWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);

    drag(384, 150);
    expect(userWidth()).toBe(`${SIDEBAR_MIN_WIDTH}px`);
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(
      SIDEBAR_MIN_WIDTH,
    );
  });

  it("collapses when dragged past the line, and keeps the old width", () => {
    renderHandle(true);
    drag(224, 260, 300);

    drag(300, 200, 100);

    expect(handle()).toHaveAccessibleName("show");
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(false);
    expect(userWidth()).toBe("300px");
    expect(parseSidebarWidthCookieHeader(document.cookie)).toBe(300);
  });

  it("opens a collapsed sidebar when dragged out past the line", () => {
    renderHandle(false);

    drag(4, 100, 280);

    expect(handle()).toHaveAccessibleName("hide");
    expect(parseSidebarStateCookieHeader(document.cookie)).toBe(true);
    expect(userWidth()).toBe("280px");
  });

  it("leaves a collapsed sidebar shut when the drag stays under the line", () => {
    renderHandle(false);

    drag(4, 60, 100);

    expect(handle()).toHaveAccessibleName("show");
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

  it("carries the unread dot only while the sidebar is hidden", () => {
    mocks.unread = true;
    const { unmount, container } = renderHandle(true);
    expect(
      container.querySelector('[data-slot="sidebar-edge-unread-dot"]'),
    ).toBeNull();
    unmount();

    const hidden = renderHandle(false);
    expect(
      hidden.container.querySelector('[data-slot="sidebar-edge-unread-dot"]'),
    ).not.toBeNull();
    expect(handle()).toHaveAccessibleDescription("unreadChats");
  });
});
