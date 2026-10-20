// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
vi.mock("@/lib/actions/soko-bot/action", () => ({
  connectSokoBotIntegrationAction: (...a: unknown[]) => connectMock(...a),
}));

import { COMPOSIO_BOT_ID_STORAGE_KEY } from "@/lib/composio/oauth-popup-protocol";
import { startSokoBotConnect } from "../start-integration-connect";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

describe("startSokoBotConnect", () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.stubGlobal("location", { origin: "https://app.test", assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a shared bot for the callback and leaves for Composio", async () => {
    connectMock.mockResolvedValue({ ok: true, value: { redirectUrl: "r" } });
    await expect(startSokoBotConnect("gmail", BOT_ID)).resolves.toBeNull();
    expect(connectMock).toHaveBeenCalledWith({
      provider: "gmail",
      returnUrl: `https://app.test/personal-assistant/integrations/return?provider=gmail&botId=${BOT_ID}`,
      botId: BOT_ID,
    });
    expect(window.sessionStorage.getItem(COMPOSIO_BOT_ID_STORAGE_KEY)).toBe(
      BOT_ID,
    );
    expect(assign).toHaveBeenCalledWith("r");
  });

  it("stays in the tab and returns Core's refusal", async () => {
    const error = { code: "FORBIDDEN", message: "no" };
    connectMock.mockResolvedValue({ ok: false, error });
    await expect(startSokoBotConnect("gmail", BOT_ID)).resolves.toBe(error);
    expect(assign).not.toHaveBeenCalled();
  });
});
