import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const updateCoworkerDisplayMock = vi.fn();
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
    updateCoworkerDisplay: (...args: unknown[]) =>
      updateCoworkerDisplayMock(...args),
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
    const { updateAdminCoworkerAction } = await import("../action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await updateAdminCoworkerAction({
      session: memberSession,
      id: "cow_123",
      input: {
        name: "Ops Agent",
        caption: "",
        description: "",
        image: "",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(result.error.message).toBe("Admin access required");
    expect(updateCoworkerDisplayMock).not.toHaveBeenCalled();
    expect(toCoreApiActionErrorMock).not.toHaveBeenCalled();
  });

  it("updates display fields for admin sessions", async () => {
    const { updateAdminCoworkerAction } = await import("../action");

    updateCoworkerDisplayMock.mockResolvedValue({
      id: "cow_123",
      name: "Ops Agent",
    });

    const result = await updateAdminCoworkerAction({
      session: adminSession,
      id: "cow_123",
      input: {
        name: "Ops Agent",
        caption: "Partner",
        description: "",
        image: "https://example.com/logo.png",
      },
    });

    expect(result.ok).toBe(true);
    expect(updateCoworkerDisplayMock).toHaveBeenCalledWith("cow_123", {
      name: "Ops Agent",
      caption: "Partner",
      description: null,
      image: "https://example.com/logo.png",
    });
  });
});
