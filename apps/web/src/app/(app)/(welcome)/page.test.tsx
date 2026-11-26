import { cleanup, render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMine = vi.fn();
const lastFailure = vi.fn(() => null as unknown);
const listRooms = vi.fn();
const listMessages = vi.fn();
const listImportantMessages = vi.fn();
const sokoBotHome = vi.fn();
const needsYouPanel = vi.fn();
const sokoBotSetup = vi.fn();
const getWorkspaceAccess = vi.fn();
const getActivitySummary = vi.fn(async (_query: { scope: string }) => ({
  awaitingInput: 2,
}));
const getActiveOrganizationId = vi.fn(async (): Promise<string | null> => null);
const readNeedsYou = vi.fn(async () => ({
  notifications: [] as unknown[],
  total: 0,
}));
const loadMyDay = vi.fn(async (_today: string) => null);
const myDay = vi.fn();
const listProjects = vi.fn(async (_query: { limit: number }) => ({
  projects: [{ id: "project-1", name: "Launch", logo: null }],
}));
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});

const connection = vi.fn(async () => {});
const SESSION = { user: { id: "user-1", name: "Alice Doe" } };
const getSession = vi.fn(async () => SESSION);
const getSessionResult = vi.fn(async (): Promise<unknown> => ok(SESSION));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connection() }));
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
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (path: string) => redirect(path),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSession(),
  getSessionResult: () => getSessionResult(),
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
vi.mock("@/lib/services/notification.service", () => ({
  notificationService: { readNeedsYou: () => readNeedsYou() },
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
vi.mock("./components/soko-bot-setup", () => ({
  SokoBotSetup: (props: unknown) => {
    sokoBotSetup(props);
    return <div>soko bot setup</div>;
  },
}));
vi.mock("./components/soko-bot-home", () => ({
  SokoBotHome: (props: unknown) => {
    sokoBotHome(props);
    return <div>bot home</div>;
  },
}));

import { composeSokoBotIntroduction } from "@sokosumi/soko-bot";
import { expectConsole } from "@sokosumi/utils/test-console";
import WelcomePage, { generateMetadata } from "./home-page";

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
    expect(getActivitySummary).not.toHaveBeenCalled();
    expect(readNeedsYou).not.toHaveBeenCalled();
    expect(loadMyDay).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
    expect(sokoBotSetup).not.toHaveBeenCalled();
  });

  it("offers to set up a Soko Bot to a user without one", async () => {
    getMine.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText("soko bot setup")).toBeTruthy();
    expect(sokoBotHome).not.toHaveBeenCalled();
    expect(screen.queryByText("my day")).toBeNull();
    expect(screen.queryByText("needs you")).toBeNull();
  });

  it("offers the setup when the bot cannot be read", async () => {
    getMine.mockRejectedValue(new Error("feature off"));
    await renderPage();
    expect(screen.getByText("soko bot setup")).toBeTruthy();
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
    expect(readNeedsYou).toHaveBeenCalled();
    expect(getActivitySummary).toHaveBeenCalledWith({ scope: "owned" });

    answerBot(null);
    await page;
    expect(screen.getByText("soko bot setup")).toBeTruthy();
  });

  it("counts the whole workspace's day in an org", async () => {
    getActiveOrganizationId.mockResolvedValueOnce("org-1");
    getMine.mockResolvedValue(null);
    await renderPage();

    expect(getActivitySummary).toHaveBeenCalledWith({ scope: "workspace" });
  });

  it("passes Needs you's own total from its feed read in an org", async () => {
    getActiveOrganizationId.mockResolvedValueOnce("org-1");
    // Summary counts 1 waiting Task in this workspace; Needs you holds 3
    // requests (a Job ask, another workspace's Task): neither is the other.
    getActivitySummary.mockResolvedValueOnce({ awaitingInput: 1 });
    readNeedsYou.mockResolvedValueOnce({
      notifications: [{ id: "n1" }, { id: "n2" }],
      total: 3,
    });
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(getActivitySummary).toHaveBeenCalledTimes(1);
    expect(readNeedsYou).toHaveBeenCalledTimes(1);
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: { awaitingInput: 1 },
        inOrganization: true,
        needsYouCount: 3,
      }),
    );
  });

  it("leaves the requests count out when Needs you fails to load", async () => {
    expectConsole("warn", "Workspace column feed failed");
    getActiveOrganizationId.mockResolvedValueOnce("org-1");
    readNeedsYou.mockRejectedValueOnce(new Error("core down"));
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({ needsYouCount: null }),
    );
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
      expect.objectContaining({ leads: [], quiet: true }),
    );
    // The first page of projects is read next to the rows, not after them.
    expect(listProjects).toHaveBeenCalledWith({ limit: 20 });
  });

  it("lists the reader's latest chat with the bot once it is read", async () => {
    listImportantMessages.mockResolvedValueOnce([]);
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(listMessages).toHaveBeenCalledWith("room-1", { limit: 20 });
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: [
          expect.objectContaining({
            roomId: "room-1",
            messageId: "msg-1",
            title: "Plan my week",
            // The reader wrote it, to the bot.
            from: "App.Chat.Landing.SokoBotHome.youTo",
          }),
        ],
      }),
    );
  });

  it("lists the bot's reply to that chat once it answers", async () => {
    listImportantMessages.mockResolvedValueOnce([]);
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    listMessages.mockResolvedValueOnce({
      messages: [
        {
          id: "msg-1",
          content: "Plan my week",
          createdAt: new Date(),
          deletedAt: null,
          parentMessageId: null,
          sender: { type: "user", user: { id: "user-1" } },
        },
        {
          id: "msg-2",
          content: "Here is your week.",
          createdAt: new Date(),
          deletedAt: null,
          parentMessageId: null,
          sender: { type: "sokoBot", sokoBot: { id: "bot-1" } },
          metadata: { in_reply_to_message_id: "msg-1" },
        },
      ],
    });
    await renderPage();
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: [
          expect.objectContaining({
            messageId: "msg-2",
            title: "Here is your week.",
            from: "App.Chat.Landing.SokoBotHome.replied",
          }),
        ],
      }),
    );
  });

  // The summary read returns null when Core fails it; Home still renders
  // and only the day's section says so.
  it("renders Home without the day's numbers when their read fails", async () => {
    getActivitySummary.mockResolvedValueOnce(
      null as unknown as { awaitingInput: number },
    );
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(screen.getByText("bot home")).toBeTruthy();
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({ summary: null }),
    );
  });

  it("puts the bot's unread welcome first in Needs you", async () => {
    const at = new Date("2026-11-24T09:00:00Z");
    listMessages.mockResolvedValueOnce({
      messages: [
        {
          id: "welcome-1",
          // Posted before the owner renamed themselves: the marker, not the
          // text, makes it the welcome.
          content: composeSokoBotIntroduction({
            name: "Pip",
            ownerName: "Alicia Old",
          }),
          metadata: { sokoBotIntroduction: true },
          createdAt: at,
          deletedAt: null,
          parentMessageId: null,
          sender: { type: "sokoBot", sokoBot: { id: "bot-1" } },
        },
      ],
      nextCursor: null,
      firstUnreadMessageId: "welcome-1",
    });
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Pip",
      status: "ERROR",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    lastFailure.mockReturnValue({ roomId: null, messageId: null });
    await renderPage();
    expect(needsYouPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        leads: [
          {
            title: "App.Chat.Landing.SokoBotHome.welcome",
            detail: "App.Chat.Landing.SokoBotHome.openChat",
            href: "/chat/rooms/room-1?message=welcome-1",
            at,
            kind: "message",
          },
          expect.objectContaining({
            title: "App.Chat.Landing.SokoBotHome.failedWork",
          }),
        ],
      }),
    );
  });

  // The reads are cached, so a link prefetch carries Home.
  // connection() would drop it back to the skeleton.
  it("renders the bot home while the request has not come", async () => {
    connection.mockReturnValueOnce(new Promise(() => {}));
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(screen.getByText("bot home")).toBeTruthy();
    // My day and the Needs you projects are uncached: they wait for the
    // request, so a prefetch leaves them as holes.
    expect(loadMyDay).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });

  // A prefetch must not keep a session outage as a signed-out Home: the
  // click renders fresh with the session read again.
  it("renders a session outage fresh on the click", async () => {
    getSessionResult.mockResolvedValueOnce(err({ reason: "timeout" }));
    getMine.mockResolvedValue({
      id: "bot-1",
      name: "Joseph",
      avatarSeed: null,
      avatarImageUrl: null,
    });
    await renderPage();
    expect(getSession).toHaveBeenCalledOnce();
    expect(sokoBotHome).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1" }),
    );
  });

  // A Core blip on the access read must not be kept as "not set up": the
  // click would redirect to setup with nothing to repair it.
  it("reads a failed workspace access again, fresh, instead of keeping it", async () => {
    getWorkspaceAccess
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValueOnce({ gate: "ready" });
    getMine.mockResolvedValue(null);
    await renderPage();
    expect(redirect).not.toHaveBeenCalled();
    expect(getWorkspaceAccess).toHaveBeenCalledTimes(2);
    expect(screen.getByText("soko bot setup")).toBeTruthy();
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
          leads: [
            {
              title: "App.Chat.Landing.SokoBotHome.failedReply",
              detail: "App.Chat.Landing.SokoBotHome.openChat",
              href: `/chat/rooms/${roomId}?message=${messageId}`,
            },
          ],
        }),
      );
    });

    it("sends other failed work to the bot's page in neutral words", async () => {
      getMine.mockResolvedValue(failedBot);
      lastFailure.mockReturnValue({ roomId: null, messageId: null });
      await renderPage();
      expect(needsYouPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          leads: [
            {
              title: "App.Chat.Landing.SokoBotHome.failedWork",
              detail: "App.Chat.Landing.SokoBotHome.openBot",
              href: "/personal-assistant",
            },
          ],
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
