import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmailChip } from "./email-chip";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const EMAIL = "ada.lovelace@example.com";

describe("EmailChip", () => {
  it("goes back to change the address, which it describes", async () => {
    const onChange = vi.fn();
    render(<EmailChip email={EMAIL} onChange={onChange} />);

    const change = screen.getByRole("button", { name: "changeEmail" });
    expect(change).toHaveAccessibleDescription(EMAIL);
    await userEvent.setup().click(change);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("shows a cut-off address whole on hover", () => {
    render(<EmailChip email={EMAIL} onChange={vi.fn()} />);

    expect(screen.getByText(EMAIL)).toHaveAttribute("title", EMAIL);
  });

  it("stays put while the step is busy", () => {
    render(<EmailChip email={EMAIL} onChange={vi.fn()} disabled />);

    expect(screen.getByRole("button", { name: "changeEmail" })).toBeDisabled();
  });

  it("shows an invitation's fixed address without a way to change it", () => {
    render(<EmailChip email={EMAIL} />);

    expect(screen.getByTestId("auth-email-chip")).toHaveTextContent(EMAIL);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
