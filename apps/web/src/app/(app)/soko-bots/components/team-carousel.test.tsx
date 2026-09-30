import type { SokoBotTeam } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { TeamCarousel } from "./team-carousel";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: () => <span data-testid="orb" />,
}));

vi.mock("@/components/soko-bot/soko-bot-badges", () => ({
  SokoBotStatusLine: ({ status }: { status: string }) => <span>{status}</span>,
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
}));

vi.mock("./team-carousel-frame.client", () => ({
  TeamCarouselFrame: ({
    header,
    children,
  }: {
    header: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      {header}
      <ul data-testid="carousel">{children}</ul>
    </div>
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

const team = {
  workspace: { id: "ws", kind: "organization", name: "NMKR", logo: null },
  members: [
    member({
      userId: "albina",
      name: "Albina",
      bot: {
        id: "bot-lili",
        name: "Lili",
        avatarImageUrl: null,
        avatarSeed: null,
        status: "IDLE",
      },
    }),
    member({ userId: "sandro", name: "Sandro" }),
    member({
      userId: "patrick",
      name: "Patrick",
      isYou: true,
      bot: {
        id: "bot-joseph",
        name: "Joseph",
        avatarImageUrl: "https://example.com/joseph.png",
        avatarSeed: null,
        status: "RUNNING",
      },
    }),
  ],
} as SokoBotTeam;

describe("TeamCarousel", () => {
  it("shows teammates' assistants as tiles that open the bot's chat", async () => {
    render(await TeamCarousel({ team }));

    const tiles = screen.getAllByRole("button");
    expect(tiles.map((tile) => tile.dataset.bot)).toEqual(["bot-lili"]);
    expect(tiles[0]).toHaveTextContent("Albina");
    expect(tiles[0]).toHaveTextContent("Lili");
  });

  it("leaves your own assistant to the row above and lists people without one", async () => {
    render(await TeamCarousel({ team }));

    expect(screen.queryByText("Joseph")).toBeNull();
    expect(screen.getByText("notSetUp")).toBeInTheDocument();
    expect(screen.getByTitle("Sandro")).toBeInTheDocument();
  });
});
