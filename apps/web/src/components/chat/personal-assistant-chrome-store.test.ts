import { afterEach, describe, expect, it } from "vitest";

import {
  clearPersonalAssistantChromeVisible,
  getPersonalAssistantChromeVisible,
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
});
