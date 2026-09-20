import {
  BILLING_CREDITS_ADDED_MESSAGE_KEY,
  BILLING_FOLLOW_UP_MESSAGE_KEY,
  BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
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
  BILLING_ATTENTION_MESSAGE_KEYS,
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
  it("answers for every task key that waits on the reader", () => {
    for (const key of TASK_ATTENTION_MESSAGE_KEYS) {
      expect(followUpMessageKeyFor(key)).toBe(TASK_FOLLOW_UP_MESSAGE_KEY);
    }
  });

  /**
   * SOK-930 stopped Core writing a job notification, so there is nothing left
   * for a job reminder to remind anyone of. The key itself stays a follow-up
   * key, because a reminder stored before that is still one.
   */
  it("answers for every billing key that waits on the reader", () => {
    for (const key of BILLING_ATTENTION_MESSAGE_KEYS) {
      expect(followUpMessageKeyFor(key)).toBe(BILLING_FOLLOW_UP_MESSAGE_KEY);
    }
  });

  it("answers for no job key at all", () => {
    expect(followUpMessageKeyFor("Notifications.Job.inputRequired")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Job.paymentFailed")).toBeNull();
    expect(FOLLOW_UP_SOURCE_MESSAGE_KEYS).not.toContain(
      "Notifications.Job.inputRequired",
    );
  });

  it("answers for nothing a reader merely opted into", () => {
    expect(followUpMessageKeyFor(CHAT_ROOM_MESSAGE_MESSAGE_KEY)).toBeNull();
  });

  it("answers for nothing that waits on nobody", () => {
    expect(followUpMessageKeyFor("Notifications.Task.completed")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Task.canceled")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Job.completed")).toBeNull();
    expect(followUpMessageKeyFor("Notifications.Job.failed")).toBeNull();
    expect(followUpMessageKeyFor(BILLING_CREDITS_ADDED_MESSAGE_KEY)).toBeNull();
    expect(
      followUpMessageKeyFor(BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY),
    ).toBeNull();
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
      BILLING_FOLLOW_UP_MESSAGE_KEY,
    ]) {
      expect(followUpMessageKeyFor(key)).toBeNull();
      expect(FOLLOW_UP_SOURCE_MESSAGE_KEYS).not.toContain(key);
    }
  });
});

describe("followUpEventId", () => {
  const MORNING = new Date("2026-09-14T09:00:00.000Z");
  const EVENING = new Date("2026-09-14T22:00:00.000Z");
  const NEXT_DAY = new Date("2026-09-15T09:00:00.000Z");

  /**
   * The whole of the idempotency. Same room and same day, same event id, and
   * the notification table's own uniqueness refuses the second row. Two rows
   * hours apart still land on one reminder, which is user story 26.
   */
  it("gives one room's day one event id, every run", () => {
    expect(followUpEventId("room-1", MORNING)).toBe(
      "follow-up:room-1:2026-09-14",
    );
    expect(followUpEventId("room-1", EVENING)).toBe(
      followUpEventId("room-1", MORNING),
    );
    expect(followUpEventId("room-2", MORNING)).not.toBe(
      followUpEventId("room-1", MORNING),
    );
  });

  /**
   * The half that stops the room being muted for good.
   *
   * A follow-up row is never cleaned up, so an id naming only the room would
   * be held for the life of the account and every later mention in it would be
   * refused as a duplicate. A new day is a new id, so the room can be reminded
   * about again.
   */
  it("gives the same room a new event id on a new day", () => {
    expect(followUpEventId("room-1", NEXT_DAY)).not.toBe(
      followUpEventId("room-1", MORNING),
    );
  });
});
