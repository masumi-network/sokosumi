import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who owns a conversation.
 *
 * An independent review bound an arbitrary, never-seen eve session id to its
 * own project through the public bind endpoint and then read it back. Removing
 * the automatic claim from authorization had only moved the claim next door.
 *
 * Ownership is now established by the agent inside the request that creates the
 * session, on a surface the browser's token cannot reach, so possession of an
 * id is no longer possession of a conversation.
 */

const {
  sessionFindUniqueMock,
  sessionCreateMock,
  sessionUpdateMock,
  requireProjectAccessForUserMock,
} = vi.hoisted(() => ({
  sessionFindUniqueMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageSession: {
      findUnique: sessionFindUniqueMock,
      create: sessionCreateMock,
      update: sessionUpdateMock,
    },
  },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: vi.fn(),
  requireProjectAccessForUser: requireProjectAccessForUserMock,
}));

import {
  authorizeAgentSession,
  registerCreatedSession,
} from "@/services/image-studio-sessions.service";

const VIEW = {
  id: "row-1",
  eveSessionId: "wrun_A",
  title: null,
  createdByUserId: "user-a",
  lastActivityAt: new Date(),
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectAccessForUserMock.mockResolvedValue({
    projectId: "project-a",
    workspaceId: "workspace-a",
    userId: "user-a",
  });
  sessionUpdateMock.mockResolvedValue(VIEW);
  sessionCreateMock.mockResolvedValue(VIEW);
});

describe("authorizing an existing conversation", () => {
  it("refuses one nobody has recorded, and records nothing", async () => {
    sessionFindUniqueMock.mockResolvedValue(null);

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_unknown",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("refuses one recorded against another project", async () => {
    sessionFindUniqueMock.mockResolvedValue({
      ...VIEW,
      projectId: "project-b",
    });

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_A",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("recording a conversation at creation", () => {
  it("records one the agent has just created", async () => {
    sessionFindUniqueMock.mockResolvedValue(null);

    await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_new",
      title: null,
    });

    expect(sessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-a",
          eveSessionId: "wrun_new",
          createdByUserId: "user-a",
        }),
      }),
    );
  });

  it("refuses to take over one already recorded elsewhere", async () => {
    // This is the claim the public bind endpoint used to allow.
    sessionFindUniqueMock.mockResolvedValue({
      ...VIEW,
      projectId: "project-b",
    });

    await expect(
      registerCreatedSession({
        projectId: "project-a",
        userId: "user-a",
        eveSessionId: "wrun_someone_elses",
        title: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });

  it("still checks the caller's current access to the project", async () => {
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );

    await expect(
      registerCreatedSession({
        projectId: "project-a",
        userId: "removed-user",
        eveSessionId: "wrun_new",
        title: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessionCreateMock).not.toHaveBeenCalled();
  });
});
