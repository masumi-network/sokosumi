import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AvatarPicker } from "./avatar-picker.client";

const topUpMock = vi.fn();

vi.mock("@/lib/actions/soko-bot/action", () => ({
  topUpSokoBotAvatarsAction: (...args: unknown[]) => topUpMock(...args),
}));

function renderPicker() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AvatarPicker value={null} onChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("AvatarPicker", () => {
  it("does not show Show others as busy while the first set loads", () => {
    topUpMock.mockReturnValue(new Promise(() => {}));
    renderPicker();

    const showOthers = screen.getByRole("button", { name: "Show others" });
    expect(showOthers).toBeDisabled();
    expect(showOthers).not.toHaveAttribute("aria-busy");
  });

  it("enables Show others once the first set is in", async () => {
    topUpMock.mockResolvedValue({
      ok: true,
      value: [{ id: "a1", imageUrl: "/a1.webp", subject: "owl" }],
    });
    renderPicker();

    expect(await screen.findByRole("button", { name: "owl" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show others" })).toBeEnabled();
  });
});
