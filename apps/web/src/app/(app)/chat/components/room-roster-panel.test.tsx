import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomMemberReadState } from "@/app/chat/hooks/use-room-read-receipts";
import { OrganizationSeatProvider } from "@/contexts/organization-seat-context";

import type { ChatParticipantHoverProfile } from "./room-helpers";
import { RoomRosterPanel } from "./room-roster-panel";

const copyTextWithToastMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      "Presence.online": "Online",
      "Presence.afk": "Away",
      "Presence.offline": "Offline",
    };
    return labels[key] ?? key;
  },
  useFormatter: () => ({
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));

vi.mock("@/hooks/use-clipboard", () => ({
  copyTextWithToast: (...args: unknown[]) => copyTextWithToastMock(...args),
}));

const labels = {
  title: "Members",
  humansTitle: "People",
  agentsTitle: "AI coworkers",
  close: "Close members",
  empty: "No members to show.",
  coworkerBadge: "AI coworker",
  message: (name: string) => `Message ${name}`,
  copy: (value: string) => `Copy ${value}`,
  copySuccess: "Copied to clipboard",
  copyError: "Could not copy.",
  readAt: (time: string) => `Read ${time}`,
  notRead: "Not read yet",
};

/** Default: the panel says nothing about reading. */
const noReadState = () => null;

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

  it("announces each member's availability with their name", () => {
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[humanAda, coworkerHannah]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={vi.fn()}
          openingDirectKey={null}
          onClose={vi.fn()}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
    );

    const [adaRow, hannahRow] = screen.getAllByTestId("room-roster-member");

    // getByText alone would pass on text buried in an aria-hidden subtree,
    // which is exactly how this defect stayed invisible. Assert the state is
    // reachable, not merely present in the DOM.
    expect(within(adaRow).getByText("Ada")).toBeTruthy();
    expect(
      within(adaRow).getByText("Online").closest('[aria-hidden="true"]'),
    ).toBeNull();
    // Hannah is a coworker, so ADR-0003 reports her online whatever the
    // fixture's own "afk" says.
    expect(within(hannahRow).getByText("Hannah")).toBeTruthy();
    expect(
      within(hannahRow).getByText("Online").closest('[aria-hidden="true"]'),
    ).toBeNull();
  });

  it("lists members and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[humanAda, coworkerHannah]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={vi.fn()}
          openingDirectKey={null}
          onClose={onClose}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
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
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[humanSelf, humanAda, coworkerHannah]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={onOpenDirect}
          openingDirectKey={null}
          onClose={vi.fn()}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
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
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[humanAda]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={vi.fn()}
          openingDirectKey={null}
          onClose={vi.fn()}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
    );

    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByTestId("room-roster-error")).toBeNull();
  });

  it("shows empty copy when there are no participants", () => {
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={vi.fn()}
          openingDirectKey={null}
          onClose={vi.fn()}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
    );

    expect(screen.getByText("No members to show.")).toBeTruthy();
  });

  it("copies email or @slug from the caption without opening a Direct", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <RoomRosterPanel
          participants={[humanSelf, humanAda, coworkerHannah]}
          currentUserId="user-self"
          canOpenHumanDirect
          onOpenDirect={onOpenDirect}
          openingDirectKey={null}
          onClose={vi.fn()}
          readStateFor={noReadState}
          labels={labels}
        />
      </OrganizationSeatProvider>,
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

  describe("Seen by", () => {
    const READ_AT = new Date("2026-01-01T10:00:00.000Z");

    function renderPanel(
      readStateFor: (userId: string) => RoomMemberReadState | null,
    ) {
      return render(
        <OrganizationSeatProvider hasAssignedSeat={true}>
          <RoomRosterPanel
            participants={[humanAda, humanSelf, coworkerHannah]}
            currentUserId="user-self"
            canOpenHumanDirect
            onOpenDirect={vi.fn()}
            openingDirectKey={null}
            onClose={vi.fn()}
            readStateFor={readStateFor}
            labels={labels}
          />
        </OrganizationSeatProvider>,
      );
    }

    it("tells each member when they last read the room", () => {
      renderPanel((userId) =>
        userId === "user-ada" ? { kind: "read", lastReadAt: READ_AT } : null,
      );

      expect(
        screen.getByText(`Read ${READ_AT.toISOString()}`),
      ).toBeInTheDocument();
    });

    it("names a member who has never opened the room", () => {
      renderPanel((userId) =>
        userId === "user-ada" ? { kind: "unread" } : null,
      );

      expect(screen.getByText("Not read yet")).toBeInTheDocument();
    });

    /**
     * A Coworker does not read, so no read state is invented for one — the row
     * must be silent rather than claim the machine has not read.
     */
    it("asks nothing about a coworker", () => {
      const readStateFor = vi.fn(() => null);
      renderPanel(readStateFor);

      expect(readStateFor).not.toHaveBeenCalledWith("coworker-1");
      expect(screen.queryByTestId("room-roster-read-state")).toBeNull();
    });

    it("stays silent for every member when the receipts say nothing", () => {
      renderPanel(noReadState);

      expect(screen.queryByTestId("room-roster-read-state")).toBeNull();
    });

    /**
     * On the right it competed with the name for width, and a roster of twenty
     * truncated every name to make room for a timestamp.
     */
    it("puts the read time in the member's own column, not beside it", () => {
      renderPanel((userId) =>
        userId === "user-ada" ? { kind: "read", lastReadAt: READ_AT } : null,
      );

      const read = screen.getByTestId("room-roster-read-state");
      const name = screen.getByText("Ada");
      expect(read.parentElement).toBe(name.closest("div"));
    });
  });

  describe("sections", () => {
    function renderRoster(participants: ChatParticipantHoverProfile[]) {
      return render(
        <OrganizationSeatProvider hasAssignedSeat={true}>
          <RoomRosterPanel
            participants={participants}
            currentUserId="user-self"
            canOpenHumanDirect
            onOpenDirect={vi.fn()}
            openingDirectKey={null}
            onClose={vi.fn()}
            readStateFor={noReadState}
            labels={labels}
          />
        </OrganizationSeatProvider>,
      );
    }

    it("names the two halves once both are on the roster", () => {
      renderRoster([humanAda, humanSelf, coworkerHannah]);

      expect(
        screen.getByTestId("room-roster-section-humans"),
      ).toHaveTextContent("People");
      expect(
        screen.getByTestId("room-roster-section-agents"),
      ).toHaveTextContent("AI coworkers");
    });

    it("names neither when the room is only people", () => {
      renderRoster([humanAda, humanSelf]);

      expect(screen.queryByTestId("room-roster-section-humans")).toBeNull();
      expect(screen.queryByTestId("room-roster-section-agents")).toBeNull();
    });

    it("shows the viewer first", () => {
      renderRoster([humanAda, humanSelf, coworkerHannah]);

      const names = screen
        .getAllByTestId("room-roster-member")
        .map((row) => row.innerText || row.textContent?.split("\n")[0]);

      expect(names[0]).toContain("Me");
    });
  });
});
