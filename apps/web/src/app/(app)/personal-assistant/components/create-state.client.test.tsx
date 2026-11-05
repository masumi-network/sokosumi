import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { CreateState } from "./create-state.client";

const pushMock = vi.fn();
const createMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  createSokoBotAction: (...args: unknown[]) => createMock(...args),
}));

vi.mock("./avatar-picker.client", () => ({
  AvatarPicker: () => <div data-testid="avatar-picker" />,
}));

vi.mock("./open-new-soko-bot-room", () => ({
  openNewSokoBotRoom: vi.fn(async () => "room-1"),
}));

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CreateState paidByOrganization={false} />
    </NextIntlClientProvider>,
  );
}

describe("CreateState", () => {
  it("asks for the name first, then the picture, with the steps shown", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(
      screen.getByRole("heading", { name: "Name your Soko Bot" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Step 1 of 3" })).toBeTruthy();
    // The pictures already load behind the first step.
    expect(screen.getByTestId("avatar-picker")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Pick a picture for Atlas" }),
    ).toBeNull();

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Pick a picture for Atlas" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Step 2 of 3" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Atlas");
  });

  it("creates the bot with the name from the first step", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: true,
      value: { id: "bot-1", name: "Atlas" },
    });
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    await user.click(screen.getByRole("button", { name: "Create Atlas" }));

    expect(createMock).toHaveBeenCalledWith({
      input: { name: "Atlas", avatarId: null },
    });
    expect(await screen.findByText("Meet Atlas")).toBeTruthy();
  });
});
