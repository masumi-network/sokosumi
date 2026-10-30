import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSharedMock = vi.fn();
const chatStateMock = vi.fn();
const consoleMock = vi.fn();
const loadAdsMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: async () => ({ user: { name: "Ada", image: null } }),
}));
vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class extends Error {},
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    listShared: () => listSharedMock(),
    getChatState: () => chatStateMock(),
    getStats: async () => null,
    getMyUsage: async () => null,
    listIntegrations: async () => null,
    searchIntegrationCatalog: async () => [],
  },
}));
vi.mock("@/lib/soko-bot/load-bot-ad-accounts", () => ({
  loadBotAdAccounts: (...a: unknown[]) => loadAdsMock(...a),
}));
vi.mock(
  "@/app/soko-bots/components/reactivate-shared-bot-button.client",
  () => ({
    ReactivateSharedBotButton: ({ botId }: { botId: string }) => (
      <div data-testid="reactivate" data-bot-id={botId} />
    ),
  }),
);
vi.mock("@/app/personal-assistant/components/console/console.client", () => ({
  SokoBotConsole: (props: { canManage: boolean }) => {
    consoleMock(props);
    return <div data-testid="console" />;
  },
}));

import SharedSokoBotPage from "./page";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

async function renderPage(
  archivedAt: Date | null,
  viewerCanManage = true,
): Promise<void> {
  listSharedMock.mockResolvedValue([
    {
      id: BOT_ID,
      name: "Ops",
      archivedAt,
      sharedRoomId: "room-1",
      projectId: "project-1",
      viewerCanManage,
    },
  ]);
  chatStateMock.mockResolvedValue({ bot: { viewerCanManage } });
  render(
    await SharedSokoBotPage({
      params: Promise.resolve({ id: BOT_ID }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe("SharedSokoBotPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAdsMock.mockResolvedValue([]);
  });

  it("hands the console the ad accounts of the bot's own Project", async () => {
    await renderPage(null);
    expect(loadAdsMock).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(consoleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ads: { accounts: [], projectId: "project-1" },
      }),
    );
  });

  it("renders the console for a live shared bot", async () => {
    await renderPage(null);
    expect(screen.getByTestId("console")).toBeInTheDocument();
    expect(consoleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: BOT_ID,
        canManage: true,
        sharedRoomId: "room-1",
      }),
    );
  });

  it("lets a member who cannot manage see the console without managing", async () => {
    await renderPage(null, false);
    expect(consoleMock).toHaveBeenCalledWith(
      expect.objectContaining({ botId: BOT_ID, canManage: false }),
    );
  });

  it("shows a read-only notice instead of a console for an archived bot", async () => {
    await renderPage(new Date("2026-10-01"));
    expect(screen.getByTestId("archived-shared-bot")).toBeInTheDocument();
    expect(screen.queryByTestId("console")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "back" })).toHaveAttribute(
      "href",
      "/soko-bots",
    );
  });

  it("offers Reactivate on an archived bot only to a viewer who manages it", async () => {
    await renderPage(new Date("2026-10-01"));
    expect(screen.getByTestId("reactivate")).toHaveAttribute(
      "data-bot-id",
      BOT_ID,
    );
  });

  it("offers no Reactivate to a member who cannot manage the bot", async () => {
    await renderPage(new Date("2026-10-01"), false);
    expect(screen.getByTestId("archived-shared-bot")).toBeInTheDocument();
    expect(screen.queryByTestId("reactivate")).not.toBeInTheDocument();
  });

  async function outcome(): Promise<string> {
    return SharedSokoBotPage({
      params: Promise.resolve({ id: BOT_ID }),
      searchParams: Promise.resolve({}),
    }).then(
      () => "rendered",
      (error: Error) => error.message,
    );
  }

  it.each([
    ["Core sends no sharedBots", null, { bot: {} }],
    ["the id is the viewer's own or another personal bot", [], { bot: {} }],
    ["the id is unknown", [], null],
    [
      "a shared bot the viewer cannot reach",
      [{ id: "other-shared-bot" }],
      null,
    ],
  ])(
    "sends the viewer to the assistant page when %s",
    async (_case, shared, state) => {
      listSharedMock.mockResolvedValue(shared);
      chatStateMock.mockResolvedValue(state);
      await expect(outcome()).resolves.toBe("redirect:/personal-assistant");
      expect(consoleMock).not.toHaveBeenCalled();
    },
  );

  it("sends the viewer to the assistant page when Core cannot list shared bots", async () => {
    listSharedMock.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 503 }),
    );
    chatStateMock.mockResolvedValue({ bot: {} });
    await expect(outcome()).resolves.toBe("redirect:/personal-assistant");
  });

  it("sends the viewer to the assistant page when Core cannot read the bot", async () => {
    listSharedMock.mockResolvedValue([
      { id: BOT_ID, name: "Ops", archivedAt: null, sharedRoomId: "room-1" },
    ]);
    chatStateMock.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 503 }),
    );
    await expect(outcome()).resolves.toBe("redirect:/personal-assistant");
  });
});
