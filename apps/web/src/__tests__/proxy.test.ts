import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCookieMock = vi.fn();
const getEnvSecretsMock = vi.fn();

vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (...args: unknown[]) => getSessionCookieMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvSecretsMock.mockReturnValue({
      BETTER_AUTH_URL: "https://feature-123.preview.sokosumi.com/auth",
      MAINTENANCE_MODE: false,
      VERCEL_BRANCH_URL:
        "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.vercel.app",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_URL: "https://sokosumi-app-preprod-abc123.vercel.app",
    });
    getSessionCookieMock.mockReturnValue("session-token");
  });

  it("checks the session cookie using the Better Auth preview URL, not the custom preview host", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/dashboard?tab=overview",
    );

    await proxy(request);

    expect(getSessionCookieMock).toHaveBeenCalledWith(request, {
      cookiePrefix: "sokosumi-preview-codex-evaluate-cookie-prefix-usage",
    });
  });
});
