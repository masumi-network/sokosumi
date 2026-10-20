import { describe, expect, it } from "vitest";
import {
  adminActionOperationId,
  adminActionSnapshot,
  adminRetryOperationKey,
  redactAdminPresentation,
} from "./admin-action-record";

describe("admin action record", () => {
  it("prefers the caller's operation id, then a stable hash of request or trace", () => {
    expect(adminActionOperationId("op-1", "req", "trace")).toBe("op-1");
    const byRequest = adminActionOperationId(undefined, "req", "trace");
    expect(byRequest).toBe(adminActionOperationId(undefined, "req", undefined));
    expect(byRequest).toMatch(/^[0-9a-f]{64}$/);
    expect(adminActionOperationId(undefined, undefined, "trace")).not.toBe(
      byRequest,
    );
    expect(adminActionOperationId(undefined, undefined, undefined)).not.toBe(
      adminActionOperationId(undefined, undefined, undefined),
    );
  });

  it("derives a short, stable retry key", () => {
    expect(adminRetryOperationKey("op-1")).toHaveLength(32);
    expect(adminRetryOperationKey("op-1")).toBe(adminRetryOperationKey("op-1"));
  });

  it("snapshots the version and whether a session exists", () => {
    expect(
      adminActionSnapshot({
        status: "IDLE",
        adminPausedAt: null,
        eveSessionId: "session_1",
        memoryVersion: 3,
        archivedAt: null,
        versionId: "v1",
      }),
    ).toEqual({
      status: "IDLE",
      adminPausedAt: null,
      hasEveSession: true,
      memoryVersion: 3,
      archivedAt: null,
      versionId: "v1",
    });
  });

  it("keeps record ids and dates while redacting nested values", () => {
    const id = "01960001-0001-7001-8001-000000000001";
    const at = new Date("2026-10-14T00:00:00.000Z");
    expect(redactAdminPresentation({ id, at, nested: [{ id }] })).toEqual({
      id,
      at,
      nested: [{ id }],
    });
  });
});
