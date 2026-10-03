import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PasswordInput } from "./password-input";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

describe("PasswordInput", () => {
  it("names its show and hide control itself", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const field = screen.getByLabelText("Password");

    expect(field).toHaveAttribute("type", "password");
    await user.click(
      screen.getByRole("button", { name: "Components.PasswordToggle.show" }),
    );

    expect(field).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Components.PasswordToggle.hide" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps its accessible name when underlined, with the placeholder as the visible name", () => {
    render(
      <PasswordInput
        variant="underlined"
        aria-label="Password"
        placeholder="Password"
      />,
    );

    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "placeholder",
      "Password",
    );
  });
});
