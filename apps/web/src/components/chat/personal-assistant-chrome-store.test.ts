import { afterEach, describe, expect, it } from "vitest";

import {
  clearPersonalAssistantChromeVisible,
  getFailedSokoBotId,
  getPersonalAssistantChromeVisible,
  publishFailedSokoBotId,
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

  it("keeps failedSokoBotId active until every failing publisher clears", () => {
    expect(getFailedSokoBotId()).toBeNull();

    let calls = 0;
    const unsubscribe = subscribePersonalAssistantChromeVisible(() => {
      calls += 1;
    });

    const clearFirst = publishFailedSokoBotId("bot-1");
    const clearSecond = publishFailedSokoBotId("bot-1");
    try {
      expect(getFailedSokoBotId()).toBe("bot-1");
      expect(calls).toBe(1);

      clearFirst();
      // Clearing the same publisher twice is a no-op and must not clear the second.
      clearFirst();
      expect(getFailedSokoBotId()).toBe("bot-1");
      expect(calls).toBe(1);

      clearSecond();
      expect(getFailedSokoBotId()).toBeNull();
      expect(calls).toBe(2);
    } finally {
      clearFirst();
      clearSecond();
      unsubscribe();
    }
  });

  it("falls back to a remaining publisher when two failed bot ids overlap", () => {
    const clearFirst = publishFailedSokoBotId("bot-1");
    const clearSecond = publishFailedSokoBotId("bot-2");
    try {
      expect(getFailedSokoBotId()).toBe("bot-2");

      clearSecond();
      expect(getFailedSokoBotId()).toBe("bot-1");

      clearFirst();
      expect(getFailedSokoBotId()).toBeNull();
    } finally {
      clearFirst();
      clearSecond();
    }
  });
});
