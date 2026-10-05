import { describe, expect, it } from "vitest";

import {
  cmoMayExecute,
  cmoStrategySchema,
  isCmoScheduleKey,
  SOKO_BOT_CMO_SCHEDULES,
} from "../cmo.js";
import { SOKO_BOT_CMO_CAPABILITIES } from "../policy.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";

describe("CMO version", () => {
  it("is resolvable but never part of the personal-assistant fleet", () => {
    expect(getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID).profile).toBe("cmo");
    expect(SOKO_BOT_VERSIONS.map((version) => version.id)).not.toContain(
      CMO_SOKO_BOT_VERSION_ID,
    );
    expect(composeSystemPrompt(getSokoBotVersion("cmo-v1"))).toContain(
      "# Brand Brain",
    );
  });

  it("gives CMO tools to Cuso on every route and to nobody else", () => {
    const cmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const assistant = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    expect(applyVersionCapabilities(cmo, ["read_memory"])).toEqual([
      "read_memory",
      ...SOKO_BOT_CMO_CAPABILITIES,
    ]);
    expect(
      applyVersionCapabilities(assistant, [
        "read_memory",
        "save_strategy",
        "save_brand_brain",
      ]),
    ).toEqual(["read_memory"]);
    // Personal mail is not a CMO tool.
    expect(applyVersionCapabilities(cmo, ["search_inbox"])).not.toContain(
      "search_inbox",
    );
  });

  it("describes both CMO tools", () => {
    for (const capability of SOKO_BOT_CMO_CAPABILITIES) {
      expect(SOKO_BOT_TOOL_DESCRIPTIONS[capability]).toBeTruthy();
    }
  });
});

describe("cmoMayExecute", () => {
  it("executes only once the strategy is approved and paid for", () => {
    const run = (approved: boolean, subscribed: boolean) =>
      cmoMayExecute({ approved, subscribed }).ok;
    expect(run(false, true)).toBe(false);
    expect(run(true, false)).toBe(false);
    expect(run(true, true)).toBe(true);
  });

  it("says why it refused", () => {
    const refused = cmoMayExecute({ approved: false, subscribed: true });
    expect(refused.ok === false && refused.reason).toMatch(/approved/);
  });
});

describe("CMO strategy and rhythms", () => {
  it("fills defaults the bot can leave out", () => {
    const strategy = cmoStrategySchema.parse({
      month: "2026-10",
      summary: "Grow LinkedIn reach with founder-led posts.",
      goals: ["More demo requests"],
      pillars: ["Product stories"],
      channels: [{ channel: "LinkedIn", cadence: "3 posts a week" }],
      calendar: [
        {
          id: "w1-mon",
          date: "2026-10-05",
          channel: "linkedin",
          title: "Why we built it",
          format: "post",
          status: "idea",
        },
      ],
    });
    expect(strategy.channels[0]).toEqual({
      channel: "linkedin",
      cadence: "3 posts a week",
    });
    expect(strategy.previews).toEqual([]);
  });

  it("names its rhythms", () => {
    expect(SOKO_BOT_CMO_SCHEDULES.map((schedule) => schedule.key)).toEqual([
      "cmo-daily-run",
      "cmo-weekly-review",
    ]);
    expect(isCmoScheduleKey("cmo-daily-run")).toBe(true);
    expect(isCmoScheduleKey("standup")).toBe(false);
  });
});
