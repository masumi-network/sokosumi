import { act, render, screen } from "@testing-library/react";
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

// Whether the mocked studio reports its first look on mount.
let studioReportsOnMount = true;

vi.mock("./avatar-studio.client", async () => {
  const { useEffect } = await import("react");
  return {
    // Reports a random look on mount, as the real studio does.
    AvatarStudio: ({ onChange }: { onChange: (code: string) => void }) => {
      useEffect(() => {
        if (studioReportsOnMount) onChange("v1-first");
      }, [onChange]);
      return (
        <div data-testid="avatar-studio">
          <button type="button" onClick={() => onChange("v1-owl")}>
            owl look
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
    studioReportsOnMount = true;
    pushMock.mockClear();
    vi.useRealTimers();
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
    // The studio already loads behind the first step.
    expect(await screen.findByTestId("avatar-studio")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Choose a look for Atlas" }),
    ).toBeNull();

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Choose a look for Atlas" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Step 2 of 3" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Atlas");
  });

  it("says a name is needed when it holds only spaces", async () => {
    const user = userEvent.setup();
    renderCreate();
    const input = screen.getByLabelText("Name");

    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Name your Soko Bot" }),
    ).toBeTruthy();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a name.");
    expect(input).toHaveFocus();

    await user.type(input, "Atlas");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("moves focus into each step, since the old step hides the focused control", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    expect(
      screen.getByRole("heading", { name: "Choose a look for Atlas" }),
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
        screen.getByRole("heading", { name: `Choose a look for ${name}` }),
      ).toHaveClass("wrap-anywhere");
    },
  );

  it("locks the studio while the bot is being created", async () => {
    const user = userEvent.setup();
    const created = Promise.withResolvers();
    createMock.mockReturnValue(created.promise);
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const pictures = (await screen.findByTestId("avatar-studio")).closest(
      "fieldset",
    );
    expect(pictures).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Create Atlas" }));
    expect(pictures).toBeDisabled();
    // A create left pending holds every later transition in this worker.
    await act(async () =>
      created.resolve({ ok: false, error: { message: "stopped" } }),
    );
  });

  it("locks Create while it creates", async () => {
    const user = userEvent.setup();
    createMock.mockClear();
    const created = Promise.withResolvers();
    createMock.mockReturnValue(created.promise);
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const createButton = screen.getByRole("button", { name: "Create Atlas" });
    await user.click(createButton);
    await user.click(createButton);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createButton).toHaveAttribute("aria-busy", "true");
    // A create left pending holds every later transition in this worker.
    await act(async () =>
      created.resolve({ ok: false, error: { message: "stopped" } }),
    );
  });

  it("holds Create until the studio has reported a look", async () => {
    const user = userEvent.setup();
    studioReportsOnMount = false;
    createMock.mockClear();
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const createButton = screen.getByRole("button", { name: "Create Atlas" });
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(createMock).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "owl look" }));
    expect(createButton).not.toBeDisabled();
  });

  it("creates the bot with the look picked in the studio", async () => {
    // The reveal holds the transition for 1.5s; run it out before the end.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    createMock.mockResolvedValue({
      ok: true,
      value: {
        id: "bot-1",
        name: "Atlas",
        userId: "u1",
        avatarSeed: null,
        avatarCode: "v1-owl",
        avatarImageUrl: "https://blob.test/o.png",
      },
    });
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    await user.click(await screen.findByRole("button", { name: "owl look" }));
    await user.click(screen.getByRole("button", { name: "Create Atlas" }));

    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Atlas",
        avatarCode: "v1-owl",
        // Its stand-up and wraps run on the browser's clock, not Core's default.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    expect(await screen.findByText("Meet Atlas")).toBeTruthy();
    // Opened from Soko Bots, not setup: the bot still says hello in its room.
    expect(openNewSokoBotRoom).toHaveBeenCalledWith("bot-1");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(pushMock).toHaveBeenCalled();
  });
});
