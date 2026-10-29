import type { SokoBotAvatarView } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { avatarSources, isCraftedAvatar, isCraftedStyle } from "./avatar";

const noStates = {
  idle: null,
  thinking: null,
  working: null,
  done: null,
  needs_you: null,
  offline: null,
};

const crafted: SokoBotAvatarView = {
  styleId: "crafted-desk",
  styleVersion: 1,
  stillUrl: "https://blob/idle.png",
  states: {
    ...noStates,
    working: {
      stillUrl: "https://blob/working.png",
      loopUrl: "https://blob/working-320.webp",
      loopLargeUrl: "https://blob/working-560.webp",
    },
    done: {
      stillUrl: "https://blob/done.png",
      loopUrl: null,
      loopLargeUrl: null,
    },
  },
};

describe("avatarSources", () => {
  it("gives a crafted avatar the state's still and both loops", () => {
    expect(avatarSources(crafted, "working", null)).toEqual({
      crafted: true,
      still: "https://blob/working.png",
      loop: "https://blob/working-320.webp",
      loopLarge: "https://blob/working-560.webp",
    });
  });

  it("has no loop for a state whose loop is not ready", () => {
    expect(avatarSources(crafted, "done", null)).toMatchObject({
      still: "https://blob/done.png",
      loop: null,
      loopLarge: null,
    });
  });

  it("falls back to the idle still for a state with no render yet", () => {
    expect(avatarSources(crafted, "needs_you", null)).toMatchObject({
      still: "https://blob/idle.png",
      loop: null,
    });
  });

  it("treats a legacy mascot as one still with no motion", () => {
    const mascot: SokoBotAvatarView = {
      styleId: "mascot",
      styleVersion: 1,
      stillUrl: "https://blob/mascot.png",
      states: noStates,
    };
    expect(isCraftedAvatar(mascot)).toBe(false);
    expect(avatarSources(mascot, "working", "https://blob/mascot.png")).toEqual(
      {
        crafted: false,
        still: "https://blob/mascot.png",
        loop: null,
        loopLarge: null,
      },
    );
  });

  it("uses the bot's image when there is no avatar view", () => {
    expect(avatarSources(null, "idle", "https://blob/x.png").still).toBe(
      "https://blob/x.png",
    );
  });
});

describe("isCraftedStyle", () => {
  it("is true only for a style other than the legacy mascot", () => {
    expect(isCraftedStyle("crafted-desk")).toBe(true);
    expect(isCraftedStyle("mascot")).toBe(false);
    expect(isCraftedStyle(null)).toBe(false);
    expect(isCraftedStyle(undefined)).toBe(false);
  });
});
