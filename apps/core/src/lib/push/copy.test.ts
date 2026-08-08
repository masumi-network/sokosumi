import { describe, expect, it } from "vitest";

import { pushCopyFor } from "./copy";

const KEYS = [
  "Notifications.Job.completed",
  "Notifications.Job.inputRequired",
  "Notifications.Job.paymentFailed",
  "Notifications.Task.inputRequired",
  "Notifications.Chat.directMessage",
  "Notifications.Chat.mentioned",
  "notifications.vendorGrant.pending",
];

describe("pushCopyFor", () => {
  it("renders every key Core actually emits", () => {
    // If a key Core emits has no copy it silently never pushes, which is a
    // failure nobody sees.
    for (const key of KEYS) {
      expect(pushCopyFor(key, {}), key).not.toBeNull();
    }
  });

  it("uses the parameters it is given", () => {
    const copy = pushCopyFor("Notifications.Job.completed", {
      agentName: "Research Agent",
      jobName: "Market Analysis",
    });

    expect(copy?.title).toBe("Research Agent");
    expect(copy?.body).toContain("Market Analysis");
  });

  it("falls back rather than printing undefined", () => {
    const copy = pushCopyFor("Notifications.Job.completed", {});

    expect(copy?.title).toBe("Your agent");
    expect(JSON.stringify(copy)).not.toContain("undefined");
  });

  it("ignores a parameter of the wrong type", () => {
    const copy = pushCopyFor("Notifications.Job.completed", { agentName: 42 });

    expect(copy?.title).toBe("Your agent");
  });

  it("ignores a blank parameter", () => {
    const copy = pushCopyFor("Notifications.Job.completed", {
      agentName: "   ",
    });

    expect(copy?.title).toBe("Your agent");
  });

  it("never puts message text on a lock screen", () => {
    // Whoever is holding the phone can read it, and the sender did not agree
    // to that.
    const copy = pushCopyFor("Notifications.Chat.directMessage", {
      senderName: "Andreas",
      content: "the quarterly numbers are wrong",
    });

    expect(copy?.title).toBe("Andreas");
    expect(JSON.stringify(copy)).not.toContain("quarterly");
  });

  it("says nothing for a key it does not know", () => {
    // Better silence than "Notifications.Some.newKey" on a lock screen.
    expect(pushCopyFor("Notifications.Some.newKey", {})).toBeNull();
  });
});
