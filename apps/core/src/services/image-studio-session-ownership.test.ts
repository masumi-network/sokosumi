import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who owns a conversation, and whether its first message went.
 *
 * An independent review bound an arbitrary, never-seen eve session id to its
 * own project through the public bind endpoint and then read it back. Removing
 * the automatic claim from authorization had only moved the claim next door.
 * Ownership is now established by the agent inside the request that creates the
 * session, on a surface the browser's token cannot reach, so possession of an
 * id is no longer possession of a conversation.
 *
 * A later review found the second half of the problem. The row is written
 * before the first message is dispatched, so "the row is already there" was
 * never evidence that the message had been delivered — and reading it that way
 * dropped the message on every retry after a lost response or a failed send.
 * Delivery now has its own state next to the binding, and exactly one caller
 * is handed the right to send.
 */

const {
  sessionFindUniqueMock,
  sessionCreateMock,
  sessionUpdateMock,
  sessionUpdateManyMock,
  requireProjectAccessForUserMock,
} = vi.hoisted(() => ({
  sessionFindUniqueMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
  sessionUpdateManyMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageSession: {
      findUnique: sessionFindUniqueMock,
      create: sessionCreateMock,
      update: sessionUpdateMock,
      updateMany: sessionUpdateManyMock,
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
  transitionInitialTurn,
} from "@/services/image-studio-sessions.service";

const VIEW = {
  id: "row-1",
  eveSessionId: "wrun_A",
  title: null,
  createdByUserId: "user-a",
  lastActivityAt: new Date(),
  createdAt: new Date(),
};

/** Nothing is claimable and the row reports `initialTurn`. */
function claimFails(initialTurn: string) {
  sessionUpdateManyMock.mockResolvedValue({ count: 0 });
  sessionFindUniqueMock.mockImplementation((args: { select?: unknown }) =>
    Promise.resolve(
      (args.select as Record<string, unknown>)?.initialTurn
        ? { initialTurn }
        : null,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectAccessForUserMock.mockResolvedValue({
    projectId: "project-a",
    workspaceId: "workspace-a",
    userId: "user-a",
  });
  sessionUpdateMock.mockResolvedValue(VIEW);
  sessionCreateMock.mockResolvedValue(VIEW);
  sessionUpdateManyMock.mockResolvedValue({ count: 1 });
  sessionFindUniqueMock.mockResolvedValue(null);
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
  it("records one the agent has just created, and says it created it", async () => {
    sessionFindUniqueMock.mockResolvedValue(null);

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_new",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(sessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-a",
          eveSessionId: "wrun_new",
          createdByUserId: "user-a",
          clientIntentId: "intent-1",
          initialTurn: "PENDING",
        }),
      }),
    );
    expect(result.wasCreated).toBe(true);
    // The one caller that may send, and the lease that fences it.
    expect(result.mayDeliver).toBe(true);
    expect(result.initialTurn).toBe("CLAIMED");
    expect(result.deliveryToken).toEqual(expect.any(String));
  });

  it("takes no delivery lease when this call carries no message", async () => {
    // A page merely asking which conversation an intent names must not hold a
    // lease it will not use: holding one blocks the attempt that would.
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown>; select?: unknown }) => {
        if (args.where?.projectId_clientIntentId) {
          return Promise.resolve({ ...VIEW, projectId: "project-a" });
        }
        return Promise.resolve(
          (args.select as Record<string, unknown>)?.initialTurn
            ? { initialTurn: "PENDING" }
            : null,
        );
      },
    );

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_resolve",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: false,
    });

    expect(result.eveSessionId).toBe("wrun_A");
    expect(result.mayDeliver).toBe(false);
    expect(result.initialTurn).toBe("PENDING");
    expect(sessionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("creates a conversation that owes nothing as NONE, and grants no delivery", async () => {
    claimFails("NONE");

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_new",
      title: null,
      clientIntentId: null,
      expectsInitialTurn: false,
    });

    expect(sessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ initialTurn: "NONE" }),
      }),
    );
    expect(result.mayDeliver).toBe(false);
    expect(result.initialTurn).toBe("NONE");
  });

  it("answers a retry of a known intent with the conversation it already has", async () => {
    // The retry minted a fresh eve session before calling; that id names
    // nothing, and answering with it is what started second conversations.
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown>; select?: unknown }) => {
        if (args.where?.projectId_clientIntentId) {
          return Promise.resolve({ ...VIEW, projectId: "project-a" });
        }
        return Promise.resolve(
          (args.select as Record<string, unknown>)?.initialTurn
            ? { initialTurn: "DELIVERED" }
            : null,
        );
      },
    );
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_freshly_minted",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(sessionCreateMock).not.toHaveBeenCalled();
    expect(result.wasCreated).toBe(false);
    expect(result.eveSessionId).toBe("wrun_A");
    // Already delivered: the retry must not send it again.
    expect(result.initialTurn).toBe("DELIVERED");
    expect(result.mayDeliver).toBe(false);
  });

  it("takes over a claim nobody has acted on, so a lost response does not strand the message", async () => {
    // The first attempt committed the row and never saw the answer, so it will
    // never deliver and never report. Waiting out its lease would leave the
    // message permanently uncertain for something that provably never ran.
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          args.where?.projectId_clientIntentId
            ? { ...VIEW, projectId: "project-a" }
            : null,
        ),
    );
    sessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_retry",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(result.mayDeliver).toBe(true);
    expect(sessionUpdateManyMock.mock.calls[0]?.[0]).toMatchObject({
      where: { initialTurn: { in: ["PENDING", "CLAIMED"] } },
    });
  });

  it("tells a retry that arrives mid-dispatch that a delivery is in flight", async () => {
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown>; select?: unknown }) => {
        if (args.where?.projectId_clientIntentId) {
          return Promise.resolve({ ...VIEW, projectId: "project-a" });
        }
        return Promise.resolve(
          (args.select as Record<string, unknown>)?.initialTurn
            ? { initialTurn: "DELIVERING" }
            : null,
        );
      },
    );
    // Neither the claim nor the expired-lease sweep matches: another attempt
    // is already past the point of no return.
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_concurrent",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(result.mayDeliver).toBe(false);
    expect(result.initialTurn).toBe("DELIVERING");
  });

  it("resolves a lapsed delivery lease to uncertain, never to a second send", async () => {
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          args.where?.projectId_clientIntentId
            ? { ...VIEW, projectId: "project-a" }
            : null,
        ),
    );
    // The claim misses; the expired-dispatch sweep matches.
    sessionUpdateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_lapsed",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(result.initialTurn).toBe("UNCERTAIN");
    expect(result.mayDeliver).toBe(false);
    expect(sessionUpdateManyMock.mock.calls[1]?.[0]).toMatchObject({
      data: { initialTurn: "UNCERTAIN" },
    });
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

  it("resolves a lost race on the same intent onto the winner's conversation", async () => {
    // Both retries saw nothing and both tried to insert; the loser reads the
    // winner's row instead of failing the creation.
    let inserted = false;
    sessionFindUniqueMock.mockImplementation(
      (args: { where?: Record<string, unknown>; select?: unknown }) => {
        if (args.where?.projectId_clientIntentId) {
          return Promise.resolve(
            inserted ? { ...VIEW, projectId: "project-a" } : null,
          );
        }
        return Promise.resolve(
          (args.select as Record<string, unknown>)?.initialTurn
            ? { initialTurn: "DELIVERING" }
            : null,
        );
      },
    );
    sessionCreateMock.mockImplementation(() => {
      inserted = true;
      return Promise.reject(Object.assign(new Error("dup"), { code: "P2002" }));
    });
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await registerCreatedSession({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_loser",
      title: null,
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(result.eveSessionId).toBe("wrun_A");
    expect(result.wasCreated).toBe(false);
    expect(result.mayDeliver).toBe(false);
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

describe("entering the delivery from an ordinary send", () => {
  it("claims an owed first message, so a resumed send settles it", async () => {
    // The page resumes a conversation whose first message never went. That
    // send *is* the first turn, so it enters the same decision creation does
    // — and a send that skipped this left the state saying nobody had
    // delivered, which let a retry of the original creation say it again.
    sessionFindUniqueMock.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        (args.select as Record<string, unknown>)?.initialTurn
          ? { initialTurn: "CLAIMED" }
          : { ...VIEW, projectId: "project-a" },
      ),
    );
    sessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "claim",
    });

    expect(result.mayDeliver).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.deliveryToken).toEqual(expect.any(String));
  });

  it("refuses the claim while another attempt is mid-dispatch", async () => {
    sessionFindUniqueMock.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        (args.select as Record<string, unknown>)?.initialTurn
          ? { initialTurn: "DELIVERING" }
          : { ...VIEW, projectId: "project-a" },
      ),
    );
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "claim",
    });

    expect(result.mayDeliver).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.initialTurn).toBe("DELIVERING");
  });
});

