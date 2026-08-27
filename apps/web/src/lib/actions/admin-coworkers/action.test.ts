import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const updateDisplayMock = vi.fn();
const createForCoworkerMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

vi.mock("@/lib/services/admin-coworker.service", () => ({
  adminCoworkerService: {
    updateDisplay: (...args: unknown[]) => updateDisplayMock(...args),
  },
}));

vi.mock("@/lib/services/coworker-access.service", () => ({
  coworkerAccessService: {
    createForCoworker: (...args: unknown[]) => createForCoworkerMock(...args),
  },
}));

describe("admin coworker actions", () => {
  const adminSession = {
    user: {
      id: "admin-1",
      role: "admin",
    },
  } as never;

  const memberSession = {
    user: {
      id: "user-1",
      role: "user",
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error",
    }));
  });

  it("returns UNAUTHORIZED when a signed-in non-admin invokes update action", async () => {
    const { updateAdminCoworkerDisplayAction } = await import("./action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await updateAdminCoworkerDisplayAction({
      session: memberSession,
      id: "cow_123",
      patchBody: {
        name: "Ops Agent",
      },
      imageIntent: "none",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(result.error.message).toBe("Admin access required");
    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(toCoreApiActionErrorMock).not.toHaveBeenCalled();
  });

  it("updates display fields for admin sessions", async () => {
    const { updateAdminCoworkerDisplayAction } = await import("./action");

    updateDisplayMock.mockResolvedValue({
      coworker: {
        id: "cow_123",
        name: "Ops Agent",
      },
    });

    const result = await updateAdminCoworkerDisplayAction({
      session: adminSession,
      id: "cow_123",
      patchBody: {
        name: "Ops Agent",
        caption: "Partner",
        description: null,
      },
      imageIntent: "none",
    });

    expect(result.ok).toBe(true);
    expect(updateDisplayMock).toHaveBeenCalledWith({
      id: "cow_123",
      patchBody: {
        name: "Ops Agent",
        caption: "Partner",
        description: null,
      },
      imageIntent: "none",
      imageFile: undefined,
    });
  });

  it("uploads an image for admin sessions", async () => {
    const { updateAdminCoworkerDisplayAction } = await import("./action");
    const file = new File(["png"], "logo.png", { type: "image/png" });

    updateDisplayMock.mockResolvedValue({
      coworker: {
        id: "cow_123",
        name: "Ops Agent",
        image: "https://blob.example/logo.png",
      },
    });

    const result = await updateAdminCoworkerDisplayAction({
      session: adminSession,
      id: "cow_123",
      imageIntent: "upload",
      imageFile: file,
    });

    expect(result.ok).toBe(true);
    expect(updateDisplayMock).toHaveBeenCalledWith({
      id: "cow_123",
      patchBody: undefined,
      imageIntent: "upload",
      imageFile: file,
    });
  });

  it("rejects names shorter than three characters", async () => {
    const { updateAdminCoworkerDisplayAction } = await import("./action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await updateAdminCoworkerDisplayAction({
      session: adminSession,
      id: "cow_123",
      patchBody: {
        name: "ab",
      },
      imageIntent: "none",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(updateDisplayMock).not.toHaveBeenCalled();
  });

  it("rejects captions longer than 255 characters", async () => {
    const { updateAdminCoworkerDisplayAction } = await import("./action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await updateAdminCoworkerDisplayAction({
      session: adminSession,
      id: "cow_123",
      patchBody: {
        caption: "x".repeat(256),
      },
      imageIntent: "none",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(result.error.message).toMatch(/caption/i);
    expect(updateDisplayMock).not.toHaveBeenCalled();
  });

  it("returns UNAUTHORIZED when non-admin grants early access", async () => {
    const { grantAdminCoworkerEarlyAccessAction } = await import("./action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await grantAdminCoworkerEarlyAccessAction({
      session: memberSession,
      coworkerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "organization",
      targetId: "org_123",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(createForCoworkerMock).not.toHaveBeenCalled();
  });

  it("grants early access for admin sessions by organization", async () => {
    const { grantAdminCoworkerEarlyAccessAction } = await import("./action");

    createForCoworkerMock.mockResolvedValue({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "GRANTED",
    });

    const result = await grantAdminCoworkerEarlyAccessAction({
      session: adminSession,
      coworkerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "organization",
      targetId: "org_123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }

    expect(createForCoworkerMock).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { organizationId: "org_123" },
    );
    expect(result.value).toEqual({
      accessId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "GRANTED",
    });
  });

  it("grants early access for admin sessions by user", async () => {
    const { grantAdminCoworkerEarlyAccessAction } = await import("./action");

    createForCoworkerMock.mockResolvedValue({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "GRANTED",
    });

    const result = await grantAdminCoworkerEarlyAccessAction({
      session: adminSession,
      coworkerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "user",
      targetId: "user_123",
    });

    expect(result.ok).toBe(true);
    expect(createForCoworkerMock).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { userId: "user_123" },
    );
  });

  it("rejects missing target id for early access grant", async () => {
    const { grantAdminCoworkerEarlyAccessAction } = await import("./action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await grantAdminCoworkerEarlyAccessAction({
      session: adminSession,
      coworkerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "user",
      targetId: "",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(createForCoworkerMock).not.toHaveBeenCalled();
  });
});
