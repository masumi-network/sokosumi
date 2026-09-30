import type { SokoBotTeam } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { YourAssistant } from "./your-assistant";

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
  ChatWithBotButton: ({ sokoBotId }: { sokoBotId: string }) => (
    <button type="button" data-bot={sokoBotId}>
      chat
    </button>
  ),
}));

type Member = SokoBotTeam["members"][number];

const me: Member = {
  userId: "patrick",
  name: "Patrick",
  image: null,
  role: "owner",
  isYou: true,
  bot: {
    id: "bot-joseph",
    name: "Joseph",
    avatarImageUrl: null,
    avatarSeed: null,
    status: "IDLE",
  },
};

describe("YourAssistant", () => {
  it("shows your bot with a chat button and a settings link", async () => {
    render(await YourAssistant({ me }));

    expect(screen.getByText("Joseph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "chat" }).dataset.bot).toBe(
      "bot-joseph",
    );
    expect(screen.getByRole("link", { name: "manage" })).toBeInTheDocument();
  });

  it("offers to create one when you have none", async () => {
    render(await YourAssistant({ me: { ...me, bot: null } }));

    expect(screen.getByText("noAssistantYou")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "createAssistant" }),
    ).toBeInTheDocument();
  });
});
