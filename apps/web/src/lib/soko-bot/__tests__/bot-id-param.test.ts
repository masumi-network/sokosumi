import { describe, expect, it } from "vitest";

import { readBotIdParam, withBotIdParam } from "../bot-id-param";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

describe("readBotIdParam", () => {
  it("reads no bot id when the parameter is absent", () => {
    expect(readBotIdParam("https://web.test/api/x")).toEqual({
      botId: undefined,
    });
  });

  it("reads a valid bot id", () => {
    expect(readBotIdParam(`https://web.test/api/x?botId=${BOT_ID}`)).toEqual({
      botId: BOT_ID,
    });
  });

  it("refuses a bot id that is not a uuid", () => {
    expect(readBotIdParam("https://web.test/api/x?botId=me")).toBeNull();
    expect(readBotIdParam("https://web.test/api/x?botId=")).toBeNull();
  });
});

describe("withBotIdParam", () => {
  it("leaves the endpoint alone for the caller's own bot", () => {
    expect(withBotIdParam("/api/x")).toBe("/api/x");
    expect(withBotIdParam("/api/x", null)).toBe("/api/x");
  });

  it("adds the shared bot's id", () => {
    expect(withBotIdParam("/api/x", BOT_ID)).toBe(`/api/x?botId=${BOT_ID}`);
  });
});
