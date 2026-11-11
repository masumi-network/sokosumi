import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { CreateState } from "./create-state.client";
import { openNewSokoBotRoom } from "./open-new-soko-bot-room";

const pushMock = vi.fn();
const createMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  createSokoBotAction: (...args: unknown[]) => createMock(...args),
}));

// Whether the mocked picker finishes its first set on mount.
let pickerLoadsOnMount = true;

vi.mock("./avatar-picker.client", async () => {
  const { useEffect } = await import("react");
  return {
    // Picks the first avatar on mount, as the real picker does for a new bot.
    AvatarPicker: ({
      onChange,
      onLoadingChange,
    }: {
      onChange: (avatar: { id: string; imageUrl: string }) => void;
      onLoadingChange?: (loading: boolean) => void;
    }) => {
      useEffect(() => {
        if (pickerLoadsOnMount) onLoadingChange?.(false);
      }, [onLoadingChange]);
      return (
        <div data-testid="avatar-picker">
          <button
            type="button"
            onClick={() =>
              onChange({ id: "owl-1", imageUrl: "https://blob.test/owl-1.png" })
            }
          >
            owl
          </button>
          <button type="button" onClick={() => onLoadingChange?.(false)}>
            set loaded
          </button>
        </div>
      );
    },
  };
});

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: () => <div data-testid="orb" />,
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
  afterEach(() => {
    pickerLoadsOnMount = true;
  });

  it("hides the mobile tab bar while the flow is open", () => {
    const { unmount } = renderCreate();
    expect(document.body.dataset.sokoBotCreating).toBe("true");
    unmount();
    expect(document.body.dataset.sokoBotCreating).toBeUndefined();
  });

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

  it("moves focus into each step, since the old step hides the focused control", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    expect(
      screen.getByRole("heading", { name: "Pick a picture for Atlas" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it.each([
    ["spaced", "Pebble the Very Helpful Office Companion"],
    // The field allows 80 characters; one unbroken word must wrap too.
    ["unbroken", "W".repeat(80)],
  ])(
    "keeps a long %s name inside the phone width on the picture step",
    async (_, name) => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Name"), `${name}{Enter}`);

      // Buttons never wrap, so the label truncates; the full name stays its name.
      const label = screen.getByText(`Create ${name}`);
      expect(label).toHaveClass("truncate");
      expect(label.closest("button")).toHaveAccessibleName(`Create ${name}`);
      expect(
        screen.getByRole("heading", { name: `Pick a picture for ${name}` }),
      ).toHaveClass("wrap-anywhere");
    },
  );

  it("locks the pictures while the bot is being created", async () => {
    const user = userEvent.setup();
    createMock.mockReturnValue(new Promise(() => {}));
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const pictures = screen.getByTestId("avatar-picker").closest("fieldset");
    expect(pictures).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Create Atlas" }));
    expect(pictures).toBeDisabled();
  });

  it("holds Create while the pictures load", async () => {
    const user = userEvent.setup();
    pickerLoadsOnMount = false;
    createMock.mockClear();
    createMock.mockReturnValue(new Promise(() => {}));
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const createButton = screen.getByRole("button", { name: "Create Atlas" });
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(createMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "set loaded" }));
    expect(createButton).not.toBeDisabled();
  });

  it("creates the bot with the name from the first step, on the browser's clock", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: true,
      value: { id: "bot-1", name: "Atlas" },
    });
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    await user.click(screen.getByRole("button", { name: "Create Atlas" }));

    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Atlas",
        avatarId: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    expect(await screen.findByText("Meet Atlas")).toBeTruthy();
    // Opened from Soko Bots, not setup: the bot still says hello in its room.
    expect(openNewSokoBotRoom).toHaveBeenCalledWith("bot-1");
  });

  it("creates the bot with the picked picture", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: true,
      value: { id: "bot-1", name: "Atlas", userId: "u1", avatarSeed: null },
    });
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    await user.click(screen.getByRole("button", { name: "owl" }));
    await user.click(screen.getByRole("button", { name: "Create Atlas" }));

    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Atlas",
        avatarId: "owl-1",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
  });

  it("lets the person skip the picture, and the bot gets its orb", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: true,
      value: { id: "bot-1", name: "Atlas", userId: "u1", avatarSeed: null },
    });
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    await user.click(screen.getByRole("button", { name: "owl" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Atlas",
        avatarId: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    expect(await screen.findByText("Meet Atlas")).toBeTruthy();
    expect(screen.getByTestId("orb")).toBeTruthy();
  });
});
