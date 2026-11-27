import { describe, expect, it } from "vitest";
import { isForegroundOwnerChat, isOwnerRequest } from "./owner-request";

const ownerChat = {
  source: "CHAT",
  chainDepth: 0,
  askedByUserId: null,
  requestedByUserId: "owner",
  parentTurnId: null,
};

describe("isOwnerRequest", () => {
  it("counts the owner's chat, mentioned in a room or started through the API", () => {
    expect(isOwnerRequest(ownerChat)).toBe(true);
    expect(isOwnerRequest({ ...ownerChat, askedByUserId: "owner" })).toBe(true);
  });

  it("does not count a teammate's message or another bot's chained turn", () => {
    expect(isOwnerRequest({ ...ownerChat, askedByUserId: "teammate" })).toBe(
      false,
    );
    expect(isOwnerRequest({ ...ownerChat, chainDepth: 1 })).toBe(false);
  });

  it("counts a background run only when the owner's chat started it and the child stays an owner chat run", () => {
    const run = { ...ownerChat, parentTurnId: "parent" };
    expect(isOwnerRequest({ ...run, parentTurn: ownerChat })).toBe(true);
    expect(
      isOwnerRequest({
        ...run,
        parentTurn: { ...ownerChat, source: "INGEST" },
      }),
    ).toBe(false);
    expect(
      isOwnerRequest({
        ...run,
        parentTurn: { ...ownerChat, askedByUserId: "teammate" },
      }),
    ).toBe(false);
    expect(
      isOwnerRequest({
        ...run,
        source: "EVENT",
        parentTurn: ownerChat,
      }),
    ).toBe(false);
    expect(
      isOwnerRequest({
        ...run,
        askedByUserId: "teammate",
        parentTurn: ownerChat,
      }),
    ).toBe(false);
    expect(
      isOwnerRequest({
        ...run,
        chainDepth: 1,
        parentTurn: ownerChat,
      }),
    ).toBe(false);
    expect(isOwnerRequest({ ...run, parentTurn: null })).toBe(false);
    expect(isOwnerRequest(run)).toBe(false);
  });

  it("counts a schedule's run only when asked to", () => {
    const schedule = { ...ownerChat, source: "SCHEDULE" };
    expect(isOwnerRequest(schedule)).toBe(false);
    expect(isOwnerRequest(schedule, { schedules: true })).toBe(true);
    expect(isOwnerRequest({ ...ownerChat, source: "EVENT" })).toBe(false);
    expect(isOwnerRequest({ ...ownerChat, source: "INGEST" })).toBe(false);
  });
});

describe("isForegroundOwnerChat", () => {
  it("is the owner's own chat turn, however its asker is recorded", () => {
    expect(isForegroundOwnerChat(ownerChat)).toBe(true);
    const { askedByUserId: _unset, ...withoutAsker } = ownerChat;
    expect(isForegroundOwnerChat(withoutAsker)).toBe(true);
  });

  it("is not a background run of it, a schedule, a wake, a teammate or a chained bot", () => {
    expect(
      isForegroundOwnerChat({ ...ownerChat, parentTurnId: "parent" }),
    ).toBe(false);
    expect(isForegroundOwnerChat({ ...ownerChat, source: "SCHEDULE" })).toBe(
      false,
    );
    expect(isForegroundOwnerChat({ ...ownerChat, source: "EVENT" })).toBe(
      false,
    );
    expect(
      isForegroundOwnerChat({ ...ownerChat, askedByUserId: "teammate" }),
    ).toBe(false);
    expect(isForegroundOwnerChat({ ...ownerChat, chainDepth: 1 })).toBe(false);
  });
});
