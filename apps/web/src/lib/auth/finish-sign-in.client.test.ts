import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { finishSignInInPlace } from "./finish-sign-in.client";

const mockWaitForAuthSession = vi.fn();
const mockSignInEvent = vi.fn();
const mockLocationReplace = vi.fn();

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
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "http://localhost",
        replace: (...args: unknown[]) => mockLocationReplace(...args),
      } as unknown as Location,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts the login and leaves for the return URL once a session exists", async () => {
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    await finishSignInInPlace({ provider: "credential", returnUrl: "/chat" });

    expect(mockSignInEvent).toHaveBeenCalledWith("credential");
    expect(mockLocationReplace).toHaveBeenCalledWith("/chat");
  });

  it("still leaves for the app without counting a login when no session appears", async () => {
    mockWaitForAuthSession.mockResolvedValue(null);

    await finishSignInInPlace({ provider: "passkey", returnUrl: undefined });

    expect(mockSignInEvent).not.toHaveBeenCalled();
    expect(mockLocationReplace).toHaveBeenCalledWith("/");
  });

  it("never navigates off-origin", async () => {
    mockWaitForAuthSession.mockResolvedValue({ id: "session-1" });

    await finishSignInInPlace({
      provider: "credential",
      returnUrl: "https://evil.example/phish",
    });

    expect(mockLocationReplace).toHaveBeenCalledWith("/");
  });
});
