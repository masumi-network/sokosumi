import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppleAppCallbackPage from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("AppleAppCallbackPage", () => {
  it("tells the person to go back to the app and sign in again", async () => {
    render(await AppleAppCallbackPage());

    expect(
      screen.getByRole("heading", { name: "AppleAppCallback.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AppleAppCallback.message")).toBeInTheDocument();
  });

  it("reads nothing from the request, so the authorization code stays unused", () => {
    expect(AppleAppCallbackPage).toHaveLength(0);
  });
});
