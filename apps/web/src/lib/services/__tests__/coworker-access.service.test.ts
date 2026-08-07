import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getMyCoworkerAccessMock = vi.fn();
const getOrganizationCoworkerAccessMock = vi.fn();
const approveMyCoworkerAccessMock = vi.fn();
const denyMyCoworkerAccessMock = vi.fn();
const revokeMyCoworkerAccessMock = vi.fn();
const approveOrganizationCoworkerAccessMock = vi.fn();
const denyOrganizationCoworkerAccessMock = vi.fn();
const revokeOrganizationCoworkerAccessMock = vi.fn();
const createCoworkerWorkspaceAccessMock = vi.fn();
const listCoworkerWorkspaceAccessMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyCoworkerAccess: (...args: unknown[]) =>
      getMyCoworkerAccessMock(...args),
    getOrganizationCoworkerAccess: (...args: unknown[]) =>
      getOrganizationCoworkerAccessMock(...args),
    approveMyCoworkerAccess: (...args: unknown[]) =>
      approveMyCoworkerAccessMock(...args),
    denyMyCoworkerAccess: (...args: unknown[]) =>
      denyMyCoworkerAccessMock(...args),
    revokeMyCoworkerAccess: (...args: unknown[]) =>
      revokeMyCoworkerAccessMock(...args),
    approveOrganizationCoworkerAccess: (...args: unknown[]) =>
      approveOrganizationCoworkerAccessMock(...args),
    denyOrganizationCoworkerAccess: (...args: unknown[]) =>
      denyOrganizationCoworkerAccessMock(...args),
    revokeOrganizationCoworkerAccess: (...args: unknown[]) =>
      revokeOrganizationCoworkerAccessMock(...args),
    createCoworkerWorkspaceAccess: (...args: unknown[]) =>
      createCoworkerWorkspaceAccessMock(...args),
    listCoworkerWorkspaceAccess: (...args: unknown[]) =>
      listCoworkerWorkspaceAccessMock(...args),
  },
}));

import { coworkerAccessService } from "../coworker-access.service";

const accessRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  coworkerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  coworkerName: "Ops Pilot",
  coworkerSlug: "ops-pilot",
  workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  status: "PENDING" as const,
  requestedByUserId: "user_1",
  resolvedAt: null,
  resolvedById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const grantedRow = {
  ...accessRow,
  status: "GRANTED" as const,
  resolvedAt: new Date("2026-08-02T00:00:00.000Z"),
  resolvedById: "user_admin",
};

describe("coworkerAccessService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listForPersonalWorkspace maps Core data", async () => {
    getMyCoworkerAccessMock.mockResolvedValue({ data: [accessRow] });

    const result = await coworkerAccessService.listForPersonalWorkspace();

    expect(getMyCoworkerAccessMock).toHaveBeenCalledOnce();
    expect(result).toEqual([accessRow]);
  });

  it("listForOrganization maps Core data", async () => {
    getOrganizationCoworkerAccessMock.mockResolvedValue({ data: [accessRow] });

    const result = await coworkerAccessService.listForOrganization("org_123");

    expect(getOrganizationCoworkerAccessMock).toHaveBeenCalledWith("org_123");
    expect(result).toEqual([accessRow]);
  });

  it("approve uses personal scope", async () => {
    approveMyCoworkerAccessMock.mockResolvedValue({ data: grantedRow });

    const result = await coworkerAccessService.approve(accessRow.id, {
      type: "personal",
    });

    expect(approveMyCoworkerAccessMock).toHaveBeenCalledWith(accessRow.id);
    expect(approveOrganizationCoworkerAccessMock).not.toHaveBeenCalled();
    expect(result).toEqual(grantedRow);
  });

  it("approve uses organization scope", async () => {
    approveOrganizationCoworkerAccessMock.mockResolvedValue({
      data: grantedRow,
    });

    const result = await coworkerAccessService.approve(accessRow.id, {
      type: "organization",
      organizationId: "org_123",
    });

    expect(approveOrganizationCoworkerAccessMock).toHaveBeenCalledWith(
      "org_123",
      accessRow.id,
    );
    expect(approveMyCoworkerAccessMock).not.toHaveBeenCalled();
    expect(result).toEqual(grantedRow);
  });

  it("deny uses personal scope", async () => {
    const denied = { ...accessRow, status: "DENIED" as const };
    denyMyCoworkerAccessMock.mockResolvedValue({ data: denied });

    const result = await coworkerAccessService.deny(accessRow.id, {
      type: "personal",
    });

    expect(denyMyCoworkerAccessMock).toHaveBeenCalledWith(accessRow.id);
    expect(result).toEqual(denied);
  });

  it("deny uses organization scope", async () => {
    const denied = { ...accessRow, status: "DENIED" as const };
    denyOrganizationCoworkerAccessMock.mockResolvedValue({ data: denied });

    const result = await coworkerAccessService.deny(accessRow.id, {
      type: "organization",
      organizationId: "org_123",
    });

    expect(denyOrganizationCoworkerAccessMock).toHaveBeenCalledWith(
      "org_123",
      accessRow.id,
    );
    expect(result).toEqual(denied);
  });

  it("revoke uses personal scope", async () => {
    const revoked = { ...grantedRow, status: "REVOKED" as const };
    revokeMyCoworkerAccessMock.mockResolvedValue({ data: revoked });

    const result = await coworkerAccessService.revoke(accessRow.id, {
      type: "personal",
    });

    expect(revokeMyCoworkerAccessMock).toHaveBeenCalledWith(accessRow.id);
    expect(result).toEqual(revoked);
  });

  it("revoke uses organization scope", async () => {
    const revoked = { ...grantedRow, status: "REVOKED" as const };
    revokeOrganizationCoworkerAccessMock.mockResolvedValue({ data: revoked });

    const result = await coworkerAccessService.revoke(accessRow.id, {
      type: "organization",
      organizationId: "org_123",
    });

    expect(revokeOrganizationCoworkerAccessMock).toHaveBeenCalledWith(
      "org_123",
      accessRow.id,
    );
    expect(result).toEqual(revoked);
  });

  it("createForCoworker posts coworker + workspaceId", async () => {
    createCoworkerWorkspaceAccessMock.mockResolvedValue({ data: grantedRow });

    const result = await coworkerAccessService.createForCoworker(
      accessRow.coworkerId,
      accessRow.workspaceId,
    );

    expect(createCoworkerWorkspaceAccessMock).toHaveBeenCalledWith(
      accessRow.coworkerId,
      { workspaceId: accessRow.workspaceId },
    );
    expect(result).toEqual(grantedRow);
  });

  it("listForCoworker maps Core data", async () => {
    listCoworkerWorkspaceAccessMock.mockResolvedValue({ data: [accessRow] });

    const result = await coworkerAccessService.listForCoworker(
      accessRow.coworkerId,
    );

    expect(listCoworkerWorkspaceAccessMock).toHaveBeenCalledWith(
      accessRow.coworkerId,
    );
    expect(result).toEqual([accessRow]);
  });
});
