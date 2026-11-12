import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMine = vi.fn();
const listRooms = vi.fn();
const listMessages = vi.fn();
const listImportantMessages = vi.fn();
const sokoBotHome = vi.fn();
const needsYouPanel = vi.fn();
const chatLanding = vi.fn();
const getWorkspaceAccess = vi.fn();
const listCoworkers = vi.fn(async () => []);
const getActivitySummary = vi.fn(async () => ({ awaitingInput: 2 }));
const listNeedsYou = vi.fn(async () => []);
const loadMyDay = vi.fn(async (_today: string) => null);
const myDay = vi.fn();
const loadFollowUps = vi.fn(async (_today: string) => null);
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
  // 23:30 UTC is already the next day in Zurich.
  getNow: async () => new Date("2026-11-09T23:30:00.000Z"),
  getTimeZone: async () => "Europe/Zurich",
}));
vi.mock("./components/my-day", () => ({
  loadMyDay: (today: string) => loadMyDay(today),
  MyDay: (props: unknown) => {
    myDay(props);
    return <div>my day</div>;
  },
}));
vi.mock("./components/follow-ups", () => ({
  loadFollowUps: (today: string) => loadFollowUps(today),
  FollowUps: () => <div>follow-ups</div>,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({ user: { id: "user-1", name: "Alice Doe" } }),
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getActiveOrganizationId: async () => null,
    getWorkspaceAccess: () => getWorkspaceAccess(),
  },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: () => getMine() },
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listRooms: (...args: unknown[]) => listRooms(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
    listImportantMessages: () => listImportantMessages(),
  },
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: () => listCoworkers() },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getActivitySummary: () => getActivitySummary(),
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
  ChatLanding: (props: {
    myDay?: React.ReactNode;
    needsYou?: React.ReactNode;
  }) => {
    chatLanding(props);
    return (
      <div>
        coworker welcome
        {props.myDay}
        {props.needsYou}
      </div>
    );
  },
}));
vi.mock("@/lib/services/notification.service", () => ({
  notificationService: { listNeedsYou: () => listNeedsYou() },
}));
vi.mock("@/app/projects/components/workspace-column", () => ({
  panelFeed: <T,>(promise: Promise<T[]>) => promise.catch(() => null),
  NeedsYouPanel: (props: unknown) => {
    needsYouPanel(props);
    return <div>needs you</div>;
  },
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

import WelcomePage, { generateMetadata } from "./page";

async function renderPage() {
  render(await WelcomePage({ searchParams: Promise.resolve({}) }));
}

describe("WelcomePage", () => {
  beforeEach(() => {
    getWorkspaceAccess.mockResolvedValue({ gate: "ready" });
    listRooms.mockResolvedValue({
      rooms: [
        {
          id: "room-1",
          kind: "direct",
          organizationId: null,
          updatedAt: new Date(),
          userMembers: [{ id: "user-1" }],
          coworkerMembers: [],
          sokoBotMembers: [{ id: "bot-1" }],
        },
      ],
    });
    listImportantMessages.mockResolvedValue([
      {
        roomId: "room-1",
        messageId: "reply-1",
        parentMessageId: "parent-1",
        roomName: "Joseph",
        roomKind: "direct",
        senderName: "Joseph",
        senderImageUrl: null,
        excerpt: "Can you confirm Friday?",
        bucket: "needsYou",
        createdAt: new Date(),
        dueAt: null,
        inReplyTo: null,
      },
    ]);
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

  it("sends an account without a workspace to setup before reading", async () => {
    getWorkspaceAccess.mockResolvedValue({ gate: "identity-onboarding" });
    getMine.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /setup");
    expect(getMine).not.toHaveBeenCalled();
    expect(listCoworkers).not.toHaveBeenCalled();
    expect(getActivitySummary).not.toHaveBeenCalled();
    expect(listNeedsYou).not.toHaveBeenCalled();
    expect(loadMyDay).not.toHaveBeenCalled();
    expect(loadFollowUps).not.toHaveBeenCalled();
    expect(chatLanding).not.toHaveBeenCalled();
  });

  it("puts My day, due by the reader's own day, on the coworker welcome", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByText("my day")).toBeTruthy();
    expect(loadMyDay).toHaveBeenCalledWith("2026-11-10");
  });

  it("puts contact follow-ups, due by the same day, under My day", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByText("follow-ups")).toBeTruthy();
    expect(loadFollowUps).toHaveBeenCalledWith("2026-11-10");
  });

  it("keeps the coworker welcome without a Soko Bot", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText("coworker welcome")).toBeTruthy();
    expect(sokoBotHome).not.toHaveBeenCalled();
  });

  it("puts the quiet Needs you under the coworker welcome", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByText("needs you")).toBeTruthy();
    expect(needsYouPanel).toHaveBeenCalledTimes(1);
    expect(needsYouPanel).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true, projects: {} }),
    );
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
    expect(listRooms).toHaveBeenCalledWith();
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        chats: [
          expect.objectContaining({
            roomId: "room-1",
            messageId: "reply-1",
            title: "Can you confirm Friday?",
            from: "Joseph",
          }),
        ],
        summary: { awaitingInput: 2 },
        teamTasks: [expect.objectContaining({ name: "Plan my week" })],
        myDay: expect.anything(),
        needsYou: expect.anything(),
      }),
    );
  });
});

describe("generateMetadata", () => {
  it("names the tab Home instead of the layout's marketing line", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Metadata.home",
    });
  });
});
