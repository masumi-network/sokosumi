import type { SokoBotAvatar } from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AvatarPicker } from "./avatar-picker.client";

const topUpMock = vi.fn();
const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

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
    toastErrorMock.mockReset();
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
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("otter", "hedgehog", "c", "d", "e", "f"),
      });
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
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("otter", "hedgehog", "c", "d", "e"),
      });
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
      input: { take: 6, excludeIds: [], fresh: false },
    });
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("fills one row with the current picture and five others", async () => {
    topUpMock.mockResolvedValue({
      ok: true,
      value: avatars("a", "b", "c", "d", "e"),
    });
    render(<Harness currentImageUrl="https://example.com/mine.webp" />);

    expect(await screen.findByRole("button", { name: "e" })).toBeTruthy();
    expect(topUpMock).toHaveBeenCalledWith({
      input: { take: 5, excludeIds: [], fresh: false },
    });
    expect(
      within(screen.getByRole("group", { name: "Pictures" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(6);
  });

  it("shows a saved pick once, as the current picture, with a fresh set beside it", async () => {
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e"),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("f", "g", "h", "i", "j"),
      });
    const view = render(
      <Harness currentImageUrl="https://example.com/mine.webp" />,
    );
    expect(await screen.findByRole("button", { name: "b" })).toBeTruthy();

    // Saving "b" makes it the bot's picture.
    view.rerender(<Harness currentImageUrl="https://example.com/b.webp" />);

    expect(await screen.findByRole("button", { name: "j" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "b" })).toBeNull();
    const group = within(screen.getByRole("group", { name: "Pictures" }));
    expect(
      group.getAllByRole("button", { name: "Current picture" }),
    ).toHaveLength(1);
    expect(group.getAllByRole("button")).toHaveLength(6);
  });

  it("asks Core to draw a new set on Show others and shows only that set", async () => {
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
      input: { take: 6, excludeIds: [], fresh: true },
    });
  });

  it("fills a short refresh with avatars seen before, most recent first", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      })
      .mockResolvedValueOnce({ ok: true, value: avatars("g", "h") });
    renderPicker();
    await screen.findByRole("button", { name: "a" });

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(await screen.findByRole("button", { name: "h" })).toBeTruthy();
    const names = within(screen.getByRole("group", { name: "Pictures" }))
      .getAllByRole("button")
      .map((tile) => tile.getAttribute("aria-label"));
    expect(names).toEqual(["g", "h", "f", "e", "d", "c"]);
  });

  it("keeps the set and the pick when Show others brings nothing new, and lets the user retry", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      })
      // The draw failed or another one is still running.
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: avatars("g") });
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "c" }));
    expect(
      screen.getByText("Pick one, or ask for other options."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(
      await screen.findByText(
        "No new pictures right now. Try again in a minute.",
      ),
    ).toBeInTheDocument();
    expect(pressed("c")).toBe("true");
    expect(topUpMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(await screen.findByRole("button", { name: "g" })).toBeTruthy();
    expect(
      screen.getByText("Pick one, or ask for other options."),
    ).toBeInTheDocument();
  });

  it("keeps the set and the pick when Show others fails", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("a", "b") })
      .mockResolvedValueOnce({ ok: false, error: { code: "UNKNOWN" } });
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "b" }));

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() => expect(pressed("b")).toBe("true"));
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show others" })).toBeEnabled();
  });

  it("says new pictures are being drawn while Show others waits", async () => {
    const user = userEvent.setup();
    let resolveRefresh: (value: unknown) => void = () => {};
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("a") })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
    renderPicker();
    await screen.findByRole("button", { name: "a" });

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(
      screen.getByText("Drawing new pictures. This can take a minute."),
    ).toBeInTheDocument();
    // One request at a time: the busy button cannot start a second draw.
    await user.click(screen.getByRole("button", { name: "Show others" }));
    expect(topUpMock).toHaveBeenCalledTimes(2);
    await act(async () => resolveRefresh({ ok: true, value: avatars("b") }));
  });

  it("stops Show others after four sets of new pictures", async () => {
    const user = userEvent.setup();
    topUpMock.mockResolvedValueOnce({ ok: true, value: avatars("a") });
    for (const subject of ["b", "c", "d", "e"]) {
      topUpMock.mockResolvedValueOnce({ ok: true, value: avatars(subject) });
    }
    renderPicker();
    await screen.findByRole("button", { name: "a" });

    for (const subject of ["b", "c", "d", "e"]) {
      await user.click(screen.getByRole("button", { name: "Show others" }));
      await screen.findByRole("button", { name: subject });
    }

    expect(screen.getByRole("button", { name: "Show others" })).toBeDisabled();
    expect(
      screen.getByText("That is all the new pictures for now. Pick one above."),
    ).toBeInTheDocument();
    expect(topUpMock).toHaveBeenCalledTimes(5);
  });

  it("counts a try that drew nothing, since it may have been billed", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("a") })
      // Two empty answers (the image was bought, storing it failed) and two
      // failures: four tries spent.
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: false, error: { code: "UNKNOWN" } })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: false, error: { code: "UNKNOWN" } });
    render(<Harness />);
    await screen.findByRole("button", { name: "a" });

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "Show others" }));
      await waitFor(() => expect(topUpMock).toHaveBeenCalledTimes(i + 2));
    }

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show others" }),
      ).toBeDisabled(),
    );
    expect(pressed("a")).toBe("true");
    // No "try again" once the tries are spent.
    expect(
      screen.getByText("That is all the new pictures for now. Pick one above."),
    ).toBeInTheDocument();
    expect(topUpMock).toHaveBeenCalledTimes(5);
  });

  it("keeps the set and pick, and says so, when the request itself fails", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("a", "b") })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "b" }));

    await user.click(screen.getByRole("button", { name: "Show others" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not load pictures."),
    );
    expect(pressed("b")).toBe("true");
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show others" })).toBeEnabled();
  });

  it("stops after four tries mixing lost requests, empty sets and errors", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({ ok: true, value: avatars("a") })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: false, error: { code: "UNKNOWN" } })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Harness />);
    await screen.findByRole("button", { name: "a" });

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "Show others" }));
      await waitFor(() => expect(topUpMock).toHaveBeenCalledTimes(i + 2));
    }

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show others" }),
      ).toBeDisabled(),
    );
    expect(pressed("a")).toBe("true");
    expect(topUpMock).toHaveBeenCalledTimes(5);
  });

  it("gives a free retry when Core drew nothing", async () => {
    const user = userEvent.setup();
    topUpMock.mockResolvedValueOnce({ ok: true, value: avatars("a") });
    for (const code of [
      "SOKO_BOT_AVATAR_DRAW_BUSY",
      "SOKO_BOT_AVATAR_RATE_LIMITED",
      "SOKO_BOT_AVATAR_UNAVAILABLE",
      "SOKO_BOT_AVATAR_DRAW_BUSY",
    ]) {
      topUpMock.mockResolvedValueOnce({ ok: false, error: { code } });
    }
    topUpMock.mockResolvedValueOnce({ ok: true, value: avatars("b") });
    render(<Harness />);
    await screen.findByRole("button", { name: "a" });

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "Show others" }));
      await waitFor(() => expect(topUpMock).toHaveBeenCalledTimes(i + 2));
    }
    expect(
      await screen.findByText(
        "No new pictures right now. Try again in a minute.",
      ),
    ).toBeInTheDocument();

    // Four no-work answers spent no try: a fifth press still draws.
    await user.click(screen.getByRole("button", { name: "Show others" }));
    expect(await screen.findByRole("button", { name: "b" })).toBeTruthy();
  });

  it("shows only skeletons, and nothing to pick, while others load", async () => {
    const user = userEvent.setup();
    const onLoadingChange = vi.fn();
    let resolveRefresh: (value: unknown) => void = () => {};
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e"),
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AvatarPicker
          value={null}
          onChange={vi.fn()}
          currentImageUrl="https://example.com/mine.webp"
          onLoadingChange={onLoadingChange}
        />
      </NextIntlClientProvider>,
    );
    await screen.findByRole("button", { name: "a" });
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Show others" }));

    const group = screen.getByRole("group", { name: "Pictures" });
    // Busy, with no tile left to pick; the skeletons stand in for them.
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);

    await act(async () =>
      resolveRefresh({ ok: true, value: avatars("f", "g", "h", "i", "j") }),
    );

    expect(group).toHaveAttribute("aria-busy", "false");
    expect(within(group).getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "j" })).toBeTruthy();
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("does not release saving for a set that lands after the picker closed", async () => {
    let resolveFirstSet: (value: unknown) => void = () => {};
    topUpMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFirstSet = resolve;
      }),
    );
    const onLoadingChange = vi.fn();
    const view = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AvatarPicker
          value={null}
          onChange={vi.fn()}
          onLoadingChange={onLoadingChange}
        />
      </NextIntlClientProvider>,
    );
    // Closing the dialog unmounts the picker while its set is still coming.
    view.unmount();
    onLoadingChange.mockClear();

    await act(async () => {
      resolveFirstSet({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      });
    });

    // A reopened picker owns the loading state now; a late set must not end it.
    expect(onLoadingChange).not.toHaveBeenCalledWith(false);
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
