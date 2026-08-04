import { describe, expect, it } from "vitest";

import {
  ADMIN_MESSAGE_PATHS,
  APP_MESSAGE_PATHS,
  APP_SHELL_MESSAGE_PATHS,
  HERMES_MESSAGE_PATHS,
} from "@/i18n/message-namespaces";

describe("message namespaces", () => {
  it("excludes Hermes and Admin from the default APP bag", () => {
    expect(APP_MESSAGE_PATHS).not.toContain("App.Hermes");
    expect(APP_MESSAGE_PATHS).not.toContain("App.Admin");
    expect(APP_MESSAGE_PATHS).toContain("App.Account");
    expect(APP_MESSAGE_PATHS).toContain("App.Tasks");
    expect(APP_MESSAGE_PATHS).toContain("Components");
  });

  it("builds Hermes bag from APP_SHELL + App.Hermes", () => {
    for (const path of APP_SHELL_MESSAGE_PATHS) {
      expect(HERMES_MESSAGE_PATHS).toContain(path);
    }
    expect(HERMES_MESSAGE_PATHS).toContain("App.Hermes");
    expect(HERMES_MESSAGE_PATHS).not.toContain("App.Admin");
  });

  it("builds Admin bag from APP_SHELL + App.Admin", () => {
    for (const path of APP_SHELL_MESSAGE_PATHS) {
      expect(ADMIN_MESSAGE_PATHS).toContain(path);
    }
    expect(ADMIN_MESSAGE_PATHS).toContain("App.Admin");
    expect(ADMIN_MESSAGE_PATHS).not.toContain("App.Hermes");
  });
});
