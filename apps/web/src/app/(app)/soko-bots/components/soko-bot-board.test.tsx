import type { SokoBotTeam } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SokoBotBoard } from "./soko-bot-board";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({ dateTime: () => "Sep 30" }),
}));

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: () => <span data-testid="orb" />,
}));

vi.mock("./open-bot-chat.client", () => ({
  ChatWithBotTile: ({
    sokoBotId,
    children,
  }: {
    sokoBotId: string;
    children: ReactNode;
  }) => (
    <button type="button" data-bot={sokoBotId}>
      {children}
    </button>
  ),
  ChatWithBotButton: ({ sokoBotId }: { sokoBotId: string }) => (
    <button type="button" data-chat={sokoBotId}>
      chat
    </button>
  ),
}));

type Member = SokoBotTeam["members"][number];

function member(overrides: Partial<Member>): Member {
  return {
    userId: "user",
    name: "Someone",
    image: null,
    role: null,
    isYou: false,
    bot: null,
    ...overrides,
  };
}

function bot(id: string, name: string, status: "IDLE" | "RUNNING") {
  return {
    id,
    name,
    avatarImageUrl: null,
    avatarSeed: null,
    status,
    lastActivityAt: null,
  };
}

const team = {
  workspace: { id: "ws", kind: "organization", name: "NMKR", logo: null },
  members: [
    member({
      userId: "albina",
      name: "Albina",
      bot: bot("bot-lili", "Lili", "RUNNING"),
    }),
    member({ userId: "sandro", name: "Sandro" }),
    member({
      userId: "phil",
      name: "Phil",
      bot: bot("bot-alfred", "Alfred", "IDLE"),
    }),
    member({
      userId: "patrick",
      name: "Patrick",
      isYou: true,
      bot: bot("bot-joseph", "Joseph", "IDLE"),
    }),
  ],
} as SokoBotTeam;

function column(title: string) {
  const heading = screen.getByRole("heading", { name: title });
  return heading.closest("section") as HTMLElement;
}

describe("SokoBotBoard", () => {
  it("groups bots by status and puts your own card first", async () => {
    render(await SokoBotBoard({ team, stats: null }));

    const idle = within(column("IDLE"));
    const items = idle.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Joseph");
    expect(items[1]).toHaveTextContent("Alfred");
    expect(within(column("RUNNING")).getByText("Lili")).toBeInTheDocument();
  });

  it("opens teammates' chats from the card and gives yours a chat button", async () => {
    render(await SokoBotBoard({ team, stats: null }));

    const tiles = screen
      .getAllByRole("button")
      .map((button) => button.dataset.bot ?? button.dataset.chat);
    expect(tiles.sort()).toEqual(["bot-alfred", "bot-joseph", "bot-lili"]);
  });

  it("lists people without an assistant in their own column", async () => {
    render(await SokoBotBoard({ team, stats: null }));

    expect(within(column("notSetUp")).getByText("Sandro")).toBeInTheDocument();
  });
});
