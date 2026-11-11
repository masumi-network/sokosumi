import { npubEncode } from "nostr-tools/nip19";
import type { Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  BUZZ_KIND,
  messageDraft,
  openedDirectMessageChannelId,
  readableContent,
  readInbound,
} from "./events";

const CHANNEL = "6f7c1b2e-0000-4000-8000-000000000001";
const ROOT = "a".repeat(64);
const ALICE = "b".repeat(64);

function event(kind: number, tags: string[][], content = ""): Event {
  return {
    id: "c".repeat(64),
    pubkey: ALICE,
    created_at: 0,
    kind,
    tags,
    content,
    sig: "",
  };
}

describe("messageDraft", () => {
  it("answers a thread with a reply marker on its root and tags each mention once", () => {
    expect(
      messageDraft({
        channelId: CHANNEL,
        content: "hi",
        threadRootEventId: ROOT,
        mentionPubkeys: [ALICE, ALICE],
      }).tags,
    ).toEqual([
      ["h", CHANNEL],
      ["e", ROOT, "", "reply"],
      ["p", ALICE],
    ]);
  });
});

describe("readInbound", () => {
  it("reads a reply's target from its reply marker before any other e tag", () => {
    expect(
      readInbound(
        event(
          BUZZ_KIND.message,
          [
            ["h", CHANNEL],
            ["e", "d".repeat(64), "", "root"],
            ["e", ROOT, "", "reply"],
          ],
          "hey",
        ),
      ),
    ).toMatchObject({ type: "message", replyToEventId: ROOT });
  });

  it("turns a NIP-25 like into a thumbs up", () => {
    expect(readInbound(event(BUZZ_KIND.reaction, [["e", ROOT]], "+"))).toEqual({
      type: "reaction",
      targetEventId: ROOT,
      emoji: "👍",
    });
  });

  it("reads every target of a deletion", () => {
    expect(
      readInbound(
        event(BUZZ_KIND.deletion, [
          ["e", ROOT],
          ["e", ALICE],
        ]),
      ),
    ).toEqual({ type: "delete", targetEventIds: [ROOT, ALICE] });
  });

  it("ignores an edit without a target and kinds the bridge does not carry", () => {
    expect(readInbound(event(BUZZ_KIND.edit, [], "x"))).toEqual({
      type: "ignore",
    });
    expect(readInbound(event(20002, [["h", CHANNEL]]))).toEqual({
      type: "ignore",
    });
  });
});

describe("readableContent", () => {
  it("shows a known person's nostr reference as their name and leaves strangers alone", () => {
    const stranger = npubEncode("e".repeat(64));
    expect(
      readableContent(
        `nostr:${npubEncode(ALICE)} and nostr:${stranger}`,
        (pubkey) => (pubkey === ALICE ? "Alice" : undefined),
      ),
    ).toBe(`@Alice and nostr:${stranger}`);
  });
});

describe("openedDirectMessageChannelId", () => {
  it("reads the channel id from the relay's command response", () => {
    expect(
      openedDirectMessageChannelId(
        'response:{"channel_id":"abc","created":true}',
      ),
    ).toBe("abc");
    expect(openedDirectMessageChannelId("duplicate: already")).toBeNull();
  });
});
