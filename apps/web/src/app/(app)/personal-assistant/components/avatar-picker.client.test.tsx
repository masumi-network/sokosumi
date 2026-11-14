import type { SokoBotAvatar } from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
      input: { take: 6, excludeIds: [] },
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
      input: { take: 5, excludeIds: [] },
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

  it("says so when Show others has nothing new, and drops the note once new ones come", async () => {
    const user = userEvent.setup();
    topUpMock
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      })
      // Nothing unseen: the picker starts over with the same set.
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({
        ok: true,
        value: avatars("a", "b", "c", "d", "e", "f"),
      })
      .mockResolvedValueOnce({ ok: true, value: avatars("g") });
    renderPicker();
    await screen.findByRole("button", { name: "a" });
    expect(
      screen.getByText("Pick one, or ask for other options."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(
      await screen.findByText(
        "No new pictures right now. Try again in a minute.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show others" }));

    expect(await screen.findByRole("button", { name: "g" })).toBeTruthy();
    expect(
      screen.getByText("Pick one, or ask for other options."),
    ).toBeInTheDocument();
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
