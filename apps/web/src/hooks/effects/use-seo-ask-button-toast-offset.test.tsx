import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useSeoAskButtonToastOffset } from "./use-seo-ask-button-toast-offset";

function ToastOffsetProbe() {
  useSeoAskButtonToastOffset();
  return null;
}

describe("useSeoAskButtonToastOffset", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--toast-bottom-offset");
  });

  it("sets --toast-bottom-offset to 76px on mount and removes it on unmount", () => {
    const { unmount } = renderHook(() => useSeoAskButtonToastOffset());

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
  });

  it("removes --toast-bottom-offset when hidden under React Activity and restores it on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <ToastOffsetProbe />
      </Activity>,
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender(
      <Activity mode="hidden">
        <ToastOffsetProbe />
      </Activity>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");

    rerender(
      <Activity mode="visible">
        <ToastOffsetProbe />
      </Activity>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");
  });
});
