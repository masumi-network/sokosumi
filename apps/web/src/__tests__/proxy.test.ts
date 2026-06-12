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

  describe("shared auth session cookie shim", () => {
    function buildEnv(cookieDomain: string | undefined) {
      return {
        BETTER_AUTH_COOKIE_DOMAIN: cookieDomain,
        MAINTENANCE_MODE: false,
        NETWORK: "Mainnet",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "",
      };
    }

    it("re-scopes the host-only session cookie on a matching remote host", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv("sokosumi.com"));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("https://app.sokosumi.com/dashboard");
      request.cookies.set("sokosumi.session_token", "tok-123");

      const response = await proxy(request);

      const sessionCookie = response.cookies.get("sokosumi.session_token");
      expect(sessionCookie).toMatchObject({
        value: "tok-123",
        domain: "sokosumi.com",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      expect(
        response.cookies.get("sokosumi.session_token_rescoped"),
      ).toMatchObject({
        value: "1",
        domain: "sokosumi.com",
      });
    });

    it("re-scopes host-only session cookies on localhost for cross-port core access", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv(undefined));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("http://localhost:3000/tasks");
      request.cookies.set("sokosumi.session_token", "tok");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toMatchObject({
        value: "tok",
        domain: "localhost",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      expect(
        response.cookies.get("sokosumi.session_token_rescoped"),
      ).toMatchObject({
        value: "1",
        domain: "localhost",
      });
    });

    it("uses localhost on local dev even when a production cookie domain is configured", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv("sokosumi.com"));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("http://localhost:3000/dashboard");
      request.cookies.set("sokosumi.session_token", "tok");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toMatchObject({
        value: "tok",
        domain: "localhost",
      });
      expect(
        response.cookies.get("sokosumi.session_token_rescoped"),
      ).toMatchObject({
        value: "1",
        domain: "localhost",
      });
    });

    it("re-scopes the __Secure- session cookie with the secure flag", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv("sokosumi.com"));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("https://app.sokosumi.com/dashboard");
      request.cookies.set("__Secure-sokosumi.session_token", "tok-secure");

      const response = await proxy(request);

      expect(
        response.cookies.get("__Secure-sokosumi.session_token"),
      ).toMatchObject({
        value: "tok-secure",
        domain: "sokosumi.com",
        secure: true,
      });
    });

    it("does nothing when the marker cookie is already present", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv("sokosumi.com"));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("https://app.sokosumi.com/dashboard");
      request.cookies.set("sokosumi.session_token", "tok-123");
      request.cookies.set("sokosumi.session_token_rescoped", "1");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toBeUndefined();
    });

    it("does nothing when the legacy localhost marker cookie is already present", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv(undefined));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("http://localhost:3000/tasks");
      request.cookies.set("sokosumi.session_token", "tok");
      request.cookies.set("sokosumi.session_cross_port_scoped", "1");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toBeUndefined();
    });

    it("does nothing on remote hosts without a configured cookie domain", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv(undefined));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest("https://app.sokosumi.com/dashboard");
      request.cookies.set("sokosumi.session_token", "tok-123");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toBeUndefined();
    });

    it("does nothing when the remote host does not match the configured cookie domain", async () => {
      getEnvSecretsMock.mockReturnValue(buildEnv("sokosumi.com"));
      const { NextRequest } = await import("next/server");
      const { proxy } = await import("../proxy");
      const request = new NextRequest(
        "https://my-app.example.vercel.app/dashboard",
      );
      request.cookies.set("sokosumi.session_token", "tok-123");

      const response = await proxy(request);

      expect(response.cookies.get("sokosumi.session_token")).toBeUndefined();
    });
  });
});
