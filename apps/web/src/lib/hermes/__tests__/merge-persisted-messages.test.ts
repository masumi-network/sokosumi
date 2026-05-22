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
});
