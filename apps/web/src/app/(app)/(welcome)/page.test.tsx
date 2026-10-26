import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMine = vi.fn();
const listRooms = vi.fn();
const listMessages = vi.fn();
const sokoBotHome = vi.fn();

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({ user: { id: "user-1", name: "Alice Doe" } }),
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getActiveOrganizationId: async () => null },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: () => getMine() },
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listRooms: (...args: unknown[]) => listRooms(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
  },
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: async () => [] },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getActivitySummary: async () => ({ awaitingInput: 2 }),
    listTasks: async () => ({
      tasks: [
        {
          id: "task-1",
          name: "Plan my week",
          status: "COMPLETED",
          updatedAt: new Date(),
          assignee: null,
          owner: null,
        },
      ],
    }),
  },
}));
vi.mock("@/app/chat/components/chat-landing-notice", () => ({
  ChatLandingNotice: () => null,
}));
vi.mock("@/app/chat/components/landing/chat-landing", () => ({
  ChatLanding: () => <div>coworker welcome</div>,
}));
vi.mock("@/app/chat/components/landing/chat-landing.mobile", () => ({
  ChatLandingMobile: () => null,
}));
vi.mock("./components/soko-bot-home", () => ({
  SokoBotHome: (props: unknown) => {
    sokoBotHome(props);
    return <div>bot home</div>;
  },
}));

import WelcomePage from "./page";

async function renderPage() {
  render(await WelcomePage({ searchParams: Promise.resolve({}) }));
}

describe("WelcomePage", () => {
  beforeEach(() => {
    listRooms.mockResolvedValue({
      rooms: [
        {
          id: "room-1",
          kind: "direct",
          userMembers: [{ id: "user-1" }],
          coworkerMembers: [],
          sokoBotMembers: [{ id: "bot-1" }],
        },
      ],
    });
    listMessages.mockResolvedValue({
      messages: [
        {
          id: "msg-1",
          content: "Plan my week",
          createdAt: new Date(),
          deletedAt: null,
          parentMessageId: null,
          sender: { type: "user", user: { id: "user-1" } },
        },
      ],
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the coworker welcome without a Soko Bot", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText("coworker welcome")).toBeTruthy();
    expect(sokoBotHome).not.toHaveBeenCalled();
  });

  it("keeps the coworker welcome when the bot cannot be read", async () => {
    getMine.mockRejectedValue(new Error("feature off"));
    await renderPage();
    expect(screen.getByText("coworker welcome")).toBeTruthy();
  });

  it("shows the bot home with its room and the team's day", async () => {
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(screen.getByText("bot home")).toBeTruthy();
    expect(listRooms).toHaveBeenCalledWith("direct");
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        summary: { awaitingInput: 2 },
        teamTasks: [expect.objectContaining({ name: "Plan my week" })],
      }),
    );
  });
});
