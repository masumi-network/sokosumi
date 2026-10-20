import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  deleteAdminSokoBotAction: vi.fn(),
}));

import { AdminSokoBotDangerZone } from "../admin-soko-bot-danger-zone.client";

function typeConfirmation(value: string): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

describe("AdminSokoBotDangerZone", () => {
  it("arms delete on the owner's email for a personal bot", () => {
    render(
      <AdminSokoBotDangerZone
        sokoBotId="bot_1"
        botName="Atlas"
        ownerEmail="Ada@Example.com"
      />,
    );
    expect(
      screen.getByText('confirmLabel:{"email":"Ada@Example.com"}'),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "delete" });
    typeConfirmation("bot_1");
    expect(button).toBeDisabled();
    typeConfirmation(" ada@example.com ");
    expect(button).toBeEnabled();
  });

  it("arms delete on the bot id for a shared bot, which has no owner", () => {
    render(
      <AdminSokoBotDangerZone
        sokoBotId="bot_2"
        botName="Ops"
        ownerEmail={null}
      />,
    );
    expect(
      screen.getByText('confirmLabelShared:{"id":"bot_2"}'),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "delete" });
    expect(button).toBeDisabled();
    typeConfirmation("bot_2");
    expect(button).toBeEnabled();
  });
});
