import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLinkMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join("|")}` : key,
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    resolveRoomGuestInviteLink: (...args: unknown[]) =>
      resolveLinkMock(...args),
  },
}));

const room = {
  id: "room_1",
  name: "Launch Plans",
  organizationId: "org_1",
  organizationName: "Acme",
};

async function renderNotice(returnUrl: string | string[] | undefined) {
  const { default: ChatInviteNotice } = await import("./chat-invite-notice");
  const { container } = render(await ChatInviteNotice({ returnUrl }));
  return container;
}

describe("ChatInviteNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLinkMock.mockResolvedValue({ status: "valid", room });
  });

  it("names the channel, its organization and the guest join for a live link", async () => {
    await renderNotice("/chat/join/tok_A-1");

    expect(resolveLinkMock).toHaveBeenCalledWith("tok_A-1");
    expect(screen.getByText("invitedToJoin:Launch Plans|Acme")).toBeVisible();
    expect(screen.getByText("guestNote")).toBeVisible();
  });

  it("says nothing for a link that is no longer valid", async () => {
    resolveLinkMock.mockResolvedValue({ status: "revoked", room: null });

    expect(await renderNotice("/chat/join/tok_1")).toBeEmptyDOMElement();
  });

  it("says nothing when the link cannot be checked", async () => {
    resolveLinkMock.mockRejectedValue(new Error("Core down"));

    expect(await renderNotice("/chat/join/tok_1")).toBeEmptyDOMElement();
  });

  it.each([
    undefined,
    "/agents",
    "/chat/join/",
    "/chat/join/tok_1/extra",
    "/chat/join/tok_1?x=1",
    "/chat/join/..%2F..%2Fadmin",
    "https://evil.example/chat/join/tok_1",
    "//evil.example/chat/join/tok_1",
    ["/chat/join/tok_1", "/chat/join/tok_2"],
  ])("asks Core nothing for return URL %s", async (returnUrl) => {
    expect(await renderNotice(returnUrl)).toBeEmptyDOMElement();
    expect(resolveLinkMock).not.toHaveBeenCalled();
  });
});
