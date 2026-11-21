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

vi.mock("./avatar-studio.client", () => ({
  AvatarStudio: ({
    code,
    onChange,
    compact,
  }: {
    code: string | null;
    onChange: (code: string) => void;
    compact?: boolean;
  }) => (
    <div
      data-testid="avatar-studio"
      data-compact={String(!!compact)}
      data-code={code ?? ""}
    >
      <button type="button" onClick={() => onChange("v1-owl")}>
        owl look
      </button>
    </div>
  ),
}));

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
    // Setup shows the short studio; the full one is in the Change-look dialog.
    expect(screen.getByTestId("avatar-studio")).toHaveAttribute(
      "data-compact",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Atlas");
  });

  it("keeps Back beside Create in the pinned bar on the picture step", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");

    const back = screen.getByRole("button", { name: "Back" });
    const create = screen.getByRole("button", { name: "Create Atlas" });
    // One pinned row: Back stays on screen while the pictures scroll.
    expect(back.parentElement).toBe(create.parentElement);
    expect(back.parentElement?.className).toContain("sticky");
  });

  it("says a name is needed in the page, not a browser bubble, when it is empty", async () => {
    const user = userEvent.setup();
    renderCreate();
    const input = screen.getByLabelText("Name");

    // Without `noValidate` the browser blocks the submit with its own bubble first.
    expect(input).toBeRequired();
    expect(input.closest("form")).toHaveAttribute("novalidate");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a name.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(input).toHaveFocus();
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

  it("picks an initial avatar code when entering the picture step", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(await screen.findByTestId("avatar-studio")).toHaveAttribute(
      "data-code",
      "",
    );
    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    const studio = await screen.findByTestId("avatar-studio");
    expect(studio.getAttribute("data-code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Atlas" })).toBeEnabled();
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

  it("keeps Create disabled over the Avatar Studio loading placeholder until the preview mounts", async () => {
    const user = userEvent.setup();
    vi.resetModules();
    const loadGate = Promise.withResolvers<void>();
    vi.doMock("next/dynamic", async () => {
      const React = await import("react");
      return {
        default: (
          loader: () => Promise<{ default: React.ComponentType<unknown> }>,
          options?: { loading?: () => React.ReactNode },
        ) => {
          return function DeferredDynamic(props: Record<string, unknown>) {
            const [Loaded, setLoaded] = React.useState<{
              Comp: React.ComponentType<Record<string, unknown>>;
            } | null>(null);
            React.useEffect(() => {
              let cancelled = false;
              void loadGate.promise
                .then(() => loader())
                .then((mod) => {
                  if (!cancelled) {
                    setLoaded({
                      Comp: mod.default as React.ComponentType<
                        Record<string, unknown>
                      >,
                    });
                  }
                });
              return () => {
                cancelled = true;
              };
            }, []);
            if (!Loaded) {
              return options?.loading ? options.loading() : null;
            }
            const Comp = Loaded.Comp;
            return React.createElement(Comp, props);
          };
        },
      };
    });
    const { CreateState: DeferredCreateState } = await import(
      "./create-state.client"
    );
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DeferredCreateState paidByOrganization={false} />
      </NextIntlClientProvider>,
    );

    await user.type(screen.getByLabelText("Name"), "Atlas{Enter}");
    expect(screen.queryByTestId("avatar-studio")).toBeNull();
    expect(screen.getByRole("button", { name: "Create Atlas" })).toBeDisabled();

    await act(async () => {
      loadGate.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByTestId("avatar-studio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Atlas" })).toBeEnabled();
    vi.doUnmock("next/dynamic");
  });
});
