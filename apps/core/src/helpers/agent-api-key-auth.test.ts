import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, updateManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerApiKey: {
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
    },
  },
}));

import { waitUntil } from "@vercel/functions";

import { resolveAgentApiKeyAuthContext } from "@/helpers/agent-api-key-auth";
import { expectCoreLog } from "@/test/core-log";

const NOW = new Date("2026-11-23T12:00:00.000Z");
const TOKEN = "coworker_secret";

function coworkerKey(lastUsedAt: Date | null, revokedAt: Date | null = null) {
  return {
    id: "key-1",
    lastUsedAt,
    coworkerId: "cow_123",
    sokoBotId: null,
    revokedAt,
    expiresAt: null,
    coworker: { archivedAt: null, vendorId: "vendor-1" },
    sokoBot: null,
  };
}

async function settleBackgroundWork() {
  await Promise.all(vi.mocked(waitUntil).mock.calls.map(([work]) => work));
}

describe("resolveAgentApiKeyAuthContext lastUsedAt", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it("records the first use of a key", async () => {
    findUniqueMock.mockResolvedValue(coworkerKey(null));

    const context = await resolveAgentApiKeyAuthContext(TOKEN);
    await settleBackgroundWork();

    expect(context).toMatchObject({ actor: "coworker" });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: "key-1",
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lte: new Date("2026-11-23T11:59:00.000Z") } },
        ],
      },
      data: { lastUsedAt: NOW },
    });
  });

  it("skips the write when the key was used in the last minute", async () => {
    findUniqueMock.mockResolvedValue(
      coworkerKey(new Date("2026-11-23T11:59:30.000Z")),
    );

    await resolveAgentApiKeyAuthContext(TOKEN);

    expect(waitUntil).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("writes again once the stored value is a minute old", async () => {
    findUniqueMock.mockResolvedValue(
      coworkerKey(new Date("2026-11-23T11:59:00.000Z")),
    );

    await resolveAgentApiKeyAuthContext(TOKEN);
    await settleBackgroundWork();

    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it("does not record a key that fails to authenticate", async () => {
    findUniqueMock.mockResolvedValue(coworkerKey(null, NOW));

    const context = await resolveAgentApiKeyAuthContext(TOKEN);

    expect(context).toBeNull();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("logs a failed write without failing authentication", async () => {
    const logs = expectCoreLog(
      "error",
      "Could not record when an agent API key was last used",
    );
    findUniqueMock.mockResolvedValue(coworkerKey(null));
    updateManyMock.mockRejectedValue(new Error("connection reset"));

    const context = await resolveAgentApiKeyAuthContext(TOKEN);
    await settleBackgroundWork();

    expect(context).toMatchObject({ actor: "coworker" });
    expect(logs).toHaveLength(1);
  });
});
