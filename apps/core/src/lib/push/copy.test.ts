import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PUSH_MESSAGE_KEYS, pushCopyFor } from "./copy";

describe("pushCopyFor", () => {
  it("renders every key Core emits", () => {
    // A key with no copy silently never pushes, which is a failure nobody sees.
    for (const key of PUSH_MESSAGE_KEYS) {
      expect(pushCopyFor(key, {}), key).not.toBeNull();
    }
  });

  it("stays in step with the keys Core actually emits", () => {
    // Jobs and tasks assign their key from a switch, which is easy to extend
    // without noticing the push copy did not follow. This is the guard.
    const sources = globSync("src/**/*.ts", { cwd: process.cwd() }).filter(
      (file) => !file.includes(".test.") && !file.includes("lib/push/"),
    );

    const emitted = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /"([Nn]otifications\.[A-Za-z]+\.[A-Za-z]+)"/g,
      )) {
        emitted.add(match[1]);
      }
    }

    const missing = [...emitted].filter((key) => pushCopyFor(key, {}) === null);
    expect(missing, `keys emitted by Core with no push copy`).toEqual([]);
  });

  it("uses the parameters it is given", () => {
    const copy = pushCopyFor("Notifications.Job.completed", {
      agentName: "Research Agent",
      jobName: "Market Analysis",
    });

    expect(copy?.title).toBe("Research Agent");
    expect(copy?.body).toContain("Market Analysis");
  });

  it("uses the author name chat actually sends", () => {
    // Chat emits `authorName`; reading `senderName` would fall back every time
    // and nobody would notice, because the fallback reads fine.
    const copy = pushCopyFor("Notifications.Chat.mentioned", {
      authorName: "Andreas",
      roomName: "Mobile",
    });

    expect(copy?.title).toBe("Andreas");
    expect(copy?.body).toContain("Mobile");
  });

  it("falls back rather than printing undefined", () => {
    for (const key of PUSH_MESSAGE_KEYS) {
      expect(JSON.stringify(pushCopyFor(key, {})), key).not.toContain(
        "undefined",
      );
    }
  });

  it("ignores a parameter of the wrong type or a blank one", () => {
    expect(
      pushCopyFor("Notifications.Job.completed", { agentName: 42 })?.title,
    ).toBe("Your agent");
    expect(
      pushCopyFor("Notifications.Job.completed", { agentName: "  " })?.title,
    ).toBe("Your agent");
  });

  it("never puts message text on a lock screen", () => {
    // Whoever is holding the phone can read it, and the sender did not agree
    // to that.
    const copy = pushCopyFor("Notifications.Chat.directMessage", {
      authorName: "Andreas",
      content: "the quarterly numbers are wrong",
    });

    expect(copy?.title).toBe("Andreas");
    expect(JSON.stringify(copy)).not.toContain("quarterly");
  });

  it("says nothing for a key it does not know", () => {
    expect(pushCopyFor("Notifications.Some.newKey", {})).toBeNull();
  });
});
