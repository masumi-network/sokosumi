import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reactivateMock, refreshMock, toastMock } = vi.hoisted(() => ({
  reactivateMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  reactivateSokoBotAction: reactivateMock,
}));

import { ReactivateSharedBotButton } from "./reactivate-shared-bot-button.client";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

describe("ReactivateSharedBotButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reactivates the bot and refreshes the page", async () => {
    reactivateMock.mockResolvedValue({ ok: true, value: undefined });
    render(<ReactivateSharedBotButton botId={BOT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "reactivate" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(reactivateMock).toHaveBeenCalledWith({ botId: BOT_ID });
    expect(toastMock.success).toHaveBeenCalledWith("reactivated");
  });

  it("keeps the page and shows Core's reason when it refuses", async () => {
    reactivateMock.mockResolvedValue({
      ok: false,
      error: { message: "The Project is closing." },
    });
    render(<ReactivateSharedBotButton botId={BOT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "reactivate" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("The Project is closing."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
