import { describe, expect, it } from "vitest";

import { integrationTarget } from "./integration-target";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

describe("integrationTarget", () => {
  it("targets the caller's own bot without a bot id", () => {
    expect(integrationTarget({ provider: "gmail" })).toEqual({
      botId: undefined,
      valid: true,
    });
  });

  it("targets the shared bot named on the return URL", () => {
    expect(integrationTarget({ botId: BOT_ID })).toEqual({
      botId: BOT_ID,
      valid: true,
    });
  });

  it("settles nothing for a bot id that is not a uuid", () => {
    expect(integrationTarget({ botId: "me" })).toEqual({
      botId: undefined,
      valid: false,
    });
    expect(integrationTarget({ botId: [BOT_ID, BOT_ID] })).toEqual({
      botId: undefined,
      valid: false,
    });
  });
});
