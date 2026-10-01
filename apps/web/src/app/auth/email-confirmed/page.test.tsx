import { render, screen } from "@testing-library/react";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EmailConfirmedPage from "./page";

const getSessionMock = vi.fn();
const getOAuthClientPublicMock = vi.fn();

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
  getOAuthClientPublic: (clientId: string) =>
    getOAuthClientPublicMock(clientId),
  getOAuthClientPublicPrelogin: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async (namespace: string) => (key: string, values?: { client?: string }) =>
      `${namespace}.${key}${values?.client ? ` ${values.client}` : ""}`,
}));

function renderPage(searchParams: Record<string, string>) {
  return EmailConfirmedPage({ searchParams: Promise.resolve(searchParams) });
}

describe("EmailConfirmedPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Verifying the email signs the person in, so the page has a session.
    getSessionMock.mockResolvedValue({ session: { id: "session-1" } });
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_name: "CMO", client_uri: "https://app.cmo.xyz" }),
    );
  });

  it("confirms the email and sends the person back to the app they signed up for", async () => {
    render(await renderPage({ client_id: "cmo" }));

    expect(getOAuthClientPublicMock).toHaveBeenCalledWith("cmo");
    expect(
      screen.getByRole("heading", { name: "EmailConfirmed.title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "EmailConfirmed.returnTo CMO" }),
    ).toHaveAttribute("href", "https://app.cmo.xyz/");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("offers no way back to a home page that is not https", async () => {
    getOAuthClientPublicMock.mockResolvedValue(
      ok({ client_name: "CMO", client_uri: "javascript:alert(1)" }),
    );

    render(await renderPage({ client_id: "cmo" }));

    expect(screen.getByText("EmailConfirmed.messageFor CMO")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("names no app to a person without a session", async () => {
    getSessionMock.mockResolvedValue(null);

    render(await renderPage({ client_id: "cmo" }));

    expect(getOAuthClientPublicMock).not.toHaveBeenCalled();
    expect(screen.getByText("EmailConfirmed.message")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("still confirms the email when Core cannot name the app", async () => {
    getOAuthClientPublicMock.mockResolvedValue(
      err({ reason: "network", message: "Core unavailable" }),
    );

    render(await renderPage({ client_id: "cmo" }));

    expect(screen.getByText("EmailConfirmed.message")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says the email is not confirmed when Core refused the link", async () => {
    render(await renderPage({ client_id: "cmo", error: "TOKEN_EXPIRED" }));

    expect(
      screen.getByRole("heading", { name: "EmailConfirmed.errorTitle" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "EmailConfirmed.title" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "EmailConfirmed.returnTo CMO" }),
    ).toBeInTheDocument();
  });
});
