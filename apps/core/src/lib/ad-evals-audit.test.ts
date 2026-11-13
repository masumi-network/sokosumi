import { beforeEach, describe, expect, it, vi } from "vitest";

const { audit } = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("./evlog", () => ({ tryUseLogger: () => ({ audit }) }));

import {
  auditAdEvalsExport,
  auditAdEvalsExportFailure,
} from "./ad-evals-audit";

beforeEach(() => vi.clearAllMocks());

describe("ad eval export audit", () => {
  it("records export identity, policy and hashed membership in the existing audit stream", () => {
    const manifest = {
      exportId: "export-a",
      formatVersion: "1",
      policyVersion: "2026-11-13",
      createdAt: "2026-11-13T10:00:00.000Z",
      workspaceHashes: ["sha256-workspace"],
      rowCount: 3,
    };
    auditAdEvalsExport("admin-a", manifest);
    expect(audit).toHaveBeenCalledWith({
      action: "ad-evals.export",
      actor: { type: "user", id: "admin-a" },
      target: { type: "ad-evals-export", id: "export-a", ...manifest },
      outcome: "success",
    });
  });

  it("records export failures without copying errors or customer data", () => {
    auditAdEvalsExportFailure("admin-a", "request-a");
    expect(audit).toHaveBeenCalledWith({
      action: "ad-evals.export",
      actor: { type: "user", id: "admin-a" },
      target: { type: "ad-evals-export", id: "request-a" },
      outcome: "failure",
      reason: "Export could not be completed",
    });
  });
});
