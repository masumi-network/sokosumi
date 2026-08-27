import { describe, expect, it } from "vitest";

import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "./workspace-gate";

describe("workspace-gate", () => {
  it("exposes the dedicated gate path", () => {
    expect(WORKSPACE_GATE_PATH).toBe("/setup");
  });

  it("treats only ready as product-ready", () => {
    expect(isWorkspaceReady("ready")).toBe(true);
    expect(isWorkspaceReady("pending-invites")).toBe(false);
    expect(isWorkspaceReady("identity-onboarding")).toBe(false);
    expect(isWorkspaceReady(null)).toBe(false);
    expect(isWorkspaceReady(undefined)).toBe(false);
  });
});
