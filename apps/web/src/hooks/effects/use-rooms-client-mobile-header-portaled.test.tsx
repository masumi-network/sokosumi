import { render, screen } from "@testing-library/react";
import {
  Activity,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { describe, expect, it } from "vitest";

import { useRoomsClientMobileHeaderPortaled } from "./use-rooms-client-mobile-header-portaled";

describe("useRoomsClientMobileHeaderPortaled", () => {
  it("commits false first and portals only in passive effect phase when mobile and host are present", () => {
    const phases: string[] = [];

    function Probe({
      isMobile,
      host,
    }: {
      isMobile: boolean | undefined;
      host: HTMLElement | null;
    }) {
      const domRef = useRef<HTMLSpanElement | null>(null);
      useEffect(() => {
        phases.push(`passive-before-hook:${domRef.current?.textContent}`);
      });
      const portaled = useRoomsClientMobileHeaderPortaled(isMobile, host);
      useLayoutEffect(() => {
        phases.push(`layout:${String(portaled)}`);
      });
      return (
        <span ref={domRef} data-testid="portaled">
          {String(portaled)}
        </span>
      );
    }

    const host = document.createElement("div");
    const { rerender } = render(<Probe isMobile host={host} />);

    // First committed frame must stay false through layout and into passive
    // phase before the hook's passive effect switches it to true.
    expect(phases).toEqual([
      "layout:false",
      "passive-before-hook:false",
      "layout:true",
      "passive-before-hook:true",
    ]);
    expect(screen.getByTestId("portaled")).toHaveTextContent("true");

    // Leaving mobile viewport turns the portal off.
    rerender(<Probe isMobile={false} host={host} />);
    expect(screen.getByTestId("portaled")).toHaveTextContent("false");

    // Returning to mobile with no host keeps it off; attaching host turns it on.
    rerender(<Probe isMobile host={null} />);
    expect(screen.getByTestId("portaled")).toHaveTextContent("false");

    rerender(<Probe isMobile host={host} />);
    expect(screen.getByTestId("portaled")).toHaveTextContent("true");

    // Unresolved media query (undefined) turns the portal off.
    rerender(<Probe isMobile={undefined} host={host} />);
    expect(screen.getByTestId("portaled")).toHaveTextContent("false");
  });

  it("re-syncs cleanly across StrictMode and Activity hide/reveal", () => {
    function Probe({
      isMobile,
      host,
    }: {
      isMobile: boolean | undefined;
      host: HTMLElement | null;
    }) {
      const portaled = useRoomsClientMobileHeaderPortaled(isMobile, host);
      return <span data-testid="portaled">{String(portaled)}</span>;
    }

    const host = document.createElement("div");
    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe isMobile host={host} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("portaled")).toHaveTextContent("true");

    // Hide while mobile changes to desktop, then reveal: reflects latest props.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe isMobile={false} host={host} />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe isMobile={false} host={host} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("portaled")).toHaveTextContent("false");

    // Reveal again with mobile + host enabled.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe isMobile host={host} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("portaled")).toHaveTextContent("true");
  });
});
