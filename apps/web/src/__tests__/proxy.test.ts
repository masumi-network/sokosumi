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
      MAINTENANCE_MODE: false,
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "codex/evaluate-cookie-prefix-usage",
      VERCEL_ENV: "preview",
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

  it("edge-redirects anonymous / to /signin with returnUrl without running the app shell", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    getSessionCookieMock.mockReturnValue(null);
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/",
    );

    const response = await proxy(request);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/signin?returnUrl=%2F",
    );
    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
    expect(getSessionCookieMock).toHaveBeenCalledTimes(1);
  });

  it("edge-redirects anonymous /?dm=new to /signin preserving compose returnUrl", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    getSessionCookieMock.mockReturnValue(null);
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/?dm=new",
    );

    const response = await proxy(request);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/signin?returnUrl=%2F%3Fdm%3Dnew",
    );
    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
    expect(getSessionCookieMock).toHaveBeenCalledTimes(1);
  });

  it("edge-redirects authenticated / through to Welcome (no redirect loop)", async () => {
    const { NextRequest, NextResponse } = await import("next/server");
    const { proxy } = await import("../proxy");
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/",
    );

    const response = await proxy(request);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-pathname")).toBe("/");
    expect(response?.headers.get("Cross-Origin-Opener-Policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
  });

  it("expires the retired subscription onboarding gate cookie when present", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    const { RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME } = await import(
      "@/lib/retired-onboarding-storage"
    );
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/agents",
    );
    request.cookies.set(
      RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME,
      "sess-1",
    );

    const response = await proxy(request);
    const setCookie = [
      ...response.headers.getSetCookie(),
      response.headers.get("set-cookie") ?? "",
    ].join("\n");

    expect(setCookie).toContain(
      RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME,
    );
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it("does not emit the retired gate cookie when it is already absent", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    const { RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME } = await import(
      "@/lib/retired-onboarding-storage"
    );
    const request = new NextRequest(
      "https://sokosumi-app-preprod-git-codex-evaluate-cookie-prefix-usage.preview.sokosumi.com/agents",
    );

    const response = await proxy(request);

    expect(
      response.cookies.get(RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME),
    ).toBeUndefined();
    expect(response.headers.getSetCookie().join("\n")).not.toContain(
      RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME,
    );
  });
});
