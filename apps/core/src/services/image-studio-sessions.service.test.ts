import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The check that stands between a studio token and somebody else's
 * conversation.
 *
 * An independent review drove project A's token at project B's known session
 * and got a 200 transcript, a 202 clear, and a 202 send. These tests are the
 * regression for that.
 */

const {
  sessionFindUniqueMock,
  sessionCreateMock,
  sessionUpdateMock,
  requireProjectAccessMock,
  requireProjectAccessForUserMock,
} = vi.hoisted(() => ({
  sessionFindUniqueMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageSession: {
      findUnique: sessionFindUniqueMock,
      findFirst: vi.fn(),
      create: sessionCreateMock,
      update: sessionUpdateMock,
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireProjectAccessForUser: requireProjectAccessForUserMock,
}));

import { authorizeAgentSession } from "@/services/image-studio-sessions.service";

const VIEW = {
  id: "session-row-1",
  eveSessionId: "wrun_abc",
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
});

describe("authorizeAgentSession", () => {
  it("allows the project the session is bound to", async () => {
    sessionFindUniqueMock.mockResolvedValue({
      ...VIEW,
      projectId: "project-a",
    });

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_abc",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).resolves.toMatchObject({ eveSessionId: "wrun_abc" });
  });

  it("refuses a session belonging to another project", async () => {
    // The reported attack: a token minted for the caller's own project,
    // pointed at a session id remembered from an organization project.
    sessionFindUniqueMock.mockResolvedValue({
      ...VIEW,
      projectId: "project-b",
    });

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_abc",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessionUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a caller whose access was revoked after the token was minted", async () => {
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_abc",
        projectId: "project-a",
        userId: "removed-user",
      }),
    ).rejects.toMatchObject({ status: 404 });
    // Access is checked before the session is even looked up.
    expect(sessionFindUniqueMock).not.toHaveBeenCalled();
  });

  it("claims a session nobody has bound yet", async () => {
    sessionFindUniqueMock.mockResolvedValue(null);
    sessionCreateMock.mockResolvedValue(VIEW);

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_new",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).resolves.toMatchObject({ eveSessionId: "wrun_abc" });
    expect(sessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-a",
          eveSessionId: "wrun_new",
        }),
      }),
    );
  });

  it("applies the same rule to the winner when two callers race to bind", async () => {
    sessionFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...VIEW, projectId: "project-b" });
    sessionCreateMock.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );

    await expect(
      authorizeAgentSession({
        eveSessionId: "wrun_race",
        projectId: "project-a",
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
