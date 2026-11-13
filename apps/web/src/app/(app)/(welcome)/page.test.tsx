import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMine = vi.fn();
const lastFailure = vi.fn(() => null as unknown);
const listRooms = vi.fn();
const listMessages = vi.fn();
const listImportantMessages = vi.fn();
const sokoBotHome = vi.fn();
const needsYouPanel = vi.fn();
const chatLanding = vi.fn();
const getWorkspaceAccess = vi.fn();
const listCoworkers = vi.fn(async (_capability: string) => []);
const getActivitySummary = vi.fn(async (_query: { scope: string }) => ({
  awaitingInput: 2,
}));
const getActiveOrganizationId = vi.fn(async (): Promise<string | null> => null);
const listNeedsYou = vi.fn(async () => []);
const loadMyDay = vi.fn(async (_today: string) => null);
const myDay = vi.fn();
const listProjects = vi.fn(async (_query: { limit: number }) => ({
  projects: [{ id: "project-1", name: "Launch", logo: null }],
}));
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
  countOverdue: () => Promise.resolve(0),
  MyDay: (props: unknown) => {
    myDay(props);
    return <div>my day</div>;
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({ user: { id: "user-1", name: "Alice Doe" } }),
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getActiveOrganizationId: () => getActiveOrganizationId(),
    getWorkspaceAccess: () => getWorkspaceAccess(),
  },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMineWithLastFailure: async () => ({
      sokoBot: await getMine(),
      lastFailure: lastFailure(),
    }),
  },
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listRooms: (...args: unknown[]) => listRooms(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
    listImportantMessages: () => listImportantMessages(),
  },
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (capability: string) => listCoworkers(capability),
  },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getActivitySummary: (query: { scope: string }) => getActivitySummary(query),
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
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: (query: { limit: number }) => listProjects(query),
  },
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
    lastFailure.mockReturnValue(null);
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
    expect(listProjects).not.toHaveBeenCalled();
    expect(chatLanding).not.toHaveBeenCalled();
  });

  it("puts My day, due by the reader's own day, on the coworker welcome", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByText("my day")).toBeTruthy();
    expect(loadMyDay).toHaveBeenCalledWith("2026-11-10");
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
      expect.objectContaining({ quiet: true }),
    );
    // The first page of projects is read next to the rows, not after them.
    const [{ projects }] = needsYouPanel.mock.calls[0] as [
      { projects: Promise<unknown> },
    ];
    expect(listProjects).toHaveBeenCalledWith({ limit: 20 });
    await expect(projects).resolves.toEqual({
      "project-1": { name: "Launch", logo: null },
    });
  });

  it("keeps the coworker welcome when the bot cannot be read", async () => {
    getMine.mockRejectedValue(new Error("feature off"));
    await renderPage();
    expect(screen.getByText("coworker welcome")).toBeTruthy();
  });

  it("starts every read that needs no bot before the bot read answers", async () => {
    let answerBot: (bot: null) => void = () => {};
    getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        answerBot = resolve;
      }),
    );

    const page = renderPage();
    await vi.waitFor(() => expect(getMine).toHaveBeenCalled());
    expect(loadMyDay).toHaveBeenCalled();
    expect(listNeedsYou).toHaveBeenCalled();
    expect(getActivitySummary).toHaveBeenCalledWith({ scope: "owned" });
    expect(listCoworkers).toHaveBeenCalledWith("chat");

    answerBot(null);
    await page;
    expect(screen.getByText("coworker welcome")).toBeTruthy();
  });

  it("counts the whole workspace's day in an org", async () => {
    getActiveOrganizationId.mockResolvedValueOnce("org-1");
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(getActivitySummary).toHaveBeenCalledWith({ scope: "workspace" });
  });

  it("still fails the coworker welcome when coworkers cannot be read", async () => {
    getMine.mockResolvedValue(null);
    listCoworkers.mockRejectedValueOnce(new Error("core down"));

    await expect(renderPage()).rejects.toThrow("core down");
  });

  it("shows the bot home when only the coworker read fails", async () => {
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    listCoworkers.mockRejectedValueOnce(new Error("core down"));

    await renderPage();
    expect(screen.getByText("bot home")).toBeTruthy();
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
    expect(needsYouPanel).toHaveBeenCalledWith(
      expect.objectContaining({ lead: undefined }),
    );
  });

  describe("a bot whose last turn failed", () => {
    const failedBot = {
      id: "bot-1",
      name: "Pip",
      status: "ERROR",
      avatarSeed: null,
      avatarImageUrl: null,
    };

    it.each([
      ["its Direct", "room-1", "shell-1"],
      // Not the Direct: the reply that failed was in a channel.
      ["a channel", "channel-9", "shell-2"],
    ])("opens the failed reply in %s", async (_where, roomId, messageId) => {
      getMine.mockResolvedValue(failedBot);
      lastFailure.mockReturnValue({ roomId, messageId });
      await renderPage();
      expect(needsYouPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          lead: {
            title: "App.Chat.Landing.SokoBotHome.failedReply",
            detail: "App.Chat.Landing.SokoBotHome.openChat",
            href: `/chat/rooms/${roomId}?message=${messageId}`,
          },
        }),
      );
    });

    it("sends other failed work to the bot's page in neutral words", async () => {
      getMine.mockResolvedValue(failedBot);
      lastFailure.mockReturnValue({ roomId: null, messageId: null });
      await renderPage();
      expect(needsYouPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          lead: {
            title: "App.Chat.Landing.SokoBotHome.failedWork",
            detail: "App.Chat.Landing.SokoBotHome.openBot",
            href: "/personal-assistant",
          },
        }),
      );
    });
  });
});

describe("generateMetadata", () => {
  it("names the tab Home instead of the layout's marketing line", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Metadata.home",
    });
  });
});
