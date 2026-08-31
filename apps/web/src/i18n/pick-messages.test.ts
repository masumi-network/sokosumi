import { describe, expect, it } from "vitest";

import { pickMessages } from "@/i18n/pick-messages";

describe("pickMessages", () => {
  const messages = {
    Components: {
      CookieConsent: {
        title: "Cookies",
      },
      UserAvatar: {
        label: "Avatar",
      },
    },
    App: {
      Account: {
        title: "Account",
      },
      SokoBot: {
        title: "Soko Bot",
      },
      Tasks: {
        Detail: {
          title: "Task",
        },
        List: {
          title: "Tasks",
        },
      },
    },
    NotFound: {
      title: "404",
    },
  };

  it("picks top-level namespaces", () => {
    expect(pickMessages(messages, ["Components", "NotFound"])).toEqual({
      Components: messages.Components,
      NotFound: messages.NotFound,
    });
  });

  it("picks nested dotted paths under a shared parent", () => {
    expect(pickMessages(messages, ["App.Account", "App.Tasks.Detail"])).toEqual(
      {
        App: {
          Account: messages.App.Account,
          Tasks: {
            Detail: messages.App.Tasks.Detail,
          },
        },
      },
    );
  });

  it("skips missing paths", () => {
    expect(pickMessages(messages, ["Missing", "App.Missing"])).toEqual({});
  });

  it("returns empty object for empty path list", () => {
    expect(pickMessages(messages, [])).toEqual({});
  });
});
