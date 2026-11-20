import type {
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import { GuestInviteSection } from "./guest-invite-section";

const {
  listRoomInvitationsActionMock,
  listRoomGuestInviteLinksActionMock,
  createRoomInvitationActionMock,
  revokeRoomInvitationActionMock,
  createRoomGuestInviteLinkActionMock,
  revokeRoomGuestInviteLinkActionMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  listRoomInvitationsActionMock: vi.fn(),
  listRoomGuestInviteLinksActionMock: vi.fn(),
  createRoomInvitationActionMock: vi.fn(),
  revokeRoomInvitationActionMock: vi.fn(),
  createRoomGuestInviteLinkActionMock: vi.fn(),
  revokeRoomGuestInviteLinkActionMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "Jan 1, 2027",
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/app/chat/actions", () => ({
  listRoomInvitationsAction: (...args: unknown[]) =>
    listRoomInvitationsActionMock(...args),
  listRoomGuestInviteLinksAction: (...args: unknown[]) =>
    listRoomGuestInviteLinksActionMock(...args),
  createRoomInvitationAction: (...args: unknown[]) =>
    createRoomInvitationActionMock(...args),
  revokeRoomInvitationAction: (...args: unknown[]) =>
    revokeRoomInvitationActionMock(...args),
  createRoomGuestInviteLinkAction: (...args: unknown[]) =>
    createRoomGuestInviteLinkActionMock(...args),
  revokeRoomGuestInviteLinkAction: (...args: unknown[]) =>
    revokeRoomGuestInviteLinkActionMock(...args),
}));

function invitation(
  overrides: Partial<ChatRoomInvitation> = {},
): ChatRoomInvitation {
  return {
    id: "inv-1",
    email: "guest@example.com",
    status: "pending",
    ...overrides,
  } as ChatRoomInvitation;
}

function inviteLink(
  overrides: Partial<ChatRoomGuestInviteLink> = {},
): ChatRoomGuestInviteLink {
  return {
    token: "tok-1",
    url: "https://sokosumi.test/invite/tok-1",
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    revokedAt: null,
    ...overrides,
  } as ChatRoomGuestInviteLink;
}

describe("GuestInviteSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRoomInvitationsActionMock.mockResolvedValue({
      ok: true,
      value: [
        invitation(),
        invitation({
          id: "inv-2",
          email: "done@example.com",
          status: "accepted",
        }),
      ],
    });
    listRoomGuestInviteLinksActionMock.mockResolvedValue({
      ok: true,
      value: [
        inviteLink(),
        inviteLink({ token: "tok-revoked", revokedAt: new Date() }),
      ],
    });
    revokeRoomInvitationActionMock.mockResolvedValue({ ok: true, value: {} });
  });

  it("loads pending invitations and active links, and updates on revoke", async () => {
    render(<GuestInviteSection roomId="room-1" />, {
      wrapper: TestQueryProvider,
    });

    expect(await screen.findByText("guest@example.com")).toBeInTheDocument();
    expect(screen.queryByText("done@example.com")).not.toBeInTheDocument();
    expect(
      screen.getByText("https://sokosumi.test/invite/tok-1"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "revokeAria" }));

    await waitFor(() => {
      expect(revokeRoomInvitationActionMock).toHaveBeenCalledWith(
        "room-1",
        "inv-1",
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("guest@example.com")).not.toBeInTheDocument();
    });
  });

  it("shows error state on failure and retries on click", async () => {
    listRoomInvitationsActionMock.mockResolvedValueOnce({
      ok: false,
      error: { message: "down" },
    });
    render(<GuestInviteSection roomId="room-1" />, {
      wrapper: TestQueryProvider,
    });

    expect(await screen.findByText("loadError")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    expect(await screen.findByText("guest@example.com")).toBeInTheDocument();
    expect(listRoomInvitationsActionMock).toHaveBeenCalledTimes(2);
  });
});
