import { describe, expect, it } from "vitest";

import {
  isWorkspaceReady,
  WORKSPACE_GATE_PATH,
  workspaceAccessFrom,
  workspaceGatePath,
} from "./workspace-gate";

const PERSONAL = { kind: "personal" as const };
const ORGANIZATION = { kind: "organization" as const };

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

  it.each([
    [
      "a personal workspace",
      [PERSONAL],
      0,
      {
        gate: "ready",
        hasPersonalWorkspace: true,
        hasOrganizationMembership: false,
      },
    ],
    [
      "only an organization, despite invitations",
      [ORGANIZATION],
      2,
      {
        gate: "ready",
        hasPersonalWorkspace: false,
        hasOrganizationMembership: true,
      },
    ],
    [
      "no workspace and invitations",
      [],
      1,
      {
        gate: "pending-invites",
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
      },
    ],
    [
      "no workspace and no invitations",
      [],
      0,
      {
        gate: "identity-onboarding",
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
      },
    ],
  ] as const)(
    "derives the gate from the workspaces list: %s",
    (_label, workspaces, pendingInvitationCount, access) => {
      expect(
        workspaceAccessFrom({ workspaces, pendingInvitationCount }),
      ).toEqual(access);
    },
  );

  it.each(["", "/"])(
    "sends a request for the app root to the bare gate: %j",
    (requestedPath) => {
      expect(workspaceGatePath(requestedPath)).toBe("/setup");
    },
  );
});
