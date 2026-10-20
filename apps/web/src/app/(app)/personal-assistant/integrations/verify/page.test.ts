import { beforeEach, describe, expect, it, vi } from "vitest";

const completeMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    completeIntegrationAuth: (...a: unknown[]) => completeMock(...a),
  },
}));

import IntegrationVerifyPage from "./page";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

/** The query the Composio callback script sends the tab to. */
async function verify(query: string): Promise<string> {
  const params = Object.fromEntries(new URLSearchParams(query));
  return IntegrationVerifyPage({ searchParams: Promise.resolve(params) }).then(
    () => "no redirect",
    (error: Error) => error.message,
  );
}

describe("IntegrationVerifyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMock.mockResolvedValue({ status: "ACTIVE" });
  });

  it("settles a shared bot's connection and returns to its console", async () => {
    await expect(verify(`session_uri=one-use&botId=${BOT_ID}`)).resolves.toBe(
      `redirect:/soko-bots/${BOT_ID}?integration=active`,
    );
    expect(completeMock).toHaveBeenCalledWith("one-use", BOT_ID);
  });

  it("settles the caller's own bot when no bot id came back", async () => {
    await expect(verify("session_uri=one-use")).resolves.toBe(
      "redirect:/personal-assistant?integration=active",
    );
    expect(completeMock).toHaveBeenCalledWith("one-use", undefined);
  });

  it("settles nothing for a bot id that is not one", async () => {
    await expect(verify("session_uri=one-use&botId=me")).resolves.toBe(
      "redirect:/personal-assistant?integration=error",
    );
    expect(completeMock).not.toHaveBeenCalled();
  });
});
