import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getInvitationByIdMock, getOrganizationPendingInvitationsMock } =
  vi.hoisted(() => ({
    getInvitationByIdMock: vi.fn(),
    getOrganizationPendingInvitationsMock: vi.fn(),
  }));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getInvitationById: (...args: unknown[]) => getInvitationByIdMock(...args),
    getOrganizationPendingInvitations: (...args: unknown[]) =>
      getOrganizationPendingInvitationsMock(...args),
  },
}));

vi.mock("@/lib/auth/auth", () => ({ auth: { api: {} } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({}) }));

import {
  organizationService,
  PendingInvitationErrorCode,
} from "../organization.service";

describe("organizationService.getPendingInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["not_found", PendingInvitationErrorCode.NOT_FOUND],
    ["expired", PendingInvitationErrorCode.EXPIRED],
    ["inviter_not_found", PendingInvitationErrorCode.INVITER_NOT_FOUND],
  ] as const)("maps the %s outcome to its error code", async (kind, code) => {
    getInvitationByIdMock.mockResolvedValue({ data: { kind } });

    const result = await organizationService.getPendingInvitation("inv_x");

    expect(getInvitationByIdMock).toHaveBeenCalledWith("inv_x");
    expect(result).toEqual({ error: code });
  });

  it("returns the invitation on the ok outcome", async () => {
    const invitation = {
      id: "inv_1",
      organizationId: "org_1",
      email: "jane@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      inviterId: "user_1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      organization: { id: "org_1", name: "Acme", slug: "acme" },
      inviter: { id: "user_1", email: "owner@example.com" },
    };
    getInvitationByIdMock.mockResolvedValue({
      data: { kind: "ok", invitation },
    });

    const result = await organizationService.getPendingInvitation("inv_1");

    expect(result).toEqual({ invitation });
  });
});

describe("organizationService.getPendingInvitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the invitation list from core", async () => {
    const invitations = [
      { id: "inv_1", email: "jane@example.com" },
      { id: "inv_2", email: "joe@example.com" },
    ];
    getOrganizationPendingInvitationsMock.mockResolvedValue({
      data: invitations,
    });

    const result = await organizationService.getPendingInvitations("org_1");

    expect(getOrganizationPendingInvitationsMock).toHaveBeenCalledWith("org_1");
    expect(result).toBe(invitations);
  });
});
