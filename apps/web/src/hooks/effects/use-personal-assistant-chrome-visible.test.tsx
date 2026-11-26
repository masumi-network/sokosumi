import { render } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPersonalAssistantChromeVisible,
  getPersonalAssistantChromeVisible,
} from "@/components/chat/personal-assistant-chrome-store";
import { usePersonalAssistantChromeVisible } from "./use-personal-assistant-chrome-visible";

function ChromeMarker() {
  usePersonalAssistantChromeVisible();
  return null;
}

describe("usePersonalAssistantChromeVisible", () => {
  beforeEach(() => {
    clearPersonalAssistantChromeVisible();
  });

  afterEach(() => {
    clearPersonalAssistantChromeVisible();
  });

  it("publishes visibility on mount and re-publishes on React Activity reveal after a clear", () => {
    expect(getPersonalAssistantChromeVisible()).toBe(false);

    const { rerender } = render(
      <Activity mode="visible">
        <ChromeMarker />
      </Activity>,
    );
    expect(getPersonalAssistantChromeVisible()).toBe(true);

    rerender(
      <Activity mode="hidden">
        <ChromeMarker />
      </Activity>,
    );
    clearPersonalAssistantChromeVisible();
    expect(getPersonalAssistantChromeVisible()).toBe(false);

    rerender(
      <Activity mode="visible">
        <ChromeMarker />
      </Activity>,
    );
    expect(getPersonalAssistantChromeVisible()).toBe(true);
  });

  it("does not publish during SSR", () => {
    renderToString(<ChromeMarker />);
    expect(getPersonalAssistantChromeVisible()).toBe(false);
  });
});
