import { describe, expect, it } from "vitest";

import {
  getAdminSokoBotResponseTransformer,
  performAdminSokoBotActionResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

/**
 * Admin detail returns `runtimeHealth: null` when the bot has no Eve session
 * or no turns yet, and `contextSnapshot: null` on a turn with no snapshot.
 * The generated transformer must null-guard those objects before converting
 * `checkedAt` / `generatedAt`. Switching the named OpenAPI component back to
 * `.nullable()` drops `| null` from the client and crashes.
 */
function buildAdminSokoBotDetail(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-09-02T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
    schedules: [],
    turns: [],
    memoryRevisions: [],
    adminActions: [],
    runtimeHealth: null,
    ...overrides,
  };
}

const meta = {
  timestamp: "2026-09-02T09:21:35.000Z",
  requestId: "req_admin_soko_bot",
};

function buildAdminSokoBotTurn(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-09-02T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
    deadlineAt: "2026-09-02T09:05:00.000Z",
    contextSnapshot: null,
    ...overrides,
  };
}

describe("admin Soko Bot response transformers with null runtimeHealth", () => {
  it("getAdminSokoBotResponseTransformer keeps null health and converts dates", async () => {
    const result = await getAdminSokoBotResponseTransformer({
      data: buildAdminSokoBotDetail(),
      meta: { ...meta },
    });

    expect(result.data.runtimeHealth).toBeNull();
    expect(result.data.createdAt).toBeInstanceOf(Date);
    expect(result.meta.timestamp).toEqual(new Date(meta.timestamp));
  });

  it("performAdminSokoBotActionResponseTransformer keeps null health", async () => {
    const result = await performAdminSokoBotActionResponseTransformer({
      data: buildAdminSokoBotDetail(),
      meta: { ...meta },
    });

    expect(result.data.runtimeHealth).toBeNull();
  });

  it("still converts a present health check timestamp", async () => {
    const result = await getAdminSokoBotResponseTransformer({
      data: buildAdminSokoBotDetail({
        runtimeHealth: {
          healthy: true,
          runtimeVersion: "in-process",
          sessionStatus: "turn.completed",
          checkedAt: "2026-09-02T09:20:00.000Z",
          errorKind: null,
        },
      }),
      meta: { ...meta },
    });

    expect(result.data.runtimeHealth?.healthy).toBe(true);
    expect(result.data.runtimeHealth?.checkedAt).toBeInstanceOf(Date);
  });

  it("keeps a null turn contextSnapshot", async () => {
    const result = await getAdminSokoBotResponseTransformer({
      data: buildAdminSokoBotDetail({
        runtimeHealth: {
          healthy: true,
          runtimeVersion: "in-process",
          sessionStatus: "turn.completed",
          checkedAt: "2026-09-02T09:20:00.000Z",
          errorKind: null,
        },
        turns: [buildAdminSokoBotTurn()],
      }),
      meta: { ...meta },
    });

    expect(result.data.turns[0]?.contextSnapshot).toBeNull();
  });

  it("still converts a present contextSnapshot timestamp", async () => {
    const result = await getAdminSokoBotResponseTransformer({
      data: buildAdminSokoBotDetail({
        runtimeHealth: {
          healthy: true,
          runtimeVersion: "in-process",
          sessionStatus: "turn.completed",
          checkedAt: "2026-09-02T09:20:00.000Z",
          errorKind: null,
        },
        turns: [
          buildAdminSokoBotTurn({
            contextSnapshot: {
              generatedAt: "2026-09-02T09:19:00.000Z",
              createdAt: "2026-09-02T09:19:00.000Z",
            },
          }),
        ],
      }),
      meta: { ...meta },
    });

    expect(result.data.turns[0]?.contextSnapshot?.generatedAt).toBeInstanceOf(
      Date,
    );
  });
});
