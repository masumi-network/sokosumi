import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
let mockIsMobile: boolean | undefined = undefined;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobileMedia: () => mockIsMobile,
}));

import { MobileChatHomeRedirect } from "../mobile-chat-home-redirect.client";

describe("MobileChatHomeRedirect", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    mockIsMobile = undefined;
  });

  it("shows chats skeleton while media query is unresolved", () => {
    mockIsMobile = undefined;
    render(<MobileChatHomeRedirect />);
    expect(screen.getByTestId("chat-chats-loading")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows chats skeleton and replaces to /chat/chats on mobile", () => {
    mockIsMobile = true;
    render(<MobileChatHomeRedirect />);
    expect(screen.getByTestId("chat-chats-loading")).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith("/chat/chats");
  });

  it("renders nothing on desktop", () => {
    mockIsMobile = false;
    const { container } = render(<MobileChatHomeRedirect />);
    expect(container).toBeEmptyDOMElement();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
