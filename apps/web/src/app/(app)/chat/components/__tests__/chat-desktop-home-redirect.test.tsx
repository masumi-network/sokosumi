import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("replaces to Welcome on md+ viewports", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<ChatDesktopHomeRedirect />);
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("does not redirect on mobile viewports", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<ChatDesktopHomeRedirect />);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
