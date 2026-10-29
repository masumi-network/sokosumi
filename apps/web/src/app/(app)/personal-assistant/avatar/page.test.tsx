import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMineMock = vi.fn();
const getAvatarStudioMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: async () => ({ user: {} }),
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: () => getMineMock(),
    getAvatarStudio: () => getAvatarStudioMock(),
  },
}));
vi.mock("../components/avatar-studio.client", () => ({
  AvatarStudio: (props: { botId: string | null; botName: string }) => (
    <div data-testid="studio">{`${props.botId ?? "own"}:${props.botName}`}</div>
  ),
}));

import AvatarStudioPage from "./page";

describe("AvatarStudioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvatarStudioMock.mockResolvedValue({ avatar: null });
  });

  it("opens the studio for the owner of the bot", async () => {
    getMineMock.mockResolvedValue({ name: " Ops ", viewerCanManage: true });
    render(await AvatarStudioPage());
    expect(screen.getByTestId("studio")).toHaveTextContent("own:Ops");
  });

  it("sends someone who cannot manage the bot back to the console", async () => {
    getMineMock.mockResolvedValue({ name: "Ops", viewerCanManage: false });
    await expect(AvatarStudioPage()).rejects.toThrow(
      "redirect:/personal-assistant",
    );
  });

  it("sends someone without a bot back to the console", async () => {
    getMineMock.mockResolvedValue(null);
    await expect(AvatarStudioPage()).rejects.toThrow(
      "redirect:/personal-assistant",
    );
  });

  it("sends the owner back when the studio cannot be read", async () => {
    getMineMock.mockResolvedValue({ name: "Ops", viewerCanManage: true });
    getAvatarStudioMock.mockRejectedValue(new Error("down"));
    await expect(AvatarStudioPage()).rejects.toThrow(
      "redirect:/personal-assistant",
    );
  });
});
