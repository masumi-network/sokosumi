import { describe, expect, it } from "vitest";

import {
  type HermesUiMessage,
  mergeHermesMessageLists,
} from "@/lib/hermes/merge-persisted-messages";

function message(
  overrides: Partial<HermesUiMessage> & Pick<HermesUiMessage, "id">,
): HermesUiMessage {
  return {
    role: "assistant",
    content: "hello",
    kind: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeHermesMessageLists", () => {
  it("returns the server list when there are no pending local messages", () => {
    const server = [
      message({ id: "server-1", role: "user", content: "Hi" }),
      message({
        id: "server-2",
        role: "assistant",
        content: "Hello",
        createdAt: "2026-01-01T10:00:01.000Z",
      }),
    ];

    expect(mergeHermesMessageLists(server, server)).toEqual(server);
  });

  it("keeps an optimistic assistant until a server assistant catches up", () => {
    const localAssistant = message({
      id: "a-1760000000000",
      role: "assistant",
      content: "This may take a moment.",
      createdAt: "2026-01-01T10:00:05.000Z",
    });

    expect(mergeHermesMessageLists([localAssistant], [])).toEqual([
      localAssistant,
    ]);

    const serverAssistant = message({
      id: "server-assistant",
      role: "assistant",
      content: "This may take a moment.",
      createdAt: "2026-01-01T10:00:12.000Z",
    });

    expect(
      mergeHermesMessageLists([localAssistant], [serverAssistant]),
    ).toEqual([serverAssistant]);
  });

  it("keeps a follow-up assistant distinct from a prior server reply", () => {
    // Regression: a time-window heuristic dropped this follow-up because the
    // previous turn's reply was within 30s — causing the answer to flicker.
    const priorServerAssistant = message({
      id: "server-1",
      role: "assistant",
      content: "First answer",
      createdAt: "2026-01-01T10:00:01.000Z",
    });
    const localFollowup = message({
      id: "a-1760000001000",
      role: "assistant",
      content: "Second answer",
      createdAt: "2026-01-01T10:00:05.000Z",
    });

    expect(
      mergeHermesMessageLists(
        [priorServerAssistant, localFollowup],
        [priorServerAssistant],
      ),
    ).toEqual([priorServerAssistant, localFollowup]);
  });

  it("retains an optimistic user while the server has not persisted that turn", () => {
    const localUser = message({
      id: "u-1760000000000",
      role: "user",
      content: "Summarize my inbox\n\n📎 agenda.pdf",
      createdAt: "2026-01-01T10:00:05.000Z",
    });
    const oldServerUser = message({
      id: "server-old-user",
      role: "user",
      content: "Previous turn",
      createdAt: "2026-01-01T09:58:00.000Z",
    });

    expect(
      mergeHermesMessageLists([oldServerUser, localUser], [oldServerUser]),
    ).toEqual([oldServerUser, localUser]);
  });

  it("drops an optimistic user when a matching server turn appears", () => {
    const localUser = message({
      id: "u-1760000000000",
      role: "user",
      content: "Summarize my inbox\n\n📎 agenda.pdf",
      createdAt: "2026-01-01T10:00:05.000Z",
    });
    const serverUser = message({
      id: "server-user",
      role: "user",
      content: "Summarize my inbox\n\nAttached files: agenda.pdf",
      createdAt: "2026-01-01T10:00:07.000Z",
    });

    expect(mergeHermesMessageLists([localUser], [serverUser])).toEqual([
      serverUser,
    ]);
  });

  it("keeps the second of two identical back-to-back user messages until both persist", () => {
    // Regression: matching by "any server row with this content" collapses
    // duplicate sends ("yes", "yes") into one — the second optimistic message
    // vanishes until its own row lands. One-for-one matching must keep it.
    const localFirst = message({
      id: "u-1760000000000",
      role: "user",
      content: "yes",
      createdAt: "2026-01-01T10:00:05.000Z",
    });
    const localSecond = message({
      id: "u-1760000001000",
      role: "user",
      content: "yes",
      createdAt: "2026-01-01T10:00:08.000Z",
    });
    const serverFirst = message({
      id: "server-yes-1",
      role: "user",
      content: "yes",
      createdAt: "2026-01-01T10:00:06.000Z",
    });

    // Only the first "yes" has persisted: the second optimistic must survive.
    expect(
      mergeHermesMessageLists([localFirst, localSecond], [serverFirst]),
    ).toEqual([serverFirst, localSecond]);

    // Both "yes" rows persisted: both optimistic messages are now covered.
    const serverSecond = message({
      id: "server-yes-2",
      role: "user",
      content: "yes",
      createdAt: "2026-01-01T10:00:09.000Z",
    });
    expect(
      mergeHermesMessageLists(
        [localFirst, localSecond],
        [serverFirst, serverSecond],
      ),
    ).toEqual([serverFirst, serverSecond]);
  });
});
