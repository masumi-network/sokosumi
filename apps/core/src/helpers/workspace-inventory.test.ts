import { describe, expect, it } from "vitest";

import { deriveWorkspaceGate } from "./workspace-inventory.js";

describe("deriveWorkspaceGate", () => {
  it("maps empty / empty / empty → identity-onboarding", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: false,
      }),
    ).toBe("identity-onboarding");
  });

  it("maps empty / empty / pending invites → pending-invites", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("pending-invites");
  });

  it("maps personal workspace → ready (pending invites ignored)", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: true,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });

  it("maps org membership without personal → ready", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: false,
      }),
    ).toBe("ready");
  });

  it("maps personal and org membership → ready", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: true,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });

  it("maps org membership with pending invites → ready (invites ignored)", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });
});
