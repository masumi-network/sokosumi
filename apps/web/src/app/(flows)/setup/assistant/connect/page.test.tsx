import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readRouteSessionMock = vi.fn();
const redirectMock = vi.fn();
const getMineMock = vi.fn();
const listIntegrationsMock = vi.fn();
const createRoomMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  signInRedirectPath: async () => "/signin",
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: (...args: unknown[]) => getMineMock(...args),
    listIntegrations: (...args: unknown[]) => listIntegrationsMock(...args),
  },
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    createRoom: (...args: unknown[]) => createRoomMock(...args),
  },
}));

vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/app/components/core-unavailable-notice.client", () => ({
  CoreUnavailableNotice: () => <div data-testid="core-unavailable-notice" />,
}));

vi.mock("./components/assistant-connect-step.client", () => ({
  AssistantConnectStep: ({
    botName,
    chatUrl,
    returnTo,
    offers,
  }: {
    botName: string;
    chatUrl: string;
    returnTo: string;
    offers: { provider: string }[];
  }) => (
    <div data-testid="connect-step">
      {botName}|{chatUrl}|{returnTo}|{offers.length}
    </div>
  ),
}));

async function renderPage(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return Page({ searchParams: Promise.resolve(searchParams) });
}

describe("SetupAssistantConnectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: { user: { id: "user-1" }, session: { id: "session-1" } },
    });
    getMineMock.mockResolvedValue({ id: "bot-1", name: "Atlas" });
    listIntegrationsMock.mockResolvedValue({
      configured: true,
      integrations: [],
    });
    createRoomMock.mockResolvedValue({ id: "room-1" });
  });

  it("offers mail and calendar for the new bot, ending in its chat", async () => {
    render(await renderPage({ next: "/tasks" }));

    expect(createRoomMock).toHaveBeenCalledWith({
      kind: "direct",
      memberUserIds: [],
      coworkerIds: [],
      sokoBotIds: ["bot-1"],
    });
    expect(screen.getByTestId("connect-step").textContent).toBe(
      "Atlas|/chat/rooms/room-1|/setup/assistant/connect?next=%2Ftasks|3",
    );
  });

  it("goes to the chat when mail and calendar are covered", async () => {
    listIntegrationsMock.mockResolvedValue({
      configured: true,
      integrations: [
        { provider: "outlook", status: "ACTIVE", kinds: ["email", "calendar"] },
      ],
    });

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/chat/rooms/room-1");
  });

  it("goes to the chat when integrations are off", async () => {
    listIntegrationsMock.mockResolvedValue({
      configured: false,
      integrations: [],
    });

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/chat/rooms/room-1");
  });

  it("goes straight on without a bot", async () => {
    getMineMock.mockResolvedValue(null);

    await expect(renderPage({ next: "/tasks" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirectMock).toHaveBeenCalledWith("/tasks");
    expect(createRoomMock).not.toHaveBeenCalled();
  });
});
