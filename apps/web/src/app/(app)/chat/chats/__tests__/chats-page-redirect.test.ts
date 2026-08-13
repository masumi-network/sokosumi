import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import ChatChatsPage from "@/app/chat/chats/page";

describe("ChatChatsPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects the old list URL to chat root", () => {
    expect(() => ChatChatsPage()).toThrow("REDIRECT:/chat");
    expect(redirectMock).toHaveBeenCalledWith("/chat");
  });
});
