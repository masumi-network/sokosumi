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

  it("sets a CSS custom property on documentElement and removes it on unmount when none existed", () => {
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

  it("restores a pre-existing CSS custom property when the last owner unmounts", () => {
    document.documentElement.style.setProperty("--toast-bottom-offset", "24px");

    const { unmount } = renderHook(() =>
      useRootCssVariable("--toast-bottom-offset", "76px"),
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("24px");
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

  it("restores the outer owner when an inner Activity owner hides, and reveals back to inner", () => {
    const { rerender, unmount } = render(
      <>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender(
      <>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="hidden">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("48px");

    rerender(
      <>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    unmount();
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("");
  });

  it("keeps the inner owner's value when the outer Activity owner hides first", () => {
    document.documentElement.style.setProperty("--toast-bottom-offset", "16px");

    const { rerender } = render(
      <>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );

    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender(
      <>
        <Activity mode="hidden">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="visible">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("76px");

    rerender(
      <>
        <Activity mode="hidden">
          <RootCssVariableMarker name="--toast-bottom-offset" value="48px" />
        </Activity>
        <Activity mode="hidden">
          <RootCssVariableMarker name="--toast-bottom-offset" value="76px" />
        </Activity>
      </>,
    );
    expect(
      document.documentElement.style.getPropertyValue("--toast-bottom-offset"),
    ).toBe("16px");
  });
});
