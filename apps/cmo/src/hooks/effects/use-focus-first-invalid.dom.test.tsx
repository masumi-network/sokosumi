// @vitest-environment happy-dom

import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusFirstInvalid } from "./use-focus-first-invalid";

describe("useFocusFirstInvalid (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("focuses the first invalid input on failed attempts and falls back to the form alert", async () => {
    function Probe({
      attempt,
      fieldInvalid,
      alertText,
    }: {
      attempt: number;
      fieldInvalid: boolean;
      alertText?: string;
    }) {
      const formRef = useFocusFirstInvalid(attempt);
      return (
        <form ref={formRef}>
          <input name="first" aria-invalid={fieldInvalid ? true : undefined} />
          <input name="second" aria-invalid={fieldInvalid ? true : undefined} />
          {alertText ? (
            <p role="alert" tabIndex={-1}>
              {alertText}
            </p>
          ) : null}
        </form>
      );
    }

    // Attempt 0 skips focusing.
    await act(async () =>
      root.render(<Probe attempt={0} fieldInvalid alertText="Oops" />),
    );
    expect(document.activeElement).toBe(document.body);

    // Attempt 1 focuses the first invalid input even when an alert is present.
    await act(async () =>
      root.render(<Probe attempt={1} fieldInvalid alertText="Oops" />),
    );
    expect(document.activeElement).toBe(
      container.querySelector('input[name="first"]'),
    );

    // Same attempt does not steal focus back.
    const second = container.querySelector<HTMLInputElement>(
      'input[name="second"]',
    );
    second?.focus();
    await act(async () =>
      root.render(<Probe attempt={1} fieldInvalid alertText="Oops" />),
    );
    expect(document.activeElement).toBe(second);

    // Attempt 2 with no invalid input focuses the form alert.
    await act(async () =>
      root.render(<Probe attempt={2} fieldInvalid={false} alertText="Oops" />),
    );
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
  });

  it("re-focuses after React Activity hide and reveal and does not throw during SSR", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    function Probe() {
      const formRef = useFocusFirstInvalid(1);
      return (
        <form ref={formRef}>
          <input aria-invalid="true" />
        </form>
      );
    }

    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(
        <Activity mode="hidden">
          <Probe />
        </Activity>,
      ),
    );
    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);

    expect(renderToString(<Probe />)).toContain("<form>");
  });
});
