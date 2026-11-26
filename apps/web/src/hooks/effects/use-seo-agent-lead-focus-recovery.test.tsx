import { render, screen } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoAgentLeadFocusRecovery } from "./use-seo-agent-lead-focus-recovery";

function LeadHarness({
  leadKey,
  onRef,
}: {
  leadKey: string | null;
  onRef: (ref: RefObject<boolean>) => void;
}) {
  const verdict = useRef<HTMLHeadingElement>(null);
  const leadFocused = useSeoAgentLeadFocusRecovery(verdict, leadKey);
  onRef(leadFocused);
  return (
    <div>
      <button type="button">Other</button>
      <h3 ref={verdict} tabIndex={-1}>
        Verdict
      </h3>
    </div>
  );
}

describe("useSeoAgentLeadFocusRecovery", () => {
  it("focuses verdict and clears leadFocused when leadKey changes after focus fell to body", () => {
    const captured: { ref: RefObject<boolean> | null } = { ref: null };
    const { rerender, unmount } = render(
      <LeadHarness
        leadKey="action-1"
        onRef={(ref) => {
          captured.ref = ref;
        }}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Verdict" });
    expect(heading).not.toHaveFocus();

    if (!captured.ref) throw new Error("expected ref");
    captured.ref.current = true;
    rerender(
      <LeadHarness
        leadKey="action-2"
        onRef={(ref) => {
          captured.ref = ref;
        }}
      />,
    );

    expect(heading).toHaveFocus();
    expect(captured.ref.current).toBe(false);

    unmount();
  });

  it("does not focus when leadFocused is false or focus is elsewhere, and still resets leadFocused", () => {
    const captured: { ref: RefObject<boolean> | null } = { ref: null };
    const { rerender } = render(
      <LeadHarness
        leadKey="action-1"
        onRef={(ref) => {
          captured.ref = ref;
        }}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Verdict" });
    const other = screen.getByRole("button", { name: "Other" });

    rerender(
      <LeadHarness
        leadKey="action-2"
        onRef={(ref) => {
          captured.ref = ref;
        }}
      />,
    );
    expect(heading).not.toHaveFocus();

    if (!captured.ref) throw new Error("expected ref");
    captured.ref.current = true;
    other.focus();
    rerender(
      <LeadHarness
        leadKey="action-3"
        onRef={(ref) => {
          captured.ref = ref;
        }}
      />,
    );
    expect(other).toHaveFocus();
    expect(captured.ref.current).toBe(false);
  });

  it("matches StrictMode replay and Activity hide/reveal behaviour", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const captured: { ref: RefObject<boolean> | null } = { ref: null };
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <LeadHarness
            leadKey="action-1"
            onRef={(ref) => {
              captured.ref = ref;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).not.toHaveBeenCalled();

    if (!captured.ref) throw new Error("expected ref");
    captured.ref.current = true;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <LeadHarness
            leadKey="action-2"
            onRef={(ref) => {
              captured.ref = ref;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <LeadHarness
            leadKey="action-2"
            onRef={(ref) => {
              captured.ref = ref;
            }}
          />
        </Activity>
      </StrictMode>,
    );
    const heading = screen.getByRole("heading", { name: "Verdict" });
    expect(heading).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(captured.ref.current).toBe(false);

    unmount();
  });
});
