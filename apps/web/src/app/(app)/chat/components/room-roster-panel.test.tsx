import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatParticipantHoverProfile } from "./room-helpers";
import { RoomRosterPanel } from "./room-roster-panel";

const copyTextWithToastMock = vi.fn();

vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => <span data-testid="presence-dot" />,
}));

vi.mock("@/hooks/use-clipboard", () => ({
  copyTextWithToast: (...args: unknown[]) => copyTextWithToastMock(...args),
}));

const labels = {
  title: "Members",
  close: "Close members",
  empty: "No members to show.",
  coworkerBadge: "AI coworker",
  message: (name: string) => `Message ${name}`,
  copy: (value: string) => `Copy ${value}`,
  copySuccess: "Copied to clipboard",
  copyError: "Could not copy.",
};

const FOCUS_RING = "focus-visible:ring-2";

const humanAda: ChatParticipantHoverProfile = {
  kind: "human",
  id: "user-ada",
  name: "Ada",
  email: "ada@example.com",
  image: null,
  presence: "online",
};

const humanSelf: ChatParticipantHoverProfile = {
  kind: "human",
  id: "user-self",
  name: "Me",
  email: "me@example.com",
  image: null,
  presence: "online",
};

const coworkerHannah: ChatParticipantHoverProfile = {
  kind: "coworker",
  id: "coworker-1",
  name: "Hannah",
  slug: "hannah",
  caption: "Research assistant",
  image: null,
  presence: "afk",
};

describe("RoomRosterPanel", () => {
  beforeEach(() => {
    copyTextWithToastMock.mockReset();
    copyTextWithToastMock.mockResolvedValue(true);
  });

  it("lists members and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <RoomRosterPanel
        participants={[humanAda, coworkerHannah]}
        currentUserId="user-self"
        canOpenHumanDirect
        onOpenDirect={vi.fn()}
        openingDirectKey={null}
        onClose={onClose}
        labels={labels}
      />,
    );

    const panel = screen.getByTestId("room-roster-panel");
    expect(panel).toHaveTextContent("Members");
    expect(panel.className).toContain("lg:w-80");
    expect(panel.className).not.toContain("lg:w-[420px]");
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("Hannah")).toBeTruthy();
    expect(screen.getByText("@hannah")).toBeTruthy();
    expect(screen.getByText("AI coworker")).toBeTruthy();
    expect(screen.queryByText("Research assistant")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Close members" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a Direct from another human and from a coworker, not from self", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <RoomRosterPanel
        participants={[humanSelf, humanAda, coworkerHannah]}
        currentUserId="user-self"
        canOpenHumanDirect
        onOpenDirect={onOpenDirect}
        openingDirectKey={null}
        onClose={vi.fn()}
        labels={labels}
      />,
    );

    const adaRow = screen
      .getByRole("button", { name: "Copy ada@example.com" })
      .closest("[data-testid='room-roster-member']");
    const hannahRow = screen
      .getByRole("button", { name: "Copy @hannah" })
      .closest("[data-testid='room-roster-member']");
    expect(adaRow).toBeTruthy();
    expect(hannahRow).toBeTruthy();

    const adaMessage = within(adaRow as HTMLElement).getByRole("button", {
      name: "Message Ada",
    });
    expect(adaMessage).toHaveAttribute("title", "Message Ada");
    expect(adaMessage.className).toContain(FOCUS_RING);
    expect(
      within(adaRow as HTMLElement).queryByRole("button", {
        name: "Copy ada@example.com",
      }),
    ).toBeTruthy();
    expect(within(adaMessage).queryByText("ada@example.com")).toBeNull();
    expect(
      within(adaRow as HTMLElement).getByTestId("room-roster-message-icon"),
    ).toBeTruthy();
    expect(
      within(hannahRow as HTMLElement).getByRole("button", {
        name: "Message Hannah",
      }),
    ).toHaveAttribute("title", "Message Hannah");
    expect(
      within(hannahRow as HTMLElement).getByTestId("room-roster-message-icon"),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Message Ada" }));
    expect(onOpenDirect).toHaveBeenCalledWith(humanAda);

    onOpenDirect.mockClear();
    await user.click(screen.getByRole("button", { name: "Message Hannah" }));
    expect(onOpenDirect).toHaveBeenCalledWith(coworkerHannah);

    expect(screen.queryByRole("button", { name: "Me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Message Me" })).toBeNull();
    expect(screen.getByText("Me")).toBeTruthy();
  });

  it("lists room members even when the org roster failed to load", () => {
    render(
      <RoomRosterPanel
        participants={[humanAda]}
        currentUserId="user-self"
        canOpenHumanDirect
        onOpenDirect={vi.fn()}
        openingDirectKey={null}
        onClose={vi.fn()}
        labels={labels}
      />,
    );

    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByTestId("room-roster-error")).toBeNull();
  });

  it("shows empty copy when there are no participants", () => {
    render(
      <RoomRosterPanel
        participants={[]}
        currentUserId="user-self"
        canOpenHumanDirect
        onOpenDirect={vi.fn()}
        openingDirectKey={null}
        onClose={vi.fn()}
        labels={labels}
      />,
    );

    expect(screen.getByText("No members to show.")).toBeTruthy();
  });

  it("copies email or @slug from the caption without opening a Direct", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <RoomRosterPanel
        participants={[humanSelf, humanAda, coworkerHannah]}
        currentUserId="user-self"
        canOpenHumanDirect
        onOpenDirect={onOpenDirect}
        openingDirectKey={null}
        onClose={vi.fn()}
        labels={labels}
      />,
    );

    const copyMessages = {
      copySuccessMessage: "Copied to clipboard",
      copyErrorMessage: "Could not copy.",
    };

    const adaCopy = screen.getByRole("button", {
      name: "Copy ada@example.com",
    });
    expect(adaCopy).toHaveClass("self-start");
    expect(adaCopy.className).toContain(FOCUS_RING);
    await user.click(adaCopy);
    expect(copyTextWithToastMock).toHaveBeenCalledWith(
      "ada@example.com",
      copyMessages,
    );
    expect(onOpenDirect).not.toHaveBeenCalled();

    copyTextWithToastMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Copy @hannah" }));
    expect(copyTextWithToastMock).toHaveBeenCalledWith("@hannah", copyMessages);
    expect(onOpenDirect).not.toHaveBeenCalled();

    copyTextWithToastMock.mockClear();
    await user.click(
      screen.getByRole("button", { name: "Copy me@example.com" }),
    );
    expect(copyTextWithToastMock).toHaveBeenCalledWith(
      "me@example.com",
      copyMessages,
    );
  });
});
