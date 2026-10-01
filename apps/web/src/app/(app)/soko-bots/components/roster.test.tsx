import type { SokoBotTeam } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { TeamRoster, YourAssistantCard } from "./roster";

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

function bot(
  id: string,
  name: string,
  status: "IDLE" | "RUNNING",
  lastActivityAt: Date | null,
) {
  return {
    id,
    name,
    avatarImageUrl: null,
    avatarSeed: null,
    status,
    lastActivityAt,
  };
}

const me = member({
  userId: "patrick",
  name: "Patrick",
  isYou: true,
  bot: bot("bot-joseph", "Joseph", "IDLE", new Date("2026-10-01")),
});

const team = {
  workspace: { id: "ws", kind: "organization", name: "NMKR", logo: null },
  members: [
    member({
      userId: "keanu",
      name: "Keanu",
      bot: bot("bot-talos", "Talos", "IDLE", null),
    }),
    member({
      userId: "phil",
      name: "Phil",
      bot: bot("bot-alfred", "Alfred", "IDLE", new Date("2026-09-29")),
    }),
    member({ userId: "sandro", name: "Sandro" }),
    member({
      userId: "andreas",
      name: "Andreas",
      bot: bot("bot-jarvis", "Jarvis", "IDLE", new Date("2026-09-30")),
    }),
    member({
      userId: "albina",
      name: "Albina",
      bot: bot("bot-lili", "Lili", "RUNNING", new Date("2026-09-01")),
    }),
    me,
  ],
} as SokoBotTeam;

describe("TeamRoster", () => {
  it("sorts running first, then by last activity, and leaves your bot out", async () => {
    render(await TeamRoster({ team }));

    const order = screen
      .getAllByRole("button")
      .map((button) => button.dataset.bot);
    expect(order).toEqual([
      "bot-lili",
      "bot-jarvis",
      "bot-alfred",
      "bot-talos",
    ]);
  });

  it("puts people without an assistant on the not-set-up line", async () => {
    render(await TeamRoster({ team }));

    expect(screen.getByText("notSetUp")).toBeInTheDocument();
    expect(screen.getByText("Sandro")).toBeInTheDocument();
  });
});

describe("YourAssistantCard", () => {
  it("shows your bot with chat and settings", async () => {
    render(await YourAssistantCard({ me, stats: null }));

    expect(screen.getByText("Joseph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "chat" }).dataset.chat).toBe(
      "bot-joseph",
    );
    expect(screen.getByRole("link", { name: "manage" })).toBeInTheDocument();
  });

  it("offers to create one when you have none", async () => {
    render(await YourAssistantCard({ me: { ...me, bot: null }, stats: null }));

    expect(
      screen.getByRole("link", { name: "createAssistant" }),
    ).toBeInTheDocument();
  });
});
