import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatStateMock = vi.fn();
const consoleMock = vi.fn();

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: async () => ({ user: { name: "Ada", image: null } }),
}));
vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class extends Error {},
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getActiveOrganizationId: async () => null },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getChatState: () => chatStateMock(),
    getStats: async () => null,
    getMyUsage: async () => null,
    listIntegrations: async () => null,
    searchIntegrationCatalog: async () => [],
  },
}));
vi.mock("./components/console/console.client", () => ({
  SokoBotConsole: (props: { canManage: boolean }) => {
    consoleMock(props);
    return null;
  },
}));
vi.mock("./components/create-state.client", () => ({
  CreateState: () => null,
}));

import SokoBotPage from "./page";

async function renderWith(viewerCanManage: boolean): Promise<void> {
  chatStateMock.mockResolvedValue({
    bot: { id: "bot-1", versionId: null, viewerCanManage },
  });
  render(await SokoBotPage({ searchParams: Promise.resolve({}) }));
}

describe("SokoBotPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])(
    "passes Core's viewerCanManage (%s) to the console of the caller's own bot",
    async (viewerCanManage) => {
      await renderWith(viewerCanManage);
      expect(consoleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          botId: null,
          canManage: viewerCanManage,
          sharedRoomId: null,
        }),
      );
    },
  );
});
