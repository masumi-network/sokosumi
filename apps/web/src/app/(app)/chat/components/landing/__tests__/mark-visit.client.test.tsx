import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markVisitMock = vi.fn(() => Promise.resolve());
let mockIsMobile: boolean | undefined;

vi.mock("@/app/chat/actions", () => ({
  markVisitAction: () => markVisitMock(),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobileMedia: () => mockIsMobile,
}));

import { MarkVisit } from "../mark-visit.client";

describe("MarkVisit", () => {
  beforeEach(() => {
    markVisitMock.mockClear();
    mockIsMobile = undefined;
  });

  it("waits for the media query rather than guessing", () => {
    mockIsMobile = undefined;
    render(<MarkVisit on="mobile" shouldAdvance />);
    expect(markVisitMock).not.toHaveBeenCalled();
  });

  it("marks the visit on the breakpoint that shows the welcome", () => {
    mockIsMobile = true;
    render(<MarkVisit on="mobile" shouldAdvance />);
    expect(markVisitMock).toHaveBeenCalledTimes(1);
  });

  // `md:hidden` still mounts on desktop, so mounting alone must not count.
  it("does not mark a mobile visit while on desktop", () => {
    mockIsMobile = false;
    render(<MarkVisit on="mobile" shouldAdvance />);
    expect(markVisitMock).not.toHaveBeenCalled();
  });

  // Bare /chat renders the desktop landing then redirects mobile away.
  it("does not mark a desktop visit while on mobile", () => {
    mockIsMobile = true;
    render(<MarkVisit on="desktop" shouldAdvance />);
    expect(markVisitMock).not.toHaveBeenCalled();
  });

  it("marks the desktop visit on desktop", () => {
    mockIsMobile = false;
    render(<MarkVisit on="desktop" shouldAdvance />);
    expect(markVisitMock).toHaveBeenCalledTimes(1);
  });

  // The server says false when Core failed or the visit is still fresh —
  // advancing then would discard a window nobody was shown.
  it("respects the server's refusal to advance", () => {
    mockIsMobile = true;
    render(<MarkVisit on="mobile" shouldAdvance={false} />);
    expect(markVisitMock).not.toHaveBeenCalled();
  });

  it("marks at most once across re-renders", () => {
    mockIsMobile = true;
    const { rerender } = render(<MarkVisit on="mobile" shouldAdvance />);
    rerender(<MarkVisit on="mobile" shouldAdvance />);
    rerender(<MarkVisit on="mobile" shouldAdvance />);
    expect(markVisitMock).toHaveBeenCalledTimes(1);
  });
});
