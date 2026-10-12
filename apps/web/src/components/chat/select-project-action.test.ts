import { beforeEach, describe, expect, it, vi } from "vitest";

const { read, getMessage, send, start, session, getTurn, getWorkspaces } =
  vi.hoisted(() => ({
    read: vi.fn(),
    getMessage: vi.fn(),
    send: vi.fn(),
    start: vi.fn(),
    session: vi.fn(),
    getTurn: vi.fn(),
    getWorkspaces: vi.fn(),
  }));
vi.mock("@/lib/clients/core.client", () => ({
  coreClientNoRedirect: {
    getChatRoomMessageResults: read,
    getMySokoBotTurnResults: read,
  },
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: { getMessage },
}));
vi.mock("@/app/chat/actions", () => ({ sendRoomMessageAction: send }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  startSokoBotTurnAction: start,
}));

vi.mock("@/lib/auth/auth.server", () => ({ getSession: session }));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getTurn },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getMyWorkspaces: getWorkspaces },
}));

import { selectChatProjectAction } from "./select-project-action";

const id = "00000000-0000-4000-8000-000000000001";
const input = {
  source: { roomId: id, messageId: id },
  previewId: id,
  projectId: id,
};
describe("chat project selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({
      user: { id: "owner" },
      session: { activeOrganizationId: null },
    });
    getTurn.mockResolvedValue({
      workspaceId: "workspace",
      userMessage: "Generate a book image",
      finalAnswer: "Which project?",
    });
    getWorkspaces.mockResolvedValue({
      workspaces: [{ id: "workspace", organizationId: null }],
    });
    read.mockResolvedValue({
      data: [
        {
          id,
          state: "available",
          kind: "project_selection",
          projectOptions: [{ id, name: "Books" }],
        },
      ],
    });
    getMessage.mockResolvedValue({
      parentMessageId: "thread",
      sender: { type: "sokoBot", sokoBot: { id: "bot" } },
    });
    send.mockResolvedValue({ ok: true });
    start.mockResolvedValue({ ok: true });
  });
  it("sends the verified name and ID to the original bot in the original thread", async () => {
    expect((await selectChatProjectAction(input)).ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      id,
      `Use project "Books" (project ID: ${id}).`,
      [],
      {
        clientMessageId: expect.any(String),
        quote: { messageId: id },
        mentionedSokoBotIds: ["bot"],
        parentMessageId: "thread",
      },
    );
    expect(start).not.toHaveBeenCalled();
  });
  it("uses the normal assistant turn flow for personal chat", async () => {
    expect(
      (await selectChatProjectAction({ ...input, source: { turnId: id } })).ok,
    ).toBe(true);
    expect(start).toHaveBeenCalledWith({
      input: {
        clientTurnId: expect.any(String),
        message: `Continue this request: "Generate a book image"\nYour question: "Which project?"\nUse project "Books" (project ID: ${id}).`,
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    [{ id, state: "unavailable" }],
    [{ id, state: "available", kind: "project_selection", projectOptions: [] }],
    [
      {
        id,
        state: "available",
        kind: "task",
        projectOptions: [{ id, name: "Books" }],
      },
    ],
  ])("rejects revoked, removed and non-selector choices", async (result) => {
    read.mockResolvedValue({ data: result });
    expect((await selectChatProjectAction(input)).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it("rejects browser-supplied labels and preserves a send failure", async () => {
    expect(
      (await selectChatProjectAction({ ...input, name: "Injected" })).ok,
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
    send.mockResolvedValue({ ok: false });
    expect((await selectChatProjectAction(input)).ok).toBe(false);
  });

  it("keeps retries idempotent and refuses personal continuation in a different workspace", async () => {
    await selectChatProjectAction(input);
    const first = send.mock.calls.at(-1)?.[3].clientMessageId;
    await selectChatProjectAction({
      projectId: id,
      previewId: id,
      source: { messageId: id, roomId: id },
    });
    expect(send.mock.calls.at(-1)?.[3].clientMessageId).toBe(first);
    getWorkspaces.mockResolvedValue({
      workspaces: [{ id: "different", organizationId: null }],
    });
    const calls = start.mock.calls.length;
    expect(
      (await selectChatProjectAction({ ...input, source: { turnId: id } })).ok,
    ).toBe(false);
    expect(start).toHaveBeenCalledTimes(calls);
  });
});
