import { SokoBotStatus } from "@sokosumi/core-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearPersonalAssistantChromeVisible,
  getLiveSokoBot,
  getPersonalAssistantChromeVisible,
  publishLiveSokoBot,
  publishPersonalAssistantChromeVisible,
  subscribePersonalAssistantChromeVisible,
} from "./personal-assistant-chrome-store";

describe("personal-assistant-chrome-store", () => {
  afterEach(() => {
    clearPersonalAssistantChromeVisible();
  });

  it("defaults to hidden until published", () => {
    expect(getPersonalAssistantChromeVisible()).toBe(false);
  });

  it("notifies subscribers when visibility changes", () => {
    let calls = 0;
    const unsubscribe = subscribePersonalAssistantChromeVisible(() => {
      calls += 1;
    });

    publishPersonalAssistantChromeVisible(true);
    expect(getPersonalAssistantChromeVisible()).toBe(true);
    expect(calls).toBe(1);

    publishPersonalAssistantChromeVisible(true);
    expect(calls).toBe(1);

    clearPersonalAssistantChromeVisible();
    expect(getPersonalAssistantChromeVisible()).toBe(false);
    expect(calls).toBe(2);

    unsubscribe();
  });

  it("keeps the live Soko Bot until every publisher clears", () => {
    expect(getLiveSokoBot()).toBeNull();

    let calls = 0;
    const unsubscribe = subscribePersonalAssistantChromeVisible(() => {
      calls += 1;
    });

    const clearFirst = publishLiveSokoBot(idle("bot-1"));
    const clearSecond = publishLiveSokoBot(idle("bot-1"));
    try {
      expect(getLiveSokoBot()).toEqual(idle("bot-1"));
      // The same bot again is no change.
      expect(calls).toBe(1);

      clearFirst();
      // Clearing the same publisher twice is a no-op and must not clear the second.
      clearFirst();
      expect(getLiveSokoBot()?.id).toBe("bot-1");
      expect(calls).toBe(1);

      clearSecond();
      expect(getLiveSokoBot()).toBeNull();
      expect(calls).toBe(2);
    } finally {
      clearFirst();
      clearSecond();
      unsubscribe();
    }
  });

  it("follows the newest publisher and falls back when it clears", () => {
    const clearFirst = publishLiveSokoBot(idle("bot-1"));
    const clearSecond = publishLiveSokoBot({
      ...idle("bot-1"),
      status: SokoBotStatus.ERROR,
    });
    try {
      expect(getLiveSokoBot()?.status).toBe(SokoBotStatus.ERROR);

      clearSecond();
      expect(getLiveSokoBot()?.status).toBe(SokoBotStatus.IDLE);

      clearFirst();
      expect(getLiveSokoBot()).toBeNull();
    } finally {
      clearFirst();
      clearSecond();
    }
  });
});

function idle(id: string) {
  return {
    id,
    status: SokoBotStatus.IDLE,
    lastActivityAt: new Date("2026-11-22T10:00:00Z"),
  };
}
