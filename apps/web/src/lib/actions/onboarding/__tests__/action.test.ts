import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const completeMyOnboardingMock = vi.fn();
const markOnboardingCompleteForMeMock = vi.fn();
const getSessionMock = vi.fn();
const revalidatePathMock = vi.fn();
const cookiesSetMock = vi.fn();
const cookiesDeleteMock = vi.fn();
const getTranslationsMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (...args: unknown[]) => cookiesSetMock(...args),
    delete: (...args: unknown[]) => cookiesDeleteMock(...args),
  }),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_VERCEL_ENV: "development",
  }),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    completeMyOnboarding: (...args: unknown[]) =>
      completeMyOnboardingMock(...args),
  },
}));

vi.mock("@/lib/services", () => ({
  userService: {
    markOnboardingCompleteForMe: (...args: unknown[]) =>
      markOnboardingCompleteForMeMock(...args),
  },
}));

describe("completeOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTranslationsMock.mockResolvedValue(
      ((key: string) => key) as unknown as Awaited<
        ReturnType<typeof getTranslationsMock>
      >,
    );
    getSessionMock.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1" },
    });
    completeMyOnboardingMock.mockResolvedValue({ data: { completed: true } });
    markOnboardingCompleteForMeMock.mockResolvedValue(undefined);
  });

  it("always calls Core complete, then BA session sync, with profile when provided", async () => {
    const { completeOnboarding } = await import("../action");

    const profile = {
      companySize: "11-50" as const,
      companyType: "agency" as const,
      role: "founder" as const,
      workStyle: "team" as const,
    };

    const result = await completeOnboarding(profile);

    expect(result.ok).toBe(true);
    expect(completeMyOnboardingMock).toHaveBeenCalledWith({ profile });
    expect(markOnboardingCompleteForMeMock).toHaveBeenCalledTimes(1);
    expect(cookiesSetMock).toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    if (result.ok) {
      expect(result.value.redirectUrl).toBe("/tasks");
    }
  });

  it("still calls Core complete with no body when profile is empty or omitted", async () => {
    const { completeOnboarding } = await import("../action");

    const emptyResult = await completeOnboarding({});
    expect(emptyResult.ok).toBe(true);
    expect(completeMyOnboardingMock).toHaveBeenCalledWith(undefined);
    expect(markOnboardingCompleteForMeMock).toHaveBeenCalledTimes(1);

    completeMyOnboardingMock.mockClear();
    markOnboardingCompleteForMeMock.mockClear();

    const omittedResult = await completeOnboarding();
    expect(omittedResult.ok).toBe(true);
    expect(completeMyOnboardingMock).toHaveBeenCalledWith(undefined);
    expect(markOnboardingCompleteForMeMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error when Core complete fails before BA sync", async () => {
    completeMyOnboardingMock.mockRejectedValue(new Error("core down"));

    const { completeOnboarding } = await import("../action");
    const result = await completeOnboarding({ role: "founder" });

    expect(result.ok).toBe(false);
    expect(markOnboardingCompleteForMeMock).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.error.message).toBe("core down");
    }
  });

  it("surfaces an error when BA session sync fails after Core complete", async () => {
    markOnboardingCompleteForMeMock.mockRejectedValue(
      new Error("session sync failed"),
    );

    const { completeOnboarding } = await import("../action");
    const result = await completeOnboarding();

    expect(completeMyOnboardingMock).toHaveBeenCalledWith(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("session sync failed");
    }
  });
});
