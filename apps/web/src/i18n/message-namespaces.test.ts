import { describe, expect, it } from "vitest";

import {
  ADMIN_MESSAGE_PATHS,
  APP_MESSAGE_PATHS,
  APP_SHELL_MESSAGE_PATHS,
  AUTH_MESSAGE_PATHS,
  SOKO_BOT_MESSAGE_PATHS,
} from "@/i18n/message-namespaces";

describe("message namespaces", () => {
  it("includes DesignMd on the auth bag so the setup wizard can generate brand copy", () => {
    expect(AUTH_MESSAGE_PATHS).toContain("App.DesignMd");
    expect(AUTH_MESSAGE_PATHS).toContain("Components");
    expect(AUTH_MESSAGE_PATHS).toContain("WorkspaceGate");
  });

  it("excludes SokoBot and Admin from the default APP bag", () => {
    expect(APP_MESSAGE_PATHS).not.toContain("App.SokoBot");
    expect(APP_MESSAGE_PATHS).not.toContain("App.Admin");
    expect(APP_MESSAGE_PATHS).toContain("App.Account");
    expect(APP_MESSAGE_PATHS).toContain("App.Tasks");
    expect(APP_MESSAGE_PATHS).toContain("Components");
    expect(APP_MESSAGE_PATHS).toContain("WorkspaceGate");
  });

  it("includes WorkspaceGate on app chrome bags for the switcher create dialog", () => {
    expect(APP_SHELL_MESSAGE_PATHS).toContain("WorkspaceGate");
    expect(SOKO_BOT_MESSAGE_PATHS).toContain("WorkspaceGate");
    expect(ADMIN_MESSAGE_PATHS).toContain("WorkspaceGate");
  });

  it("builds Soko Bot bag from APP_SHELL + App.SokoBot", () => {
    for (const path of APP_SHELL_MESSAGE_PATHS) {
      expect(SOKO_BOT_MESSAGE_PATHS).toContain(path);
    }
    expect(SOKO_BOT_MESSAGE_PATHS).toContain("App.SokoBot");
    expect(SOKO_BOT_MESSAGE_PATHS).not.toContain("App.Admin");
  });

  it("builds Admin bag from APP_SHELL + App.Admin", () => {
    for (const path of APP_SHELL_MESSAGE_PATHS) {
      expect(ADMIN_MESSAGE_PATHS).toContain(path);
    }
    expect(ADMIN_MESSAGE_PATHS).toContain("App.Admin");
    expect(ADMIN_MESSAGE_PATHS).not.toContain("App.SokoBot");
  });
});
