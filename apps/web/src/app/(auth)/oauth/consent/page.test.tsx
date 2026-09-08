import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOAuthClientPublicMock, getSessionMock, redirectMock } = vi.hoisted(
  () => ({
    getOAuthClientPublicMock: vi.fn(),
    getSessionMock: vi.fn(),
    redirectMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next-intl/server", async () => {
  const { default: messages } = await import("../../../../../messages/en.json");
  const consentMessages = messages.App.Account.OAuthConsent as Record<
    string,
    unknown
  >;

  return {
    getTranslations:
      async () => (key: string, values?: Record<string, string>) => {
        let value: unknown = consentMessages;

        for (const part of key.split(".")) {
          if (!value || typeof value !== "object") {
            return key;
          }

          value = (value as Record<string, unknown>)[part];
        }

        if (typeof value !== "string") {
          return key;
        }

        return value.replace(
          /\{(\w+)\}/g,
          (_, name: string) => values?.[name] ?? `{${name}}`,
        );
      },
  };
});

vi.mock("@/lib/auth/auth.server", () => ({
  getOAuthClientPublic: getOAuthClientPublicMock,
  getSession: getSessionMock,
}));

vi.mock("./consent-actions", () => ({
  ConsentActions: () => null,
}));

describe("ConsentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ session: { id: "session_1" } });
    getOAuthClientPublicMock.mockResolvedValue({
      isErr: () => false,
      value: {
        client_id: "cli-client",
        client_name: "CLI",
      },
    });
  });

  it.each([
    { api: false, name: "openid only", offline: false, scope: "openid" },
    {
      api: true,
      name: "API access",
      offline: false,
      scope: "openid sokosumi:api",
    },
    {
      api: false,
      name: "offline access",
      offline: true,
      scope: "openid offline_access",
    },
    {
      api: true,
      name: "API and offline access",
      offline: true,
      scope: "openid sokosumi:api offline_access",
    },
  ])(
    "renders $name permissions with Sokosumi branding",
    async ({ api, offline, scope }) => {
      const { default: ConsentPage } = await import("./page");

      render(
        await ConsentPage({
          searchParams: Promise.resolve({
            client_id: "cli-client",
            exp: "1772367377",
            redirect_uri: "http://127.0.0.1:49152/oauth/callback",
            scope,
            sig: "abc+def/ghi=",
          }),
        }),
      );

      expect(screen.getByText("Authorize access")).toBeInTheDocument();
      expect(screen.getByText("CLI")).toBeInTheDocument();
      expect(screen.getByText("OAuth client")).toBeInTheDocument();
      expect(screen.getByLabelText("Sokosumi Icon")).toBeInTheDocument();
      expect(Boolean(screen.queryByText("This app requests"))).toBe(
        api || offline,
      );
      expect(Boolean(screen.queryByText("Sokosumi API"))).toBe(api);
      expect(Boolean(screen.queryByText("sokosumi:api"))).toBe(api);
      expect(Boolean(screen.queryByText("Stay signed in"))).toBe(offline);
      expect(Boolean(screen.queryByText("offline_access"))).toBe(offline);
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );
});
