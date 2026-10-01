import { describe, expect, it } from "vitest";

import {
  isWorkspaceReady,
  WORKSPACE_GATE_PATH,
  workspaceGatePath,
} from "./workspace-gate";

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

  it("carries a requested page and its query to the gate", () => {
    expect(workspaceGatePath("/chat/join/abc?ref=mail")).toBe(
      "/setup?next=%2Fchat%2Fjoin%2Fabc%3Fref%3Dmail",
    );
  });

  it.each(["", "/"])(
    "sends a request for the app root to the bare gate: %j",
    (requestedPath) => {
      expect(workspaceGatePath(requestedPath)).toBe("/setup");
    },
  );
});
