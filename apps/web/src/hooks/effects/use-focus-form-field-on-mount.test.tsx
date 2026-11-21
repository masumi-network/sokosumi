import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useFocusFormFieldOnMount } from "./use-focus-form-field-on-mount";

describe("useFocusFormFieldOnMount", () => {
  it("focuses the named field once on mount and does not re-focus on re-render or fieldName change", () => {
    const setFocus = vi.fn();
    const form = { setFocus };

    const { rerender } = renderHook(
      ({ field }: { field: "code" | "currentPassword" }) =>
        useFocusFormFieldOnMount(form, field),
      { initialProps: { field: "code" as "code" | "currentPassword" } },
    );

    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenCalledWith("code");

    rerender({ field: "currentPassword" });
    expect(setFocus).toHaveBeenCalledTimes(1);
  });

  it("re-focuses the current field after React Activity hide and reveal", () => {
    const setFocus = vi.fn();
    const form = { setFocus };

    function Probe({ field }: { field: "code" | "currentPassword" }) {
      useFocusFormFieldOnMount(form, field);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe field="code" />
      </Activity>,
    );
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenLastCalledWith("code");

    rerender(
      <Activity mode="hidden">
        <Probe field="currentPassword" />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe field="currentPassword" />
      </Activity>,
    );
    expect(setFocus).toHaveBeenCalledTimes(2);
    expect(setFocus).toHaveBeenLastCalledWith("currentPassword");
  });

  it("does not throw during SSR", () => {
    const form = { setFocus: vi.fn() };

    function Probe() {
      useFocusFormFieldOnMount(form, "firstName");
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
    expect(form.setFocus).not.toHaveBeenCalled();
  });
});
