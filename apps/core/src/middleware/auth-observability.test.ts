import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotAuthenticationContext } from "./auth";
import { syncAuthObservers } from "./auth-observability";

const { attachAuthToLoggerMock, setContextMock, setUserMock } = vi.hoisted(
  () => ({
    attachAuthToLoggerMock: vi.fn(),
    setContextMock: vi.fn(),
    setUserMock: vi.fn(),
  }),
);

vi.mock("@sentry/node", () => ({
  getCurrentScope: () => ({ setUser: setUserMock, setContext: setContextMock }),
}));

vi.mock("@/lib/evlog", () => ({
  attachAuthToLogger: attachAuthToLoggerMock,
}));

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";

describe("syncAuthObservers for Soko Bots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the owner of a personal bot", () => {
    const authContext: SokoBotAuthenticationContext = {
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: BOT_ID,
      userId: "user_123",
      workspaceId: WORKSPACE_ID,
      organizationId: null,
    };

    syncAuthObservers({ isAuthenticated: true, authContext });

    expect(setUserMock).toHaveBeenCalledWith({
      id: `sokoBot:${BOT_ID}`,
      sokoBotId: BOT_ID,
    });
    expect(setContextMock).toHaveBeenCalledWith("sokoBotContext", {
      scope: "personal",
      userId: "user_123",
      organizationId: null,
      workspaceId: WORKSPACE_ID,
    });
    expect(attachAuthToLoggerMock).toHaveBeenCalledWith({
      actor: "sokoBot",
      sokoBotId: BOT_ID,
      contextUserId: "user_123",
      contextOrganizationId: null,
    });
  });

  it("records a shared bot with no user", () => {
    const authContext: SokoBotAuthenticationContext = {
      actor: "sokoBot",
      scope: "workspace",
      sokoBotId: BOT_ID,
      userId: null,
      workspaceId: WORKSPACE_ID,
      organizationId: "org_1",
      projectId: null,
    };

    syncAuthObservers({ isAuthenticated: true, authContext });

    expect(setContextMock).toHaveBeenCalledWith("sokoBotContext", {
      scope: "workspace",
      userId: null,
      organizationId: "org_1",
      workspaceId: WORKSPACE_ID,
    });
    expect(attachAuthToLoggerMock).toHaveBeenCalledWith({
      actor: "sokoBot",
      sokoBotId: BOT_ID,
      contextUserId: undefined,
      contextOrganizationId: "org_1",
    });
  });
});
