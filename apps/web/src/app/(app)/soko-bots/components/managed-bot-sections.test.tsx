import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ManagedBot } from "../managed-bots";

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  getFormatter: async () => ({ dateTime: () => "Nov 22" }),
}));
vi.mock("@/components/soko-bot/bot-face", () => ({ BotFace: () => <span /> }));
vi.mock("./pause-soko-bot-button.client", () => ({
  PauseSokoBotButton: ({ paused }: { paused: boolean }) => (
    <button type="button">{paused ? "resume" : "pause"}</button>
  ),
}));
vi.mock(
  "@/app/personal-assistant/components/archive-soko-bot-button.client",
  () => ({
    ArchiveSokoBotButton: ({ botId }: { botId: string | null }) => (
      <button type="button" data-bot={String(botId)}>
        archive
      </button>
    ),
  }),
);
vi.mock("./reactivate-shared-bot-button.client", () => ({
  ReactivateSharedBotButton: () => <button type="button">restore</button>,
}));

import { ManagedBotSections } from "./managed-bot-sections";

function bot(overrides: Partial<ManagedBot>): ManagedBot {
  return {
    id: "atlas",
    name: "Atlas",
    avatarImageUrl: null,
    seed: "seed",
    status: "IDLE",
    lastActivityAt: null,
    owner: { kind: "team" },
    sharedRoomId: "room",
    canConfigure: true,
    settingsHref: "/soko-bots/atlas",
    targetId: "atlas",
    paused: false,
    canArchive: false,
    archivedAt: null,
    canRestore: false,
    ...overrides,
  };
}

async function renderSections(bots: ManagedBot[]) {
  render(
    await ManagedBotSections({
      title: "Manage",
      bots,
      emptyText: "empty",
    }),
  );
}

function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`no row for ${name}`);
  return item;
}

describe("ManagedBotSections", () => {
  it("gives every live bot Settings, and Pause and Archive only where allowed", async () => {
    await renderSections([
      bot({
        id: "juno",
        name: "Juno",
        owner: { kind: "you", name: "Alice", image: null },
        settingsHref: "/personal-assistant",
        targetId: null,
        canArchive: true,
      }),
      bot({ paused: true }),
      bot({ id: "cuso", name: "Cuso", paused: null }),
    ]);

    const juno = within(row("Juno"));
    expect(
      juno.getByRole("link", { name: 'settingsName:{"name":"Juno"}' }),
    ).toHaveAttribute("href", "/personal-assistant");
    expect(juno.getByRole("button", { name: "pause" })).toBeInTheDocument();
    expect(juno.getByRole("button", { name: "archive" })).toHaveAttribute(
      "data-bot",
      "null",
    );

    const atlas = within(row("Atlas"));
    expect(atlas.getByText("paused")).toBeInTheDocument();
    expect(atlas.getByRole("button", { name: "resume" })).toBeInTheDocument();
    expect(atlas.queryByRole("button", { name: "archive" })).toBeNull();

    const cuso = within(row("Cuso"));
    expect(cuso.getByRole("link")).toBeInTheDocument();
    expect(cuso.queryByRole("button")).toBeNull();
  });

  it("lists archived bots apart, with Restore only for a manager", async () => {
    const archivedAt = new Date("2026-11-22");
    await renderSections([
      bot({ id: "old", name: "Old", archivedAt, canRestore: true }),
      bot({ id: "older", name: "Older", archivedAt }),
    ]);

    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("archivedTitle")).toBeInTheDocument();
    expect(
      within(row("Old")).getByRole("button", { name: "restore" }),
    ).toBeInTheDocument();
    expect(
      within(row("Old")).getByText('archivedOn:{"date":"Nov 22"}'),
    ).toBeInTheDocument();
    expect(within(row("Older")).queryByRole("button")).toBeNull();
  });

  it("shows no Archived section without archived bots", async () => {
    await renderSections([bot({})]);
    expect(screen.queryByText("archivedTitle")).not.toBeInTheDocument();
  });
});
