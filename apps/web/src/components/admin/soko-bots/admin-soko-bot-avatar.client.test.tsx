import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSokoBotAvatar } from "./admin-soko-bot-avatar.client";

const refreshMock = vi.fn();
const setAvatarMock = vi.fn();
const topUpAvatarsMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccessMock(...a),
    error: (...a: unknown[]) => toastErrorMock(...a),
  },
}));
// Only the server actions are replaced; the picker is the real one.
vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  setAdminSokoBotAvatarAction: (...a: unknown[]) => setAvatarMock(...a),
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  topUpSokoBotAvatarsAction: (...a: unknown[]) => topUpAvatarsMock(...a),
}));

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";
const OWL = {
  id: "avatar-1",
  imageUrl: "https://blob/avatar-1.webp",
  subject: "owl",
  background: "gently muted sage green",
};
const FOX = {
  id: "avatar-7",
  imageUrl: "https://blob/avatar-7.webp",
  subject: "fox",
  background: "gently muted peach",
};

/** Render, wait for the pool, and pick the fox. */
async function pickFox() {
  render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);
  const fox = await screen.findByRole("button", { name: "fox" });
  fireEvent.click(fox);
  expect(fox).toHaveAttribute("aria-pressed", "true");
}

describe("AdminSokoBotAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    topUpAvatarsMock.mockResolvedValue({ ok: true, value: [OWL, FOX] });
  });

  it("offers nothing to apply until the pool has loaded", async () => {
    let resolvePool: (value: unknown) => void = () => {};
    topUpAvatarsMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePool = resolve;
      }),
    );
    render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);

    expect(screen.getByRole("button", { name: "apply" })).toBeDisabled();
    // A transition left pending would hold back the next tests' updates.
    await act(async () => resolvePool({ ok: true, value: [] }));
  });

  it("sets the picked avatar on the bot and shows it", async () => {
    setAvatarMock.mockResolvedValue({ ok: true });
    await pickFox();

    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("done"));
    expect(setAvatarMock).toHaveBeenCalledWith({
      input: { sokoBotId: BOT_ID, avatarId: FOX.id },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reports a failed change and keeps the bot as it was", async () => {
    setAvatarMock.mockResolvedValue({
      ok: false,
      error: { message: "That picture is taken." },
    });
    await pickFox();

    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("That picture is taken."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "fox" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers no way to the avatar studio", async () => {
    render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);
    await screen.findByRole("button", { name: "fox" });
    expect(screen.queryByRole("link")).toBeNull();
  });
});
