import type { SokoBotTeam } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
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
  SokoBotStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("./message-bot-button.client", () => ({
  MessageBotButton: ({ sokoBotId }: { sokoBotId: string }) => (
    <button type="button" data-bot={sokoBotId}>
      message
    </button>
  ),
}));

vi.mock("./team-carousel-frame.client", () => ({
  TeamCarouselFrame: ({ children }: { children: ReactNode }) => (
    <ul>{children}</ul>
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

const team: SokoBotTeam = {
  workspace: { kind: "organization", name: "NMKR", logo: null },
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
  it("puts you first and lets you message every teammate's agent", async () => {
    render(await TeamCarousel({ team }));

    const cards = screen.getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Patrick"),
      expect.stringContaining("Albina"),
      expect.stringContaining("Sandro"),
    ]);
    const buttons = screen.getAllByRole("button", { name: "message" });
    expect(buttons.map((button) => button.dataset.bot)).toEqual([
      "bot-joseph",
      "bot-lili",
    ]);
  });

  it("links settings only for your own agent and marks teammates without one", async () => {
    render(await TeamCarousel({ team }));
    const [mine, albina, sandro] = screen.getAllByRole("listitem");

    expect(
      within(mine!).getByRole("link", { name: "manage" }),
    ).toBeInTheDocument();
    expect(within(albina!).queryByRole("link")).toBeNull();
    expect(within(sandro!).getByText("noAssistant")).toBeInTheDocument();
  });
});
