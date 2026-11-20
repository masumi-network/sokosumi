import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
  }),
}));

import { ChatDesktopHomeRedirect } from "../chat-desktop-home-redirect.client";

describe("ChatDesktopHomeRedirect", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces to Welcome on md+ viewports", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(<ChatDesktopHomeRedirect />);
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("does not redirect on mobile viewports", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(<ChatDesktopHomeRedirect />);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("replaces to Welcome once when resizing from mobile to desktop", () => {
    const listeners = new Set<() => void>();
    const mql = {
      matches: false,
      media: "(min-width: 768px)",
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.delete(listener);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mql),
    );

    render(<ChatDesktopHomeRedirect />);
    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      mql.matches = true;
      for (const listener of listeners) listener();
    });
    expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/");
  });
});
