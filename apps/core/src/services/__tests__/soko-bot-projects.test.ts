import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflict } from "@/helpers/error";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  receipt: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));
const tx = {
  sokoBotToolCall: { update: mocks.receipt },
  sokoBotTurn: { findUnique: vi.fn().mockResolvedValue(null) },
};
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findFirst: mocks.workspace },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  },
}));
vi.mock("@/services/projects.service", () => ({
  createProject: mocks.createProject,
  updateProject: mocks.updateProject,
}));

import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

const userId = randomUUID();
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const turnId = randomUUID();
const projectId = randomUUID();

function authorizedAs(actingUserId: string | null): AuthorizedSokoBotRuntime {
  return {
    toolCallLimit: 64,
    turn: {
      id: turnId,
      actingUserId,
      requestedByUserId: userId,
      workspaceId,
      sokoBotId,
      eveSessionId: "projects-test",
      versionId: null,
      source: "CHAT",
      chainDepth: 0,
    },
    classificationConfidence: 1,
    reader: { userId, audience: undefined, sharedScope: null },
    grant: {
      userId,
      workspaceId,
      sokoBotId,
      issuer: "test",
      audience: "test",
      subject: sokoBotId,
      jwtId: randomUUID(),
      sessionId: "projects-test",
      turnId,
      contextSnapshotId: randomUUID(),
      memoryRevisionId: null,
      memoryVersion: 0,
      capabilities: [],
      issuedAt: 0,
      expiresAt: 9999999999,
    },
  };
}

function runtime(actingUserId: string | null = userId) {
  const service = new SokoBotRuntimeService();
  vi.spyOn(service, "authorize").mockResolvedValue(authorizedAs(actingUserId));
  return (capability: string, input: unknown) =>
    service["executeAuthorizedTool"]({
      turnId,
      toolCallId: "call_1",
      capability,
      input,
    } as never);
}

const project = {
  id: projectId,
  name: "Copy check test",
  identifier: "CCT",
  websiteUrl: null,
  briefing: "LinkedIn copy experiments",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ id: workspaceId, organizationId: null });
  mocks.receipt.mockImplementation(async ({ data }) => ({
    id: "receipt",
    capability: "create_project",
    ...data,
  }));
});

describe("Soko Bot project tools", () => {
  it("creates a project in the turn's workspace and links it", async () => {
    mocks.createProject.mockResolvedValue(project);
    const run = runtime();

    expect(
      await run("create_project", {
        name: "Copy check test",
        briefing: "LinkedIn copy experiments",
      }),
    ).toEqual({
      projectId,
      name: "Copy check test",
      identifier: "CCT",
      websiteUrl: null,
      hasBriefing: true,
      link: `/projects/${projectId}`,
    });
    expect(mocks.createProject).toHaveBeenCalledWith(workspaceId, {
      name: "Copy check test",
      briefing: "LinkedIn copy experiments",
    });
    expect(mocks.receipt).toHaveBeenCalledOnce();
  });

  it("changes only the fields it was given", async () => {
    mocks.updateProject.mockResolvedValue({ ...project, briefing: null });
    const run = runtime();

    await run("update_project", {
      projectId,
      name: "Copy lab",
      briefing: null,
    });
    expect(mocks.updateProject).toHaveBeenCalledWith(workspaceId, projectId, {
      name: "Copy lab",
      briefing: null,
    });
  });

  it("refuses an update that changes nothing", async () => {
    const run = runtime();
    await expect(run("update_project", { projectId })).rejects.toThrow();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("passes a taken identifier back to the bot without a receipt", async () => {
    mocks.createProject.mockRejectedValue(
      conflict("Project identifier already in use in this workspace"),
    );
    const run = runtime();
    await expect(run("create_project", { name: "Copy" })).rejects.toThrow(
      "Project identifier already in use",
    );
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it("needs a member who asked", async () => {
    const run = runtime(null);
    await expect(run("create_project", { name: "Copy" })).rejects.toThrow(
      "runs as a member",
    );
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});
