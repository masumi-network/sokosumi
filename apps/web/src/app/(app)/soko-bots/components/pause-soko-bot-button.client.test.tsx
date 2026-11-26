import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMock, toastMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  updateSokoBotProactiveAction: updateMock,
}));

import { PauseSokoBotButton } from "./pause-soko-bot-button.client";

describe("PauseSokoBotButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pauses a shared bot by id", async () => {
    updateMock.mockResolvedValue({ ok: true, value: {} });
    render(<PauseSokoBotButton botId="atlas" name="Atlas" paused={false} />);
    fireEvent.click(screen.getByRole("button", { name: "pauseName" }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("pausedToast"),
    );
    expect(updateMock).toHaveBeenCalledWith({
      input: { paused: true },
      botId: "atlas",
    });
  });

  it("resumes your own bot without an id", async () => {
    updateMock.mockResolvedValue({ ok: true, value: {} });
    render(<PauseSokoBotButton botId={null} name="Juno" paused />);
    fireEvent.click(screen.getByRole("button", { name: "resumeName" }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        input: { paused: false },
        botId: undefined,
      }),
    );
  });

  it("says so when Core refuses", async () => {
    updateMock.mockResolvedValue({ ok: false, error: { message: "no" } });
    render(<PauseSokoBotButton botId="atlas" name="Atlas" paused={false} />);
    fireEvent.click(screen.getByRole("button", { name: "pauseName" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("pauseError"),
    );
  });
});
