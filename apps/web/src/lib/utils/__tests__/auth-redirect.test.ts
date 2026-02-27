import {
  getValidAuthRedirectUrl,
  waitForAuthSession,
} from "@/lib/utils/auth-redirect";

describe("getValidAuthRedirectUrl", () => {
  it("returns fallback when returnUrl is missing", () => {
    expect(getValidAuthRedirectUrl(undefined, "/chat")).toBe("/chat");
  });

  it("returns relative returnUrl when it is safe", () => {
    expect(getValidAuthRedirectUrl("/accept-invitation/invite_123", "/chat")).toBe(
      "/accept-invitation/invite_123",
    );
  });

  it("returns fallback for external origins", () => {
    expect(getValidAuthRedirectUrl("https://evil.example/attack", "/chat")).toBe(
      "/chat",
    );
  });

  it("returns fallback for unsupported protocols", () => {
    expect(getValidAuthRedirectUrl("javascript:alert('x')", "/chat")).toBe(
      "/chat",
    );
  });
});

describe("waitForAuthSession", () => {
  it("returns early when session is available after initial wait", async () => {
    const waitForMs = jest.fn(async () => undefined);
    const getSession = jest.fn().mockResolvedValue({ userId: "user_1" });
    const logWarning = jest.fn();

    await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(waitForMs).toHaveBeenCalledTimes(1);
    expect(waitForMs).toHaveBeenCalledWith(10);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(logWarning).not.toHaveBeenCalled();
  });

  it("retries once and logs waiting warning when first session check fails", async () => {
    const waitForMs = jest.fn(async () => undefined);
    const getSession = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user_1" });
    const logWarning = jest.fn();

    await waitForAuthSession({
      context: "signup",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(waitForMs).toHaveBeenCalledTimes(2);
    expect(waitForMs).toHaveBeenNthCalledWith(1, 10);
    expect(waitForMs).toHaveBeenNthCalledWith(2, 20);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      "Session not established after signup, waiting for 20ms",
    );
  });

  it("logs second warning when session is still unavailable after retry", async () => {
    const waitForMs = jest.fn(async () => undefined);
    const getSession = jest.fn().mockResolvedValue(null);
    const logWarning = jest.fn();

    await waitForAuthSession({
      context: "login",
      waitForMs,
      getSession,
      logWarning,
      initialDelayMs: 10,
      retryDelayMs: 20,
    });

    expect(logWarning).toHaveBeenCalledTimes(2);
    expect(logWarning).toHaveBeenNthCalledWith(
      1,
      "Session not established after login, waiting for 20ms",
    );
    expect(logWarning).toHaveBeenNthCalledWith(
      2,
      "Session not established after login, proceeding with redirect anyway",
    );
  });
});
