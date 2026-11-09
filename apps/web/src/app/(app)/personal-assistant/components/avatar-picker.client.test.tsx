import type { SokoBotAvatar } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AvatarPicker } from "./avatar-picker.client";

const topUpMock = vi.fn();

vi.mock("@/lib/actions/soko-bot/action", () => ({
  topUpSokoBotAvatarsAction: (...args: unknown[]) => topUpMock(...args),
}));

function avatars(...subjects: string[]): SokoBotAvatar[] {
  return subjects.map(
    (subject) =>
      ({
        id: subject,
        subject,
        imageUrl: `https://example.com/${subject}.webp`,
      }) as SokoBotAvatar,
  );
}

function Harness({ currentImageUrl }: { currentImageUrl?: string }) {
  const [picked, setPicked] = useState<SokoBotAvatar | null>(null);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <AvatarPicker
        value={picked?.id ?? null}
        onChange={setPicked}
        currentImageUrl={currentImageUrl}
      />
      <span data-testid="picked">{picked?.id ?? "current"}</span>
    </NextIntlClientProvider>
  );
}

function pressed(name: string) {
  return screen.getByRole("button", { name }).getAttribute("aria-pressed");
}

function renderPicker() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AvatarPicker value={null} onChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("AvatarPicker", () => {
  beforeEach(() => {
    topUpMock.mockReset();
  });

  it("does not show Show others as busy while the first set loads", async () => {
    let resolveFirstSet: (value: unknown) => void = () => {};
    topUpMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFirstSet = resolve;
      }),
    );
    renderPicker();

    const showOthers = screen.getByRole("button", { name: "Show others" });
    expect(showOthers).toBeDisabled();
    expect(showOthers).not.toHaveAttribute("aria-busy");
    // A transition left pending would hold back the next tests' updates.
    await act(async () => resolveFirstSet({ ok: true, value: [] }));
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

  it("keeps the pick on screen after showing others", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("frog", "owl") })
      .mockResolvedValueOnce({ ok: true, value: avatars("otter", "hedgehog") });
    render(<Harness />);

    await waitFor(() => expect(pressed("frog")).toBe("true"));

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() => expect(pressed("otter")).toBe("true"));
    expect(screen.getByTestId("picked").textContent).toBe("otter");
  });

  it("falls back to the bot's current picture when the pick leaves", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("frog", "owl") })
      .mockResolvedValueOnce({ ok: true, value: avatars("otter", "hedgehog") });
    render(<Harness currentImageUrl="https://example.com/mine.webp" />);

    const owl = await screen.findByRole("button", { name: "owl" });
    expect(pressed("Current picture")).toBe("true");
    await user.click(owl);
    expect(pressed("owl")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() => expect(pressed("Current picture")).toBe("true"));
    expect(screen.queryByRole("button", { name: "owl" })).toBeNull();
  });

  it("offers six avatars at once", async () => {
    topUpMock.mockResolvedValue({
      ok: true,
      value: avatars("a", "b", "c", "d", "e", "f"),
    });
    renderPicker();

    expect(await screen.findByRole("button", { name: "f" })).toBeTruthy();
    expect(topUpMock).toHaveBeenCalledWith({
      input: { take: 6, excludeIds: [] },
    });
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("shows six others on Show others, never the ones already seen", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("g", "h", "i", "j", "k", "l"),
      });
    renderPicker();
    await screen.findByRole("button", { name: "a" });

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(await screen.findByRole("button", { name: "l" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "a" })).toBeNull();
    expect(topUpMock).toHaveBeenLastCalledWith({
      input: {
        take: 6,
        excludeIds: expect.arrayContaining(["a", "b", "c", "d", "e", "f"]),
      },
    });
  });

  it("shows the pictures as loading while new ones are drawn", async () => {
    let resolveFirstSet: (value: unknown) => void = () => {};
    topUpMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFirstSet = resolve;
      }),
    );
    renderPicker();

    expect(screen.getByRole("group", { name: "Pictures" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await act(async () => resolveFirstSet({ ok: true, value: avatars("a") }));
    expect(screen.getByRole("group", { name: "Pictures" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
});
