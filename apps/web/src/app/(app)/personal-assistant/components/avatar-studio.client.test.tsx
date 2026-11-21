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
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SETUP_ASSISTANT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { pickMessages } from "@/i18n/pick-messages";
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

function ControlledStudio({
  initialCode,
  onChange,
  compact,
}: {
  initialCode: string;
  onChange?: (code: string) => void;
  compact?: boolean;
}) {
  const [code, setCode] = useState(initialCode);
  return (
    <AvatarStudio
      code={code}
      compact={compact}
      onChange={(next) => {
        setCode(next);
        onChange?.(next);
      }}
    />
  );
}

describe("AvatarStudio", () => {
  it("names every control with setup's messages, not raw keys", () => {
    // `/setup/assistant` hands the client only its own bag; a key outside it
    // shows as `App.SokoBot.AvatarStudio.states.idle` and widens the phone page.
    render(
      <NextIntlClientProvider
        locale="en"
        messages={pickMessages(en, SETUP_ASSISTANT_MESSAGE_PATHS)}
        onError={() => {}}
      >
        <AvatarStudio code={formatAvatarCode(fox)} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("radio", { name: "Idle" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("App.SokoBot");
  });

  it("opens on the code it is given without firing onChange until edited", () => {
    const onChange = vi.fn();
    render(
      withIntl(
        <AvatarStudio code={formatAvatarCode(fox)} onChange={onChange} />,
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toHaveAttribute(
      "data-code",
      formatAvatarCode(fox),
    );
  });

  it("disables the backgrounds the animal cannot be read on", () => {
    render(
      withIntl(
        <AvatarStudio code={formatAvatarCode(fox)} onChange={vi.fn()} />,
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
    render(withIntl(<ControlledStudio initialCode={formatAvatarCode(fox)} />));
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
        <ControlledStudio
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

  it("in setup shows the preview, Shuffle and animals first, the rest under More details", async () => {
    const user = userEvent.setup();
    render(
      withIntl(
        <AvatarStudio
          compact
          code={formatAvatarCode(fox)}
          onChange={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId("preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Owl" })).toBeTruthy();
    // Preview states belong to the Change-look dialog, not setup.
    expect(
      screen.queryByRole("radiogroup", { name: "Preview state" }),
    ).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Background" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /More details/ }));
    expect(
      screen.getByRole("radiogroup", { name: "Background" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Headwear" })).toBeTruthy();
    expect(
      screen.queryByRole("radiogroup", { name: "Preview state" }),
    ).toBeNull();
  });

  it("changes the preview state without touching the look", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      withIntl(
        <AvatarStudio code={formatAvatarCode(fox)} onChange={onChange} />,
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
