import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors";

const approveMock = vi.fn();
const denyMock = vi.fn();
const revokeMock = vi.fn();

vi.mock("@/lib/services/coworker-access.service", () => ({
  coworkerAccessService: {
    approve: (...args: unknown[]) => approveMock(...args),
    deny: (...args: unknown[]) => denyMock(...args),
    revoke: (...args: unknown[]) => revokeMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TArgs, TResult>(
      handler: (args: TArgs & { session: unknown }) => Promise<TResult>,
    ) =>
    async (args: TArgs) =>
      handler({ ...args, session: { user: { id: "user_1" } } }),
}));

import {
  approveMyCoworkerAccess,
  approveOrganizationCoworkerAccess,
  denyMyCoworkerAccess,
} from "@/lib/actions/coworker-access-action";

const ACCESS_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "org_1";

describe("coworkerAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves personal coworker access", async () => {
    approveMock.mockResolvedValue({ id: ACCESS_ID });

    const result = await approveMyCoworkerAccess({ accessId: ACCESS_ID });

    expect(result).toEqual({ ok: true, value: { accessId: ACCESS_ID } });
    expect(approveMock).toHaveBeenCalledWith(ACCESS_ID, { type: "personal" });
  });

  it("approves organization coworker access", async () => {
    approveMock.mockResolvedValue({ id: ACCESS_ID });

    const result = await approveOrganizationCoworkerAccess({
      organizationId: ORGANIZATION_ID,
      accessId: ACCESS_ID,
    });

    expect(result).toEqual({ ok: true, value: { accessId: ACCESS_ID } });
    expect(approveMock).toHaveBeenCalledWith(ACCESS_ID, {
      type: "organization",
      organizationId: ORGANIZATION_ID,
    });
  });

  it("rejects invalid personal access ids", async () => {
    const result = await denyMyCoworkerAccess({ accessId: "not-a-uuid" });

    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT },
    });
    expect(denyMock).not.toHaveBeenCalled();
  });
});
