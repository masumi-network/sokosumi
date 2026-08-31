import { describe, expect, it } from "vitest";

import type { SokoBotAdminAction } from "@/lib/clients/generated/core";

import { groupAuditOperations } from "../audit-operations";

function row(
  overrides: Partial<SokoBotAdminAction> & {
    id: string;
    operationId: string;
    status: SokoBotAdminAction["status"];
    createdAt: Date;
  },
): SokoBotAdminAction {
  return {
    operatorId: "op_1",
    action: "PAUSE",
    targetId: null,
    reason: "Investigating",
    errorKind: null,
    errorDetail: null,
    requestId: null,
    traceId: null,
    ...overrides,
  };
}

describe("groupAuditOperations", () => {
  it("pairs ATTEMPTED with SUCCEEDED into one succeeded operation", () => {
    const ops = groupAuditOperations([
      row({
        id: "b",
        operationId: "op-1",
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:05Z"),
        after: { status: "PAUSED" },
      }),
      row({
        id: "a",
        operationId: "op-1",
        status: "ATTEMPTED",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        before: { status: "IDLE" },
      }),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.outcome).toBe("SUCCEEDED");
    expect(ops[0]?.attemptedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(ops[0]?.resolvedAt?.toISOString()).toBe("2026-01-01T00:00:05.000Z");
    expect(ops[0]?.before).toEqual({ status: "IDLE" });
    expect(ops[0]?.after).toEqual({ status: "PAUSED" });
    expect(ops[0]?.rows).toHaveLength(2);
  });

  it("flags a lone ATTEMPTED as an unconfirmed (orphan) operation", () => {
    const ops = groupAuditOperations([
      row({
        id: "a",
        operationId: "op-2",
        status: "ATTEMPTED",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ]);
    expect(ops[0]?.outcome).toBe("ATTEMPTED");
    expect(ops[0]?.resolvedAt).toBeNull();
  });

  it("surfaces FAILED with its error and orders newest operation first", () => {
    const ops = groupAuditOperations([
      row({
        id: "a",
        operationId: "op-3",
        status: "ATTEMPTED",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        action: "RESET_SESSION",
      }),
      row({
        id: "b",
        operationId: "op-3",
        status: "FAILED",
        createdAt: new Date("2026-01-03T00:00:02Z"),
        action: "RESET_SESSION",
        errorKind: "runtime_unreachable",
        errorDetail: "timeout",
      }),
      row({
        id: "c",
        operationId: "op-4",
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        action: "RESUME",
        targetId: null,
      }),
    ]);
    expect(ops.map((op) => op.operationId)).toEqual(["op-4", "op-3"]);
    const failed = ops.find((op) => op.operationId === "op-3");
    expect(failed?.outcome).toBe("FAILED");
    expect(failed?.errorKind).toBe("runtime_unreachable");
    expect(failed?.errorDetail).toBe("timeout");
  });
});
