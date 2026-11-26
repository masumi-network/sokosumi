import { render, screen } from "@testing-library/react";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOAuthClientPublicMock } = vi.hoisted(() => ({
  getOAuthClientPublicMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({ session: { id: "session_1" } }),
  getOAuthClientPublic: getOAuthClientPublicMock,
}));

vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: () => null,
}));

vi.mock("./consent-actions", () => ({
  ConsentActions: () => null,
}));

import ConsentPage from "./page";

async function renderPage(searchParams: Record<string, string | string[]>) {
  render(await ConsentPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("ConsentPage", () => {
  beforeEach(() => {
    getOAuthClientPublicMock.mockReset();
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_id: "client_1", client_name: "Agent", selfRegistered: true }),
    );
  });

  const signedQuery = {
    client_id: "client_1",
    scope: "openid sokosumi:mcp",
    exp: "1772367377",
    sig: "abc",
  };

  it("shows the redirect host Core signed", async () => {
    await renderPage({
      ...signedQuery,
      redirect_uri: "https://signed.example/cb",
      ba_param: ["client_id", "scope", "redirect_uri", "exp"],
    });

    expect(
      screen.getByText('redirectHost {"host":"signed.example"}'),
    ).toBeInTheDocument();
  });

  // A `redirect_uri` outside the signed parameter names never reaches Core's
  // consent call, so the page must not name it either.
  it("ignores a redirect_uri that is not part of the signed query", async () => {
    await renderPage({
      ...signedQuery,
      redirect_uri: "https://unsigned.example/cb",
      ba_param: ["client_id", "scope", "exp"],
    });

    expect(screen.getByText("unverifiedNotice")).toBeInTheDocument();
    expect(screen.queryByText(/^redirectHost/)).not.toBeInTheDocument();
  });

  it("names no redirect host when the query carries no signature", async () => {
    await renderPage({
      client_id: "client_1",
      scope: "openid",
      redirect_uri: "https://unsigned.example/cb",
    });

    expect(screen.queryByText(/^redirectHost/)).not.toBeInTheDocument();
  });
});
