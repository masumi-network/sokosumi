import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const getOwnedCoworkerByIdMock = vi.fn();
const updateDisplayMock = vi.fn();
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

vi.mock("@/lib/services/developer-coworker.service", () => ({
  developerCoworkerService: {
    getOwnedCoworkerById: (...args: unknown[]) =>
      getOwnedCoworkerByIdMock(...args),
  },
}));

vi.mock("@/lib/services/coworker-display.service", () => ({
  coworkerDisplayService: {
    updateDisplay: (...args: unknown[]) => updateDisplayMock(...args),
  },
}));

describe("developer coworker actions", () => {
  const session = {
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

  it("returns NOT_FOUND when coworker is not owned", async () => {
    const { updateDeveloperCoworkerDisplayAction } = await import(
      "./update-display.action"
    );
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    getOwnedCoworkerByIdMock.mockResolvedValue(null);

    const result = await updateDeveloperCoworkerDisplayAction({
      session,
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

    expect(result.error.code).toBe(CommonErrorCode.NOT_FOUND);
    expect(updateDisplayMock).not.toHaveBeenCalled();
  });

  it("drops locked fields and sanitizes display patch for owned coworker", async () => {
    const { updateDeveloperCoworkerDisplayAction } = await import(
      "./update-display.action"
    );

    getOwnedCoworkerByIdMock.mockResolvedValue({ id: "cow_123" });
    updateDisplayMock.mockResolvedValue({
      coworker: { id: "cow_123", name: "Ops Agent" },
    });

    const patchBody = {
      name: "Ops Agent",
      caption: "  Partner  ",
      description: "   ",
      image: "https://evil.example/logo.png",
      baseURL: "https://evil.example/base",
      url: "https://evil.example/url",
      capabilities: ["chat", "tasks"],
      priority: 99,
      metadata: { channels: "evil" },
    };

    const result = await updateDeveloperCoworkerDisplayAction({
      session,
      id: "cow_123",
      patchBody,
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
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "baseURL",
    );
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "url",
    );
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "capabilities",
    );
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "priority",
    );
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "metadata",
    );
    expect(updateDisplayMock.mock.calls[0]?.[0]?.patchBody).not.toHaveProperty(
      "image",
    );
  });

  it("rejects names shorter than three characters", async () => {
    const { updateDeveloperCoworkerDisplayAction } = await import(
      "./update-display.action"
    );
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    getOwnedCoworkerByIdMock.mockResolvedValue({ id: "cow_123" });

    const result = await updateDeveloperCoworkerDisplayAction({
      session,
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

  it("returns BAD_INPUT for invalid image intent without calling service", async () => {
    const { updateDeveloperCoworkerDisplayAction } = await import(
      "./update-display.action"
    );
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    getOwnedCoworkerByIdMock.mockResolvedValue({ id: "cow_123" });

    const result = await updateDeveloperCoworkerDisplayAction({
      session,
      id: "cow_123",
      patchBody: {
        name: "Ops Agent",
      },
      imageIntent: "evil",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(getOwnedCoworkerByIdMock).not.toHaveBeenCalled();
  });

  it("returns BAD_INPUT for forged non-string display fields", async () => {
    const { updateDeveloperCoworkerDisplayAction } = await import(
      "./update-display.action"
    );
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await updateDeveloperCoworkerDisplayAction({
      session,
      id: "cow_123",
      patchBody: {
        name: 123,
      },
      imageIntent: "none",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(updateDisplayMock).not.toHaveBeenCalled();
    expect(getOwnedCoworkerByIdMock).not.toHaveBeenCalled();
  });
});
