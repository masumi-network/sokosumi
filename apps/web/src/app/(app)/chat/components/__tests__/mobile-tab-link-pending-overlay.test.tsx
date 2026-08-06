import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MainContentPendingOverlay,
  MobileTabLinkPendingOverlay,
} from "../mobile-tab-link-pending-overlay";
import { MOBILE_TAB_PENDING_OVERLAY_DELAY_MS } from "../mobile-tab-pending-overlay-delay";

let mockPending = false;

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: mockPending }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("MobileTabLinkPendingOverlay", () => {
  beforeEach(() => {
    mockPending = false;
  });

  it("renders nothing when the link is not pending", () => {
    mockPending = false;
    const { container } = render(
      <MobileTabLinkPendingOverlay isApple={false} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("mounts a delayed main-content overlay when the link is pending", () => {
    mockPending = true;
    render(<MobileTabLinkPendingOverlay isApple={false} />);

    const overlay = screen.getByRole("status");
    expect(overlay).toHaveAttribute("data-mobile-tab-pending-overlay");
    expect(overlay.className).toContain("md:hidden");
    expect(overlay.className).toContain("z-30");
    expect(overlay.className).toContain("top-16");
    expect(overlay.className).toContain("pointer-events-none");
    expect(overlay.className).toContain("bg-background/50");
    expect(overlay.className).toContain(
      "bottom-[calc(4rem+env(safe-area-inset-bottom))]",
    );
    expect(overlay.style.animationDelay).toBe(
      `${MOBILE_TAB_PENDING_OVERLAY_DELAY_MS}ms`,
    );
    expect(within(overlay).getByText("loading")).toHaveClass("sr-only");
  });

  it("uses Apple float bottom offset when isApple", () => {
    mockPending = true;
    render(<MobileTabLinkPendingOverlay isApple />);

    const overlay = screen.getByRole("status");
    expect(overlay.className).toContain(
      "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))]",
    );
  });
});

describe("MainContentPendingOverlay", () => {
  it("returns null when not visible", () => {
    const { container } = render(
      <MainContentPendingOverlay
        visible={false}
        bottomOffsetClass="bottom-16"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders Loader2 status with dimmed backdrop when visible", () => {
    render(<MainContentPendingOverlay visible bottomOffsetClass="bottom-16" />);

    const overlay = screen.getByRole("status");
    expect(overlay.className).toContain("bottom-16");
    expect(overlay.className).toContain("bg-background/50");
    expect(overlay.querySelector("svg")).toBeTruthy();
  });
});
