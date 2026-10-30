import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSharedMock = vi.fn();
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
    listShared: () => listSharedMock(),
    getAvatarStudio: (...a: unknown[]) => getAvatarStudioMock(...a),
  },
}));
vi.mock("@/app/personal-assistant/components/avatar-studio.client", () => ({
  AvatarStudio: (props: { botId: string | null; botName: string }) => (
    <div data-testid="studio">{`${props.botId}:${props.botName}`}</div>
  ),
}));

import SharedAvatarStudioPage from "./page";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: BOT_ID,
    name: "Ops",
    viewerCanManage: true,
    archivedAt: null,
    ...overrides,
  };
}

async function page() {
  return SharedAvatarStudioPage({ params: Promise.resolve({ id: BOT_ID }) });
}

describe("SharedAvatarStudioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvatarStudioMock.mockResolvedValue({ avatar: null });
  });

  it("opens the studio for a manager of the shared bot", async () => {
    listSharedMock.mockResolvedValue([summary()]);
    render(await page());
    expect(screen.getByTestId("studio")).toHaveTextContent(`${BOT_ID}:Ops`);
    expect(getAvatarStudioMock).toHaveBeenCalledWith(BOT_ID);
  });

  it("sends a member who cannot manage the bot to its console", async () => {
    listSharedMock.mockResolvedValue([summary({ viewerCanManage: false })]);
    await expect(page()).rejects.toThrow(`redirect:/soko-bots/${BOT_ID}`);
    expect(getAvatarStudioMock).not.toHaveBeenCalled();
  });

  it("sends the manager of an archived bot to its console", async () => {
    listSharedMock.mockResolvedValue([summary({ archivedAt: new Date() })]);
    await expect(page()).rejects.toThrow(`redirect:/soko-bots/${BOT_ID}`);
  });

  it("sends an unknown bot to the assistant page", async () => {
    listSharedMock.mockResolvedValue([]);
    await expect(page()).rejects.toThrow("redirect:/personal-assistant");
  });
});
