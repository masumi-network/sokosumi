import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import RegisterLoadingPage from "./loading";

describe("SignUp loading skeleton", () => {
  it("keeps the returnUrl on the sign-in link", () => {
    mockSearchParams = new URLSearchParams({
      returnUrl: "/oauth/consent?client_id=client_1&exp=1&sig=abc%2B",
    });

    render(<RegisterLoadingPage />);

    const href = screen
      .getByRole("link", { name: "Login.link" })
      .getAttribute("href");

    expect(
      new URL(href ?? "", "http://localhost").searchParams.get("returnUrl"),
    ).toBe("/oauth/consent?client_id=client_1&exp=1&sig=abc%2B");
  });
});
