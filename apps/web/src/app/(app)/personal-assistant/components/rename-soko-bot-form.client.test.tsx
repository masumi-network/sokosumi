import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { RenameSokoBotForm } from "./rename-soko-bot-form.client";
import { SokoBotTargetContext } from "./soko-bot-target";

const renameMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  renameSokoBotAction: (...args: unknown[]) => renameMock(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function renderForm(botId: string | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SokoBotTargetContext.Provider value={botId}>
        <RenameSokoBotForm initial="Atlas" />
      </SokoBotTargetContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("RenameSokoBotForm", () => {
  beforeEach(() => {
    renameMock.mockReset();
    refreshMock.mockReset();
    renameMock.mockResolvedValue({ ok: true, value: { name: "Nova" } });
  });

  it("keeps Save off until the name changes", async () => {
    renderForm();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Atlas");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("saves the trimmed name for the shared bot shown and refreshes", async () => {
    const user = userEvent.setup();
    renderForm(BOT_ID);
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "  Nova  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(renameMock).toHaveBeenCalledWith({ name: "Nova", botId: BOT_ID });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("says why a blank name is refused, without calling Core", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a name.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(renameMock).not.toHaveBeenCalled();
  });
});
