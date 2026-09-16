import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  JOB_ATTENTION_MESSAGE_KEYS,
  TASK_ATTENTION_MESSAGE_KEYS,
} from "./notification-delivery";
import {
  FOLLOW_UP_SOURCE_MESSAGE_KEYS,
  followUpEventId,
  followUpMessageKeyFor,
} from "./notification-follow-up";

describe("followUpMessageKeyFor", () => {
  it("answers for the two chat messages addressed to the reader", () => {
    expect(followUpMessageKeyFor(CHAT_MENTION_MESSAGE_KEY)).toBe(
      CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
    );
    expect(followUpMessageKeyFor(CHAT_DIRECT_MESSAGE_MESSAGE_KEY)).toBe(
      CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
    );
  });

  /**
   * Looped here on purpose, and only here: the point is that the two lists stay
   * the same list. `notification-delivery.test` writes both out by name, so a
   * key dropped from either is still caught somewhere.
   */
  it("answers for every task and job key that waits on the reader", () => {
    for (const key of TASK_ATTENTION_MESSAGE_KEYS) {
      expect(followUpMessageKeyFor(key)).toBe(TASK_FOLLOW_UP_MESSAGE_KEY);
    }
    for (const key of JOB_ATTENTION_MESSAGE_KEYS) {
      expect(followUpMessageKeyFor(key)).toBe(JOB_FOLLOW_UP_MESSAGE_KEY);
    }
  });

  it("answers for nothing a reader merely opted into", () => {
    expect(followUpMessageKeyFor(CHAT_ROOM_MESSAGE_MESSAGE_KEY)).toBeNull();
  });

  it("answers for nothing that waits on nobody", () => {
    expect(followUpMessageKeyFor("Notifications.Task.completed")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Task.canceled")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Job.completed")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Job.failed")).toBeNull();
  });

  it("answers for no key it does not know", () => {
    expect(followUpMessageKeyFor("Notifications.Chat.invented")).toBeNull();
  });

  /**
   * What makes "one reminder, never two" true by construction. A follow-up that
   * was also a source key would be followed up itself the next day, forever.
   */
  it("never answers for a follow-up", () => {
    // Written out rather than looped over a list: a key dropped from the list
    // would shrink the loop and the test would pass having checked less.
    for (const key of [
      CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
      CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
      TASK_FOLLOW_UP_MESSAGE_KEY,
      JOB_FOLLOW_UP_MESSAGE_KEY,
    ]) {
      expect(followUpMessageKeyFor(key)).toBeNull();
      expect(FOLLOW_UP_SOURCE_MESSAGE_KEYS).not.toContain(key);
    }
  });
});

describe("followUpEventId", () => {
  /**
   * The whole of the idempotency. Same reference, same event id, and the
   * notification table's own uniqueness refuses the second row.
   */
  it("gives one reference one event id, every run", () => {
    expect(followUpEventId("room-1")).toBe("follow-up:room-1");
    expect(followUpEventId("room-1")).toBe(followUpEventId("room-1"));
    expect(followUpEventId("room-2")).not.toBe(followUpEventId("room-1"));
  });
});
