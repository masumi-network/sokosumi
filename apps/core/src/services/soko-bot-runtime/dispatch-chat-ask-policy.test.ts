import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSokoBotVersion: vi.fn(),
  projectFindMany: vi.fn(),
  resolveChatResultReference: vi.fn(),
}));

vi.mock("@sokosumi/soko-bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/soko-bot")>();
  return {
    ...actual,
    getSokoBotVersion: mocks.getSokoBotVersion,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findMany: mocks.projectFindMany },
  },
}));

vi.mock("@/services/chat-result-preview.service", () => ({
  resolveChatResultReference: mocks.resolveChatResultReference,
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { dispatchChatTools } from "./dispatch-chat";
import type { RuntimeOperations } from "./operations";

const P1 = { id: "01960001-0001-7001-8001-000000000001", name: "Acme Brand" };
const P2 = { id: "01960001-0001-7001-8001-000000000002", name: "Founder Desk" };

function authorized(overrides: Record<string, unknown> = {}) {
  return {
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      actingUserId: "user-1",
      requestedByUserId: "user-1",
      parentTurnId: null,
      botProjectId: null,
      workspaceId: "ws-1",
      eveSessionId: null,
      versionId: "v36",
      source: "CHAT",
      chainDepth: 0,
      ...overrides,
    },
    askedByKind: "OWNER",
  } as unknown as AuthorizedSokoBotRuntime;
}

const runtimeStub = {} as RuntimeOperations;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSokoBotVersion.mockReturnValue({ id: "v36" });
  mocks.resolveChatResultReference.mockResolvedValue({
    kind: "project_selection",
    status: "AVAILABLE",
    title: "Choose a project",
  });
  mocks.projectFindMany.mockResolvedValue([P1, P2]);
});

describe("dispatchChatTools preview_result(project_selection) with askPolicy", () => {
  it("keeps flag-off versions unchanged with zero extra DB queries", async () => {
    const result = await dispatchChatTools(
      runtimeStub,
      {
        sessionId: "s-1",
        turnId: "turn-1",
        toolCallId: "tc-1",
        capability: "preview_result",
        input: {
          reference: { kind: "project_selection", projectIds: [P1.id] },
        },
      },
      authorized(),
    );

    expect(result).toMatchObject({ title: "Choose a project" });
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
    expect(mocks.resolveChatResultReference).toHaveBeenCalledTimes(1);
  });

  it("refuses redundant project_selection on askPolicy when only 1 open project exists or bot is pinned to 1 project", async () => {
    mocks.getSokoBotVersion.mockReturnValue({ id: "v40-e1", askPolicy: true });
    mocks.projectFindMany.mockResolvedValue([P1]);

    await expect(
      dispatchChatTools(
        runtimeStub,
        {
          sessionId: "s-1",
          turnId: "turn-1",
          toolCallId: "tc-1",
          capability: "preview_result",
          input: {
            reference: {
              kind: "project_selection",
              projectIds: [P1.id, P2.id],
            },
          },
        },
        authorized({ versionId: "v40-e1" }),
      ),
    ).rejects.toThrow(SokoBotRuntimeValidationError);

    mocks.projectFindMany.mockResolvedValue([P1, P2]);
    await expect(
      dispatchChatTools(
        runtimeStub,
        {
          sessionId: "s-1",
          turnId: "turn-1",
          toolCallId: "tc-2",
          capability: "preview_result",
          input: {
            reference: {
              kind: "project_selection",
              projectIds: [P1.id, P2.id],
            },
          },
        },
        authorized({ versionId: "v40-e1", botProjectId: P1.id }),
      ),
    ).rejects.toThrow(SokoBotRuntimeValidationError);

    expect(mocks.resolveChatResultReference).not.toHaveBeenCalled();
  });

  it("leaves the owner free to choose among 2+ open projects (including separate tasks after prior reads)", async () => {
    mocks.getSokoBotVersion.mockReturnValue({ id: "v40-e1", askPolicy: true });

    await expect(
      dispatchChatTools(
        runtimeStub,
        {
          sessionId: "s-1",
          turnId: "turn-1",
          toolCallId: "tc-1",
          capability: "preview_result",
          input: {
            reference: {
              kind: "project_selection",
              projectIds: [P1.id, P2.id],
            },
          },
        },
        authorized({ versionId: "v40-e1" }),
      ),
    ).resolves.toMatchObject({ title: "Choose a project" });
    expect(mocks.resolveChatResultReference).toHaveBeenCalledTimes(1);
  });
});
