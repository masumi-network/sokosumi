import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SokoBotAvatar, SokoBotTeam } from "@/lib/clients/generated/core";

import { SokoBotsHero } from "./soko-bots-hero";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: ({ seed }: { seed: string }) => (
    <span data-testid="legacy-orb" data-seed={seed} />
  ),
}));

vi.mock("@/components/soko-bot/soko-bot-badges", () => ({
  SokoBotStatusBadge: () => null,
}));

vi.mock("./message-bot-button.client", () => ({
  MessageBotButton: () => null,
}));

const avatars: SokoBotAvatar[] = Array.from({ length: 5 }, (_, index) => ({
  id: `pool-${index}`,
  imageUrl: `https://example.com/pool-${index}.png`,
  subject: "fox",
  background: "teal",
}));

function memberWithAvatar(
  imageUrl: string | null,
): SokoBotTeam["members"][number] {
  return {
    userId: "user-1",
    name: "Owner",
    image: null,
    role: null,
    isYou: true,
    bot: {
      id: "bot-1",
      name: "Assistant",
      avatarImageUrl: imageUrl,
      avatarSeed: "orb:jewel-amber",
      status: "IDLE",
    },
  };
}

describe("SokoBotsHero", () => {
  it("shows the owner's saved mascot instead of a legacy orb", async () => {
    const imageUrl = "https://example.com/my-mascot.png";
    const { container, queryByTestId } = render(
      await SokoBotsHero({ me: memberWithAvatar(imageUrl), avatars }),
    );

    const images = [...container.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      ...avatars.slice(0, 4).map((avatar) => avatar.imageUrl),
      imageUrl,
    ]);
    expect(queryByTestId("legacy-orb")).not.toBeInTheDocument();
  });

  it("keeps the seeded orb for a bot without a saved mascot", async () => {
    const { container, getByTestId } = render(
      await SokoBotsHero({ me: memberWithAvatar(null), avatars }),
    );

    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(getByTestId("legacy-orb")).toHaveAttribute(
      "data-seed",
      "orb:jewel-amber",
    );
  });

  it("shows five pool mascots when the owner has no bot", async () => {
    const me = memberWithAvatar(null);
    me.bot = null;
    const { container, queryByTestId } = render(
      await SokoBotsHero({ me, avatars }),
    );

    expect(container.querySelectorAll("img")).toHaveLength(5);
    expect(queryByTestId("legacy-orb")).not.toBeInTheDocument();
  });
});
