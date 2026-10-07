import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AuthErrorPage from "./page";

function translate(namespace: string) {
  return (key: string, values?: Record<string, string>) =>
    [`${namespace}.${key}`, ...Object.values(values ?? {})].join(" ");
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => translate(namespace),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translate(namespace),
}));

async function renderPage(searchParams: Record<string, string>) {
  render(await AuthErrorPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("AuthErrorPage", () => {
  // SignInErrorNotice's test covers every code; one per message is enough here.
  it("asks the person to sign in again when the sign-in's state is gone", async () => {
    await renderPage({ error: "state_mismatch" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auth.SignInError.expired",
    );
    expect(
      screen.getByText("Auth.SignInError.code state_mismatch"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Auth.SignInError.backToSignIn" }),
    ).toHaveAttribute("href", "/signin");
  });

  it("tells the app's developer about a misconfigured client", async () => {
    await renderPage({ error: "invalid_client" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auth.SignInError.clientMisconfigured",
    );
    expect(
      screen.getByText("Auth.SignInError.code invalid_client"),
    ).toBeVisible();
  });

  it("shows the description as text, never as markup", async () => {
    await renderPage({
      error: "invalid_client",
      error_description: '<img src=x onerror="alert(1)"> client not found',
    });

    expect(
      screen.getByText(
        'Auth.SignInError.description <img src=x onerror="alert(1)"> client not found',
      ),
    ).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to the generic message for any other code", async () => {
    await renderPage({ error: "internal_server_error" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auth.SignInError.generic",
    );
    expect(
      screen.getByText("Auth.SignInError.code internal_server_error"),
    ).toBeVisible();
  });

  it("keeps only letters, digits, underscores and hyphens of the code", async () => {
    await renderPage({ error: "state_mismatch<script>alert(1)</script>" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auth.SignInError.generic",
    );
    expect(
      screen.getByText(
        "Auth.SignInError.code state_mismatchscriptalert1script",
      ),
    ).toBeVisible();
  });

  it("still explains the failure without a code", async () => {
    await renderPage({});

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Auth.SignInError.generic",
    );
    expect(screen.getByText("Auth.SignInError.code unknown")).toBeVisible();
  });
});
