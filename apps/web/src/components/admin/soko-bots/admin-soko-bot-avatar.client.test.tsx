import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSokoBotAvatar } from "./admin-soko-bot-avatar.client";

const refreshMock = vi.fn();
const setAvatarMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastErrorMock(...a) },
}));
vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  setAdminSokoBotAvatarAction: (...a: unknown[]) => setAvatarMock(...a),
}));
vi.mock("@/app/personal-assistant/components/avatar-picker.client", () => ({
  AvatarPicker: ({
    onChange,
  }: {
    onChange: (avatar: { id: string; imageUrl: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({ id: "avatar-7", imageUrl: "https://blob/avatar-7.png" })
      }
    >
      pick avatar-7
    </button>
  ),
}));

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

describe("AdminSokoBotAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the picked avatar on the bot and shows it", async () => {
    setAvatarMock.mockResolvedValue({ ok: true });
    render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);

    expect(screen.getByRole("button", { name: "apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "pick avatar-7" }));
    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(setAvatarMock).toHaveBeenCalledWith({
      input: { sokoBotId: BOT_ID, avatarId: "avatar-7" },
    });
  });

  it("reports a failed change and keeps the bot as it was", async () => {
    setAvatarMock.mockResolvedValue({
      ok: false,
      error: { message: "That picture is taken." },
    });
    render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);

    fireEvent.click(screen.getByRole("button", { name: "pick avatar-7" }));
    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("That picture is taken."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("offers no way to the avatar studio", () => {
    render(<AdminSokoBotAvatar sokoBotId={BOT_ID} currentImageUrl={null} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
