import type {
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRoomInvitationsAction: vi.fn(),
  listRoomGuestInviteLinksAction: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({
  listRoomInvitationsAction: mocks.listRoomInvitationsAction,
  listRoomGuestInviteLinksAction: mocks.listRoomGuestInviteLinksAction,
}));

import { useGuestInviteSectionData } from "./use-guest-invite-section-data";

function Probe({ roomId }: { roomId: string }) {
  const { invitations, inviteLinks, loadFailed, isLoading, loadInvitations } =
    useGuestInviteSectionData(roomId);
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="failed">{String(loadFailed)}</span>
      <span data-testid="invites">
        {invitations.map((i) => i.email).join(",")}
      </span>
      <span data-testid="links">
        {inviteLinks.map((l) => l.token).join(",")}
      </span>
      <button type="button" onClick={() => void loadInvitations()}>
        retry
      </button>
    </div>
  );
}

describe("useGuestInviteSectionData", () => {
  beforeEach(() => {
    mocks.listRoomInvitationsAction.mockReset();
    mocks.listRoomGuestInviteLinksAction.mockReset();
  });

  it("loads pending invitations and non-revoked links on mount, and exposes retry on failure", async () => {
    mocks.listRoomInvitationsAction
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "1", email: "pending@example.com", status: "pending" },
          { id: "2", email: "accepted@example.com", status: "accepted" },
        ] as ChatRoomInvitation[],
      })
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } });
    mocks.listRoomGuestInviteLinksAction
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { token: "active", revokedAt: null },
          { token: "revoked", revokedAt: "2026-01-01T00:00:00Z" },
        ] as ChatRoomGuestInviteLink[],
      })
      .mockResolvedValueOnce({ ok: true, value: [] });

    const { unmount } = render(<Probe roomId="room-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("failed")).toHaveTextContent("false");
    expect(screen.getByTestId("invites")).toHaveTextContent(
      "pending@example.com",
    );
    expect(screen.getByTestId("links")).toHaveTextContent("active");

    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("failed")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("invites")).toHaveTextContent("");
    expect(screen.getByTestId("links")).toHaveTextContent("");

    unmount();
  });
});
