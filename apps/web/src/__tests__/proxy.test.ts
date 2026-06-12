import { beforeEach, describe, expect, it, vi } from "vitest";

import { CROSS_ORIGIN_OPENER_POLICY } from "@/config/document-security-headers";

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
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "codex/evaluate-cookie-prefix-usage",
      VERCEL_BRANCH_URL:
        "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.vercel.app",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_URL: "https://sokosumi-app-preprod-abc123.vercel.app",
    });
    getSessionCookieMock.mockReturnValue("session-token");
  });

  it("checks the session cookie using the preview commit ref", async () => {
    const { NextRequest, NextResponse } = await import("next/server");
    const { proxy } = await import("../proxy");
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/dashboard?tab=overview",
    );

    const response = await proxy(request);

    expect(getSessionCookieMock).toHaveBeenCalledWith(request, {
      cookiePrefix:
        "sokosumi-preview-preprod-codex-evaluate-cookie-prefix-usage",
    });
    expect(response).toBeInstanceOf(NextResponse);
    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
  });

  it("sets COOP on the Composio callback route without requiring a session", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    getSessionCookieMock.mockReturnValue(null);
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/composio/callback?status=success",
    );

    const response = await proxy(request);

    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
    expect(getSessionCookieMock).not.toHaveBeenCalled();
  });
});
