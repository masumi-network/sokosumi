import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoAgentVerdictFocus } from "./use-seo-agent-verdict-focus";

function VerdictHarness({
  checkSeen,
  checkRunning,
  headingKey = "a",
}: {
  checkSeen: boolean;
  checkRunning: boolean;
  headingKey?: string;
}) {
  const verdict = useRef<HTMLHeadingElement>(null);
  useSeoAgentVerdictFocus(verdict, checkSeen, checkRunning);
  return (
    <div>
      <button type="button">Other</button>
      <h3 key={headingKey} ref={verdict} tabIndex={-1}>
        Verdict
      </h3>
    </div>
  );
}

describe("useSeoAgentVerdictFocus", () => {
  it("focuses the verdict heading when a check that ran ends and focus is on body", () => {
    const { rerender, unmount } = render(
      <VerdictHarness checkSeen={true} checkRunning={true} />,
    );
    const heading = screen.getByRole("heading", { name: "Verdict" });
    expect(heading).not.toHaveFocus();

    rerender(<VerdictHarness checkSeen={true} checkRunning={false} />);
    expect(heading).toHaveFocus();

    unmount();
  });

  it("does not steal focus when another element is focused", () => {
    const { rerender } = render(
      <VerdictHarness checkSeen={true} checkRunning={true} />,
    );
    const other = screen.getByRole("button", { name: "Other" });
    other.focus();

    rerender(<VerdictHarness checkSeen={true} checkRunning={false} />);
    expect(other).toHaveFocus();
  });

  it("does not re-focus when the heading element remounts while deps are unchanged", () => {
    const { rerender } = render(
      <VerdictHarness checkSeen={true} checkRunning={false} headingKey="a" />,
    );
    const first = screen.getByRole("heading", { name: "Verdict" });
    expect(first).toHaveFocus();
    first.blur();
    expect(document.activeElement).toBe(document.body);

    rerender(
      <VerdictHarness checkSeen={true} checkRunning={false} headingKey="b" />,
    );
    const second = screen.getByRole("heading", { name: "Verdict" });
    expect(second).not.toHaveFocus();
  });

  it("preserves StrictMode replay and Activity hide/reveal focus behaviour", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <VerdictHarness checkSeen={true} checkRunning={false} />
        </Activity>
      </StrictMode>,
    );
    const heading = screen.getByRole("heading", { name: "Verdict" });
    expect(heading).toHaveFocus();
    // On first run body was active -> focuses heading; StrictMode replay sees heading active, not body.
    expect(focusSpy).toHaveBeenCalledTimes(1);

    heading.blur();
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <VerdictHarness checkSeen={true} checkRunning={false} />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <VerdictHarness checkSeen={true} checkRunning={false} />
        </Activity>
      </StrictMode>,
    );
    expect(heading).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(2);

    unmount();
  });
});
