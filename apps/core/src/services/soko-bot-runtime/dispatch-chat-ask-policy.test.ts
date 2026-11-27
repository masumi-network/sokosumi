import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSokoBotVersion: vi.fn(),
  turnFindUnique: vi.fn(),
  projectFindMany: vi.fn(),
  connectionFindMany: vi.fn(),
  newsletterFindMany: vi.fn(),
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
    sokoBotTurn: { findUnique: mocks.turnFindUnique },
    project: { findMany: mocks.projectFindMany },
    projectSocialConnection: { findMany: mocks.connectionFindMany },
    newsletter: { findMany: mocks.newsletterFindMany },
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
const X1 = {
  id: "01960001-0001-7001-8001-0000000000a1",
  externalHandle: "acme_hq",
  project: P1,
};

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
  mocks.turnFindUnique.mockResolvedValue({
    userMessage: "Turn this PDF into 3 X posts",
  });
  mocks.projectFindMany.mockResolvedValue([P1, P2]);
  mocks.connectionFindMany.mockResolvedValue([X1]);
  mocks.newsletterFindMany.mockResolvedValue([]);
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
    expect(mocks.turnFindUnique).not.toHaveBeenCalled();
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
    expect(mocks.resolveChatResultReference).toHaveBeenCalledTimes(1);
  });

  it("refuses project_selection on askPolicy when only 1 project has an active X account", async () => {
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
    ).rejects.toThrow(SokoBotRuntimeValidationError);

    expect(mocks.resolveChatResultReference).not.toHaveBeenCalled();
  });

  it("allows project_selection on askPolicy when 2 genuinely fitting open projects exist", async () => {
    mocks.getSokoBotVersion.mockReturnValue({ id: "v40-e1", askPolicy: true });
    mocks.turnFindUnique.mockResolvedValue({
      userMessage: "Generate 3 replacement images",
    });

    const result = await dispatchChatTools(
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
    );

    expect(result).toMatchObject({ title: "Choose a project" });
    expect(mocks.resolveChatResultReference).toHaveBeenCalledTimes(1);
  });

  it("does not read a child background run's own brief as the owner's words", async () => {
    mocks.getSokoBotVersion.mockReturnValue({ id: "v40-e1", askPolicy: true });

    const result = await dispatchChatTools(
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
      authorized({ versionId: "v40-e1", parentTurnId: "turn-root" }),
    );

    expect(mocks.turnFindUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({ title: "Choose a project" });
  });
});
