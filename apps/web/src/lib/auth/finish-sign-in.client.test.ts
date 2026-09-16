import { beforeEach, describe, expect, it, vi } from "vitest";

import { finishSignInInPlace } from "./finish-sign-in.client";

const mockWaitForAuthSession = vi.fn();
const mockSignInEvent = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { getSession: vi.fn() },
}));

vi.mock("@/lib/auth/auth.utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
    "@/lib/auth/auth.utils",
  );
  return {
    ...actual,
    waitForAuthSession: (...args: unknown[]) => mockWaitForAuthSession(...args),
  };
});

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { signIn: (...args: unknown[]) => mockSignInEvent(...args) },
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

describe("finishSignInInPlace", () => {
  const router = { replace: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts the login and soft-navigates to the return URL once a session exists", async () => {
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    await finishSignInInPlace({
      provider: "credential",
      returnUrl: "/chat",
      router,
    });

    expect(mockSignInEvent).toHaveBeenCalledWith("credential");
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });

  it("still navigates home without counting a login when no session appears", async () => {
    mockWaitForAuthSession.mockResolvedValue(null);

    await finishSignInInPlace({
      provider: "passkey",
      returnUrl: undefined,
      router,
    });

    expect(mockSignInEvent).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("never navigates off-origin", async () => {
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    await finishSignInInPlace({
      provider: "credential",
      returnUrl: "https://evil.example/phish",
      router,
    });

    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
