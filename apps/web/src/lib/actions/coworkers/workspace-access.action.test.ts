import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.client";

const createForCoworkerMock = vi.fn();
const forceRevokeForCoworkerMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/services/coworker-access.service", () => ({
  coworkerAccessService: {
    createForCoworker: (...args: unknown[]) => createForCoworkerMock(...args),
    forceRevokeForCoworker: (...args: unknown[]) =>
      forceRevokeForCoworkerMock(...args),
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
  grantDeveloperCoworkerEarlyAccessAction,
  revokeDeveloperCoworkerEarlyAccessAction,
} from "@/lib/actions/coworkers/workspace-access.action";

const COWORKER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

describe("grantDeveloperCoworkerEarlyAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates access by organization slug", async () => {
    createForCoworkerMock.mockResolvedValue({
      id: "access-1",
      status: "GRANTED",
    });

    const result = await grantDeveloperCoworkerEarlyAccessAction({
      coworkerId: COWORKER_ID,
      targetType: "organization",
      targetValue: "acme-corp",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        accessId: "access-1",
        status: "GRANTED",
      });
    }
    expect(createForCoworkerMock).toHaveBeenCalledWith(COWORKER_ID, {
      organizationSlug: "acme-corp",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/developer/coworkers/${COWORKER_ID}`,
    );
  });

  it("creates access by user email", async () => {
    createForCoworkerMock.mockResolvedValue({
      id: "access-2",
      status: "PENDING",
    });

    const result = await grantDeveloperCoworkerEarlyAccessAction({
      coworkerId: COWORKER_ID,
      targetType: "user",
      targetValue: "pilot@example.com",
    });

    expect(result.ok).toBe(true);
    expect(createForCoworkerMock).toHaveBeenCalledWith(COWORKER_ID, {
      email: "pilot@example.com",
    });
  });

  it("rejects invalid email with BAD_INPUT shape", async () => {
    const result = await grantDeveloperCoworkerEarlyAccessAction({
      coworkerId: COWORKER_ID,
      targetType: "user",
      targetValue: "not-an-email",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: CommonErrorCode.BAD_INPUT,
        message: "Enter a valid email address",
      });
    }
    expect(createForCoworkerMock).not.toHaveBeenCalled();
  });

  it("maps service failures through toCoreApiActionError", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    createForCoworkerMock.mockRejectedValue(
      new CoreApiRequestError("Core backend timeout", { status: 503 }),
    );

    try {
      const result = await grantDeveloperCoworkerEarlyAccessAction({
        coworkerId: COWORKER_ID,
        targetType: "organization",
        targetValue: "acme-corp",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: "The service is currently unavailable.",
        });
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("revokeDeveloperCoworkerEarlyAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes access by workspace id", async () => {
    forceRevokeForCoworkerMock.mockResolvedValue({
      id: "access-3",
      status: "REVOKED",
    });

    const result = await revokeDeveloperCoworkerEarlyAccessAction({
      coworkerId: COWORKER_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        accessId: "access-3",
        status: "REVOKED",
      });
    }
    expect(forceRevokeForCoworkerMock).toHaveBeenCalledWith(COWORKER_ID, {
      workspaceId: WORKSPACE_ID,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/developer/coworkers/${COWORKER_ID}`,
    );
  });

  it("rejects invalid workspace id", async () => {
    const result = await revokeDeveloperCoworkerEarlyAccessAction({
      coworkerId: COWORKER_ID,
      workspaceId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: CommonErrorCode.BAD_INPUT,
      });
    }
    expect(forceRevokeForCoworkerMock).not.toHaveBeenCalled();
  });
});
