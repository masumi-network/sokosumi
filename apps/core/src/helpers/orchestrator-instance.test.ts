import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveOrchestratorForUser,
  ensureOrchestratorForUser,
  findActiveOrchestratorForUser,
  findOrchestratorForUser,
  requireActiveOrchestratorForUser,
} from "./orchestrator-instance";

const {
  findFirstMock,
  findUniqueMock,
  createMock,
  updateMock,
  updateManyMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    orchestrator: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

const USER_ID = "user_123";
const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORCHESTRATOR_ID,
    userId: USER_ID,
    archivedAt: null,
    name: null,
    avatarSeed: null,
    personalityTone: null,
    personalityDetail: null,
    personalityStyle: null,
    lastPolledAt: null,
    lastInboxMessageAt: null,
    lastSeenInboxAt: null,
    consecutivePollErrors: 0,
    ...overrides,
  };
}

describe("orchestrator-instance helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findActiveOrchestratorForUser", () => {
    it("queries active rows only", async () => {
      findFirstMock.mockResolvedValue(activeRow());
      const result = await findActiveOrchestratorForUser(USER_ID);
      expect(result?.id).toBe(ORCHESTRATOR_ID);
      expect(findFirstMock).toHaveBeenCalledWith({
        where: { userId: USER_ID, archivedAt: null },
      });
    });
  });

  describe("requireActiveOrchestratorForUser", () => {
    it("throws not found when missing", async () => {
      findFirstMock.mockResolvedValue(null);
      await expect(
        requireActiveOrchestratorForUser(USER_ID),
      ).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("ensureOrchestratorForUser", () => {
    it("creates when no row exists", async () => {
      findUniqueMock.mockResolvedValue(null);
      createMock.mockResolvedValue(activeRow({ name: "Ada" }));

      const result = await ensureOrchestratorForUser(USER_ID, { name: "Ada" });

      expect(result.name).toBe("Ada");
      expect(createMock).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          name: "Ada",
          avatarSeed: null,
          personalityTone: null,
          personalityDetail: null,
          personalityStyle: null,
        },
      });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("returns existing active row without update when patch empty", async () => {
      const existing = activeRow({ name: "Existing" });
      findUniqueMock.mockResolvedValue(existing);

      const result = await ensureOrchestratorForUser(USER_ID);

      expect(result).toBe(existing);
      expect(createMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("patches an active row when fields provided", async () => {
      findUniqueMock.mockResolvedValue(activeRow());
      updateMock.mockResolvedValue(activeRow({ name: "Patched" }));

      const result = await ensureOrchestratorForUser(USER_ID, {
        name: "Patched",
      });

      expect(result.name).toBe("Patched");
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: ORCHESTRATOR_ID },
        data: { name: "Patched" },
      });
    });

    it("unarchives and resets poll cursors on archived row", async () => {
      findUniqueMock.mockResolvedValue(
        activeRow({
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
          lastPolledAt: new Date("2026-01-01T00:00:00.000Z"),
          consecutivePollErrors: 3,
        }),
      );
      updateMock.mockResolvedValue(activeRow({ name: "Back" }));

      await ensureOrchestratorForUser(USER_ID, { name: "Back" });

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: ORCHESTRATOR_ID },
        data: {
          archivedAt: null,
          consecutivePollErrors: 0,
          lastPolledAt: null,
          lastInboxMessageAt: null,
          lastSeenInboxAt: null,
          name: "Back",
        },
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it("on concurrent create P2002, re-reads and applies ensure on existing", async () => {
      findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(
        activeRow({
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      );
      createMock.mockRejectedValue({ code: "P2002" });
      updateMock.mockResolvedValue(activeRow({ name: "Winner" }));

      const result = await ensureOrchestratorForUser(USER_ID, {
        name: "Winner",
      });

      expect(result.name).toBe("Winner");
      expect(createMock).toHaveBeenCalledOnce();
      expect(findUniqueMock).toHaveBeenCalledTimes(2);
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: ORCHESTRATOR_ID },
        data: {
          archivedAt: null,
          consecutivePollErrors: 0,
          lastPolledAt: null,
          lastInboxMessageAt: null,
          lastSeenInboxAt: null,
          name: "Winner",
        },
      });
    });

    it("rethrows non-unique create failures", async () => {
      findUniqueMock.mockResolvedValue(null);
      createMock.mockRejectedValue({ code: "P2003" });

      await expect(ensureOrchestratorForUser(USER_ID)).rejects.toEqual({
        code: "P2003",
      });
    });
  });

  describe("archiveOrchestratorForUser", () => {
    it("archives only active rows and clears poll metadata", async () => {
      updateManyMock.mockResolvedValue({ count: 1 });
      await archiveOrchestratorForUser(USER_ID);
      expect(updateManyMock).toHaveBeenCalledWith({
        where: { userId: USER_ID, archivedAt: null },
        data: {
          archivedAt: expect.any(Date),
          lastPolledAt: null,
          lastInboxMessageAt: null,
          lastSeenInboxAt: null,
          consecutivePollErrors: 0,
        },
      });
    });
  });

  describe("findOrchestratorForUser", () => {
    it("looks up by unique userId including archived", async () => {
      findUniqueMock.mockResolvedValue(
        activeRow({ archivedAt: new Date("2026-01-01T00:00:00.000Z") }),
      );
      const result = await findOrchestratorForUser(USER_ID);
      expect(result?.archivedAt).not.toBeNull();
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });
  });
});
