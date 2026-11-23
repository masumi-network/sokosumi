import { render, screen } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoFocusHandoffTarget } from "./use-seo-focus-handoff-target";

function TargetHarness({
  handoff,
  causeKey,
  hidden,
}: {
  handoff: RefObject<boolean>;
  causeKey: string;
  hidden: boolean;
}) {
  const target = useRef<HTMLParagraphElement>(null);
  useSeoFocusHandoffTarget(handoff, target, causeKey, hidden);
  return (
    <div>
      <button type="button">Other</button>
      <p ref={target} tabIndex={-1}>
        {causeKey}
      </p>
    </div>
  );
}

describe("useSeoFocusHandoffTarget", () => {
  it("focuses target with preventScroll when handoff is armed, visible, and focus is on body", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const handoff = { current: true };
    const { rerender, unmount } = render(
      <TargetHarness handoff={handoff} causeKey="missing" hidden={true} />,
    );
    expect(handoff.current).toBe(true);
    expect(focusSpy).not.toHaveBeenCalled();

    rerender(
      <TargetHarness handoff={handoff} causeKey="empty" hidden={false} />,
    );
    expect(handoff.current).toBe(false);
    expect(screen.getByText("empty")).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    unmount();
  });

  it("consumes handoff without stealing focus when another element is focused", () => {
    const handoff = { current: false };
    const { rerender } = render(
      <TargetHarness handoff={handoff} causeKey="missing" hidden={false} />,
    );
    const other = screen.getByRole("button", { name: "Other" });
    other.focus();

    handoff.current = true;
    rerender(
      <TargetHarness handoff={handoff} causeKey="empty" hidden={false} />,
    );
    expect(handoff.current).toBe(false);
    expect(other).toHaveFocus();
  });

  it("preserves StrictMode replay and Activity hide/reveal behaviour", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const handoff = { current: true };
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <TargetHarness handoff={handoff} causeKey="first" hidden={false} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByText("first")).toHaveFocus();
    expect(handoff.current).toBe(false);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    screen.getByText("first").blur();
    handoff.current = true;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <TargetHarness handoff={handoff} causeKey="first" hidden={false} />
        </Activity>
      </StrictMode>,
    );
    expect(handoff.current).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <TargetHarness handoff={handoff} causeKey="first" hidden={false} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByText("first")).toHaveFocus();
    expect(handoff.current).toBe(false);
    expect(focusSpy).toHaveBeenCalledTimes(2);

    unmount();
  });
});