describe("closing out the first delivery", () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(
        (args.select as Record<string, unknown>)?.initialTurn
          ? { initialTurn: "DELIVERED" }
          : { ...VIEW, projectId: "project-a" },
      ),
    );
  });

  it("announces the dispatch before it happens, fenced on the lease", async () => {
    const result = await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "dispatching",
      deliveryToken: "lease-1",
    });

    expect(sessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "row-1",
          initialTurn: { in: ["CLAIMED"] },
          initialTurnLeaseOwner: "lease-1",
        },
      }),
    );
    expect(result.accepted).toBe(true);
  });

  it("refuses to announce a dispatch with no lease at all", async () => {
    // Everything else rests on the fence, so an unfenced announcement is
    // refused rather than quietly allowed through.
    const result = await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "dispatching",
    });

    expect(result.accepted).toBe(false);
    expect(sessionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses an attempt whose lease was taken over", async () => {
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "dispatching",
      deliveryToken: "stale-lease",
    });

    // The caller must not send: another attempt owns the delivery now.
    expect(result.accepted).toBe(false);
  });

  it("returns an owed message to the queue when the runtime refused it", async () => {
    await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "undelivered",
      deliveryToken: "lease-1",
    });

    expect(sessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "row-1",
          initialTurn: { in: ["CLAIMED", "DELIVERING"] },
          initialTurnLeaseOwner: "lease-1",
        },
        data: {
          initialTurn: "PENDING",
          initialTurnLeaseAt: null,
          initialTurnLeaseOwner: null,
        },
      }),
    );
  });

  it("closes an uncertain delivery once it is confirmed", async () => {
    await transitionInitialTurn({
      projectId: "project-a",
      userId: "user-a",
      eveSessionId: "wrun_A",
      transition: "delivered",
    });

    expect(sessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "row-1",
          initialTurn: { in: ["CLAIMED", "DELIVERING", "UNCERTAIN"] },
        },
        data: {
          initialTurn: "DELIVERED",
          initialTurnLeaseAt: null,
          initialTurnLeaseOwner: null,
        },
      }),
    );
  });

  it("re-authorizes the caller before recording anything", async () => {
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );

    await expect(
      transitionInitialTurn({
        projectId: "project-a",
        userId: "removed-user",
        eveSessionId: "wrun_A",
        transition: "delivered",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessionUpdateManyMock).not.toHaveBeenCalled();
  });
});
