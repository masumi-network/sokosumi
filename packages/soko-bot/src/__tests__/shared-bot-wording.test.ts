import { describe, expect, it } from "vitest";
import {
  unattendedHireOverCeilingRefusal,
  unattendedSecondHireRefusal,
} from "../policy.js";
import {
  SOKO_BOT_SYSTEM_SCHEDULES,
  sokoBotSystemSchedulePrompt,
} from "../proactive.js";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SHARED_SOKO_BOT_GUIDANCE,
} from "../versions/index.js";

const OWNER_WORDS = /\bowner\b|\byou sent\b|\bwaiting on you\b/i;
const OFFERED_TO_SHARED = [
  "standup",
  "weekly-wrap",
  "end-of-day",
  "monday-plan",
  "monthly-review",
  "memory-cleanup",
];

describe("shared Soko Bot rhythms", () => {
  it("offer an owner-free prompt for the team rhythms only", () => {
    const offered = SOKO_BOT_SYSTEM_SCHEDULES.filter(
      (schedule) => sokoBotSystemSchedulePrompt(schedule, true) !== null,
    ).map((schedule) => schedule.key);
    expect(offered).toEqual(OFFERED_TO_SHARED);
    for (const schedule of SOKO_BOT_SYSTEM_SCHEDULES) {
      const prompt = sokoBotSystemSchedulePrompt(schedule, true);
      if (prompt === null) continue;
      expect(prompt).not.toMatch(OWNER_WORDS);
      expect(prompt).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("keep the personal prompt for a personal bot", () => {
    for (const schedule of SOKO_BOT_SYSTEM_SCHEDULES) {
      expect(sokoBotSystemSchedulePrompt(schedule, false)).toBe(
        schedule.prompt,
      );
    }
  });
});

describe("shared Soko Bot system prompt", () => {
  const version = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);

  it("tells a shared bot how to read owner wording, last", () => {
    const prompt = composeSystemPrompt(version, {
      name: "Atlas",
      ownerName: null,
      shared: true,
    });
    expect(prompt.endsWith(SHARED_SOKO_BOT_GUIDANCE)).toBe(true);
  });

  it("leaves a personal bot's prompt unchanged", () => {
    const persona = { name: "Jarvis", ownerName: "Ana Example" };
    const prompt = composeSystemPrompt(version, persona);
    expect(prompt).not.toContain(SHARED_SOKO_BOT_GUIDANCE);
    expect(composeSystemPrompt(version)).not.toContain(
      SHARED_SOKO_BOT_GUIDANCE,
    );
  });
});

describe("unattended hire refusals", () => {
  it("send a personal bot to its owner, word for word", () => {
    expect(unattendedSecondHireRefusal(false)).toBe(
      "A turn nobody asked for may hire once. Report what you found and ask the owner before hiring again.",
    );
    expect(unattendedHireOverCeilingRefusal(false, 50, 80)).toBe(
      "A turn nobody asked for may commit at most 50 credits; this asked for 80. Ask the owner in their chat instead.",
    );
  });

  it("send a shared bot to its shared room", () => {
    expect(unattendedSecondHireRefusal(true)).not.toMatch(/owner/);
    expect(unattendedSecondHireRefusal(true)).toContain("shared room");
    const overCeiling = unattendedHireOverCeilingRefusal(true, 50, 80);
    expect(overCeiling).not.toMatch(/owner/);
    expect(overCeiling).toContain("at most 50 credits");
    expect(overCeiling).toContain("shared room");
  });
});
