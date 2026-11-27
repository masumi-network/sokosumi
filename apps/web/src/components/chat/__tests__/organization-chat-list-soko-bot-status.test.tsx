import { SokoBotStatus } from "@sokosumi/core-client";
import { act, screen, within } from "@testing-library/react";
import { use } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishLiveSokoBot,
  SokoBotDirectRowContext,
} from "@/components/chat/personal-assistant-chrome-store";

import { makeUser } from "./chat-room-fixtures";
import {
  emptyListResult,
  harnessRowProps,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const sokoBot = {
  id: "bot-1",
  name: "Juno",
  caption: null,
  image: null,
  avatarSeed: null,
  ownerUserId: "user-1",
  scope: "personal" as const,
  sharedRoomId: null,
  presence: "online" as const,
};

describe("OrganizationChatList your Soko Bot's Direct", () => {
  let clearLiveBot: () => void = () => {};

  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  afterEach(() => {
    act(() => clearLiveBot());
  });

  it("says the status the sidebar's bot row says, on that Direct only", async () => {
    const botDirect = makeRoom({
      id: "bot-direct",
      kind: "direct",
      myAccess: "member",
      userMembers: [makeUser("user-1")],
      sokoBotMembers: [sokoBot],
    });
    const personDirect = makeRoom({
      id: "person-direct",
      kind: "direct",
      myAccess: "member",
    });
    clearLiveBot = publishLiveSokoBot({
      id: sokoBot.id,
      status: SokoBotStatus.ERROR,
      lastActivityAt: null,
    });

    listRoomsMock.mockResolvedValue(emptyListResult([botDirect, personDirect]));
    await act(async () =>
      renderOrganizationChatList({ rooms: [botDirect, personDirect] }),
    );

    const [botRow, personRow] = screen.getAllByTestId("room-row");
    expect(
      within(botRow as HTMLElement).getByText(
        "Components.SokoBot.BotStatus.ERROR",
      ),
    ).toBeInTheDocument();
    expect(personRow).not.toHaveTextContent("BotStatus");
  });

  it("says nothing extra while no bot row is live", async () => {
    const botDirect = makeRoom({
      id: "bot-direct",
      kind: "direct",
      myAccess: "member",
      userMembers: [makeUser("user-1")],
      sokoBotMembers: [sokoBot],
    });

    listRoomsMock.mockResolvedValue(emptyListResult([botDirect]));
    await act(async () => renderOrganizationChatList({ rooms: [botDirect] }));

    expect(screen.getByTestId("room-row")).not.toHaveTextContent("BotStatus");
  });
});

/**
 * The sidebar mounts your bot's row under Direct messages. When your Direct
 * with that bot is listed there too, the two are one row: the Direct, with
 * the bot's status line under its name and the team's Soko Bots at its end.
 */
describe("OrganizationChatList one row for your Soko Bot", () => {
  const liveBot = {
    id: sokoBot.id,
    imageUrl: null,
    seed: "a",
    name: "Juno",
    status: SokoBotStatus.IDLE,
    lastActivityAt: null,
  };
  const botDirect = makeRoom({
    id: "bot-direct",
    kind: "direct",
    myAccess: "member",
    userMembers: [makeUser("user-1")],
    sokoBotMembers: [sokoBot],
  });
  const personDirect = makeRoom({
    id: "person-direct",
    kind: "direct",
    myAccess: "member",
  });

  beforeEach(() => {
    resetOrganizationChatListMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderSidebar(rooms: (typeof botDirect)[]) {
    // After the harness, so the row gets the harness's `next-intl` mock.
    const { default: PersonalAssistantNav } = await import(
      "@/app/components/sidebar/components/personal-assistant-nav.client"
    );
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    await act(async () =>
      renderOrganizationChatList({
        rooms,
        directFooter: <PersonalAssistantNav bot={liveBot} nested />,
      }),
    );
  }

  function links(href: string) {
    return document.querySelectorAll(`a[href="${href}"]`);
  }

  it("shows the bot once: its Direct, with status and the team at its end", async () => {
    await renderSidebar([botDirect, personDirect]);

    expect(links("/personal-assistant")).toHaveLength(0);
    const [botRow, personRow] = screen.getAllByTestId("room-row");
    const row = botRow as HTMLElement;
    // The row opens the Direct; its room menu is the row's own (row test).
    expect(harnessRowProps.get("bot-direct")).toMatchObject({
      href: "/chat/rooms/bot-direct",
    });
    expect(
      within(row).getByText("App.Sidebar.Content.SokoBot.ready"),
    ).toBeInTheDocument();
    const team = within(row).getByRole("link", {
      name: "App.Sidebar.Content.SokoBot.team",
    });
    expect(team).toHaveAttribute("href", "/agents");
    // Its own 40px box (32px from md), a gap clear of the menu's hit area.
    const { trailingLink } = harnessRowProps.get("bot-direct") as {
      trailingLink: { props: { className: string } };
    };
    expect(trailingLink.props.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["size-10", "md:size-8", "mr-1.5", "md:mr-0.5"]),
    );
    expect(personRow).not.toHaveTextContent("SokoBot");
  });

  // The server has no poll (`useLiveSokoBotStatus` is null there), so the
  // merge must come from the room alone, or the HTML lists the bot twice.
  it("merges from the room alone, before any bot row has published", async () => {
    function Probe() {
      return <span data-testid="probe">{use(SokoBotDirectRowContext)}</span>;
    }
    listRoomsMock.mockResolvedValue(emptyListResult([botDirect]));
    await act(async () =>
      renderOrganizationChatList({
        rooms: [botDirect],
        directFooter: <Probe />,
      }),
    );

    expect(screen.getByTestId("probe")).toHaveTextContent(sokoBot.id);
    expect(links("/agents")).toHaveLength(1);
  });

  it("holds the bot row back while it loads, when the Direct stands in", async () => {
    const { default: PersonalAssistantNav } = await import(
      "@/app/components/sidebar/components/personal-assistant-nav.client"
    );
    listRoomsMock.mockResolvedValue(emptyListResult([botDirect]));
    await act(async () =>
      renderOrganizationChatList({
        rooms: [botDirect],
        directFooter: <PersonalAssistantNav nested />,
      }),
    );

    expect(links("/agents")).toHaveLength(1);
    expect(screen.queryByText(/MenuItems\.sokoBot/)).toBeNull();
  });

  it("leaves a Direct with a teammate's bot alone", async () => {
    const teammateBotDirect = makeRoom({
      id: "teammate-bot-direct",
      kind: "direct",
      myAccess: "member",
      userMembers: [makeUser("user-1")],
      sokoBotMembers: [{ ...sokoBot, id: "bot-2", ownerUserId: "user-2" }],
    });
    await renderSidebar([teammateBotDirect]);

    expect(links("/personal-assistant")).toHaveLength(1);
    expect(harnessRowProps.get("teammate-bot-direct")?.trailingLink).toBe(
      undefined,
    );
  });

  it("keeps the bot row where no Direct with the bot is listed", async () => {
    await renderSidebar([personDirect]);

    expect(links("/personal-assistant")).toHaveLength(1);
    expect(screen.getByTestId("room-row")).not.toHaveTextContent("SokoBot");
  });

  it("leaves the Direct alone without the sidebar's bot row", async () => {
    clearLiveBotFor(liveBot.id);
    listRoomsMock.mockResolvedValue(emptyListResult([botDirect]));
    await act(async () => renderOrganizationChatList({ rooms: [botDirect] }));

    expect(links("/agents")).toHaveLength(0);
    expect(screen.getByTestId("room-row")).not.toHaveTextContent("ready");
  });
});

/** Publishes the bot as idle, then clears it, so no stale row is live. */
function clearLiveBotFor(id: string) {
  act(() =>
    publishLiveSokoBot({
      id,
      status: SokoBotStatus.IDLE,
      lastActivityAt: null,
    })(),
  );
}
