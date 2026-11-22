import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import { useCoworkerThoughtLineHeight } from "./use-coworker-thought-line-height";

function LineHeightProbe({
  expanded,
  bodyText,
  working,
  offsetHeight,
  events,
}: {
  expanded: boolean;
  bodyText: string | null | undefined;
  working: boolean;
  offsetHeight: number;
  events: string[];
}) {
  const traceRef = useRef<HTMLDivElement>(null);
  const currentHeightRef = useRef(offsetHeight);
  currentHeightRef.current = offsetHeight;
  const wiredNodeRef = useRef<HTMLDivElement | null>(null);
  // Registered BEFORE the hook so a passive-effect substitution would fire
  // after this effect, whereas useLayoutEffect always measures first.
  useEffect(() => {
    events.push("passive");
  }, [expanded, bodyText, working, events]);
  const lineHeight = useCoworkerThoughtLineHeight(
    traceRef,
    expanded,
    bodyText,
    working,
  );
  return (
    <div>
      <span data-testid="height">{lineHeight}</span>
      <div
        ref={(node) => {
          traceRef.current = node;
          if (node && wiredNodeRef.current !== node) {
            wiredNodeRef.current = node;
            Object.defineProperty(node, "offsetHeight", {
              configurable: true,
              get: () => {
                events.push(`measure:${currentHeightRef.current}`);
                return currentHeightRef.current;
              },
            });
          }
        }}
      />
    </div>
  );
}

describe("useCoworkerThoughtLineHeight", () => {
  it("measures offsetHeight in the layout phase before passive effects run and updates when deps change", () => {
    const events: string[] = [];
    const { rerender, unmount } = render(
      <LineHeightProbe
        expanded={true}
        bodyText="step 1"
        working={true}
        offsetHeight={48}
        events={events}
      />,
    );
    expect(screen.getByTestId("height")).toHaveTextContent("48");
    expect(events).toEqual(["measure:48", "passive"]);

    events.length = 0;
    rerender(
      <LineHeightProbe
        expanded={true}
        bodyText="step 1\n\nstep 2"
        working={true}
        offsetHeight={96}
        events={events}
      />,
    );
    expect(screen.getByTestId("height")).toHaveTextContent("96");
    expect(events).toEqual(["measure:96", "passive"]);

    unmount();
  });

  it("re-measures before passive effects on Activity reveal and survives StrictMode replay", () => {
    const events: string[] = [];
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <LineHeightProbe
            expanded={true}
            bodyText="step 1"
            working={false}
            offsetHeight={60}
            events={events}
          />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("height")).toHaveTextContent("60");
    // Each StrictMode mount pass measures in layout before its passive effect.
    expect(events).toEqual(["measure:60", "passive", "measure:60", "passive"]);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <LineHeightProbe
            expanded={true}
            bodyText="step 1"
            working={false}
            offsetHeight={120}
            events={events}
          />
        </Activity>
      </StrictMode>,
    );

    events.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <LineHeightProbe
            expanded={true}
            bodyText="step 1"
            working={false}
            offsetHeight={120}
            events={events}
          />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("height")).toHaveTextContent("120");
    expect(events).toEqual([
      "measure:120",
      "passive",
      "measure:120",
      "passive",
    ]);

    unmount();
  });
});
