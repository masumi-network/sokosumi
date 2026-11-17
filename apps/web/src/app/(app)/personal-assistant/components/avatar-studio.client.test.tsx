import {
  AVATAR_ANIMALS,
  AVATAR_BACKGROUNDS,
  type AvatarLook,
  featureOptions,
  formatAvatarCode,
  isReadable,
  originalAvatarLook,
  parseAvatarCode,
} from "@sokosumi/soko-bot";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AvatarStudio, AvatarStudioDialog } from "./avatar-studio.client";

const saveMock = vi.fn();
const refreshed = vi.fn();

vi.mock("@/lib/actions/soko-bot/action", () => ({
  setSokoBotAvatarCodeAction: (...args: unknown[]) => saveMock(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The live preview needs WebGL; the studio's job is the look it builds.
vi.mock("@/components/soko-bot/live-bot-avatar.client", () => ({
  default: ({ code }: { code: string }) => (
    <div data-testid="preview" data-code={code} />
  ),
}));

const colours = en.App.SokoBot.AvatarStudio.colours;
const fox = originalAvatarLook("fox");

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  );
}

function lastCode(onChange: ReturnType<typeof vi.fn>): string {
  return onChange.mock.calls.at(-1)?.[0] as string;
}

describe("AvatarStudio", () => {
  it("opens on the code it is given and reports it", () => {
    const onChange = vi.fn();
    render(
      withIntl(
        <AvatarStudio
          initialCode={formatAvatarCode(fox)}
          onChange={onChange}
        />,
      ),
    );
    expect(lastCode(onChange)).toBe(formatAvatarCode(fox));
    expect(screen.getByTestId("preview")).toHaveAttribute(
      "data-code",
      formatAvatarCode(fox),
    );
  });

  it("disables the backgrounds the animal cannot be read on", () => {
    render(
      withIntl(
        <AvatarStudio initialCode={formatAvatarCode(fox)} onChange={vi.fn()} />,
      ),
    );
    const row = within(screen.getByRole("radiogroup", { name: "Background" }));
    let disabled = 0;
    for (const bg of AVATAR_BACKGROUNDS) {
      const readable = isReadable(bg, fox.body, fox.mark);
      const swatch = row.getByRole("radio", { name: colours[bg] });
      expect((swatch as HTMLButtonElement).disabled).toBe(!readable);
      if (!readable) disabled++;
    }
    expect(disabled).toBeGreaterThan(0);
  });

  it("disables the mouths and cheeks an animal's drawing cannot take", async () => {
    const user = userEvent.setup();
    const plain = AVATAR_ANIMALS.find(
      (a) => featureOptions(a).mouth.length === 1,
    );
    expect(plain).toBeTruthy();
    render(
      withIntl(
        <AvatarStudio initialCode={formatAvatarCode(fox)} onChange={vi.fn()} />,
      ),
    );
    await user.click(
      screen.getByRole("button", {
        name: en.App.SokoBot.AvatarStudio.animals[
          plain as keyof typeof en.App.SokoBot.AvatarStudio.animals
        ],
      }),
    );
    const mouth = within(screen.getByRole("group", { name: "Mouth" }));
    expect(mouth.getByRole("radio", { name: "Smile" })).toBeDisabled();
    expect(mouth.getByRole("radio", { name: "Original" })).toBeEnabled();
  });

  it("shuffles to another valid look", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      withIntl(
        <AvatarStudio
          initialCode={formatAvatarCode(fox)}
          onChange={onChange}
        />,
      ),
    );
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole("button", { name: "Shuffle" }));
      const code = lastCode(onChange);
      expect(parseAvatarCode(code)).not.toBeNull();
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("changes the preview state without touching the look", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      withIntl(
        <AvatarStudio
          initialCode={formatAvatarCode(fox)}
          onChange={onChange}
        />,
      ),
    );
    const calls = onChange.mock.calls.length;
    await user.click(screen.getByRole("radio", { name: "Sleeping" }));
    expect(onChange.mock.calls.length).toBe(calls);
  });
});

describe("AvatarStudioDialog", () => {
  function open(initial: AvatarLook = fox) {
    const user = userEvent.setup();
    render(
      withIntl(
        <AvatarStudioDialog
          open
          onOpenChange={vi.fn()}
          initialCode={formatAvatarCode(initial)}
          botId="bot-9"
          onSaved={refreshed}
        />,
      ),
    );
    return user;
  }

  it("holds Save until the look changes, then sends the formatted code for that bot", async () => {
    saveMock.mockResolvedValue({
      ok: true,
      value: { avatarCode: "x", avatarImageUrl: "y" },
    });
    const user = open();
    const save = screen.getByRole("button", { name: "Save look" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(save).toBeEnabled();
    const sent = screen
      .getByTestId("preview")
      .getAttribute("data-code") as string;
    await user.click(save);
    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({ code: sent, botId: "bot-9" }),
    );
    expect(parseAvatarCode(sent)).not.toBeNull();
    await waitFor(() => expect(refreshed).toHaveBeenCalled());
  });

  it("closes at once on save, without waiting on the console's own refresh", async () => {
    saveMock.mockResolvedValue({
      ok: true,
      value: { avatarCode: "x", avatarImageUrl: "y" },
    });
    // The console's own refresh can be slow on a cold preview; closing must not wait on it.
    let finish = () => {};
    const slowRefresh = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      withIntl(
        <AvatarStudioDialog
          open
          onOpenChange={onOpenChange}
          initialCode={formatAvatarCode(fox)}
          onSaved={slowRefresh}
        />,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    await user.click(screen.getByRole("button", { name: "Save look" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(slowRefresh).toHaveBeenCalled();
    await act(async () => finish());
  });

  it("says the look is taken, inline, and clears it on the next change", async () => {
    saveMock.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", kind: "avatar_code_taken" },
    });
    const user = open();
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    await user.click(screen.getByRole("button", { name: "Save look" }));
    expect(
      await screen.findByText(
        "That look is taken. Change one thing or shuffle.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(screen.queryByText(/That look is taken/)).toBeNull();
  });
});
