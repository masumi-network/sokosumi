import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useRootCssVariable } from "./use-root-css-variable";

function RootCssVariableMarker({
  name,
  value,
}: {
  name: string;
  value: string | null | undefined;
}) {
  useRootCssVariable(name, value);
  return null;
}

describe("useRootCssVariable", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--toast-bottom-offset");
    document.documentElement.style.removeProperty("--test-custom-var");
  });

  it("sets a CSS custom property on documentElement on mount and removes it on unmount", () => {
    const { unmount } = renderHook(() =>
      useRootCssVariable("--toast-bottom-offset", "76px"),
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
  });

  it("updates when name or value changes and removes when value becomes nullish", () => {
    const { rerender } = renderHook(
      ({ name, value }: { name: string; value: string | null | undefined }) =>
        useRootCssVariable(name, value),
      {
        initialProps: {
          name: "--toast-bottom-offset",
          value: null as string | null | undefined,
        },
      },
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");

    rerender({ name: "--toast-bottom-offset", value: "76px" });
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender({ name: "--test-custom-var", value: "12px" });
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--test-custom-var"),
    ).toBe("12px");

    rerender({ name: "--test-custom-var", value: undefined });
    expect(
      document.documentElement.style.getPropertyValue("--test-custom-var"),
    ).toBe("");
  });

  it("removes the property when hidden under React Activity and restores it on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
      </Activity>,
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender(
      <Activity mode="hidden">
        <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
      </Activity>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");

    rerender(
      <Activity mode="visible">
        <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
      </Activity>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");
  });
});
