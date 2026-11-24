import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useRoomsClientMobileHeaderPortaled } from "./use-rooms-client-mobile-header-portaled";

describe("useRoomsClientMobileHeaderPortaled", () => {
  it("commits false for the first painted frame and portals only in passive effect phase when mobile and host are present", () => {
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

    const slotHost = document.createElement("div");
    const mountHost = document.createElement("div");
    document.body.append(mountHost);
    const root = createRoot(mountHost);
    try {
      // flushSync inside act commits render + all useLayoutEffects (including
      // layout-phase state updates) while passive useEffects wait until act()
      // exits. A layout-phase or render-time swap would already paint "true".
      let paintedBeforePassive = "";
      act(() => {
        flushSync(() => {
          root.render(<Probe isMobile host={slotHost} />);
        });
        paintedBeforePassive = mountHost.textContent ?? "";
      });
      expect(paintedBeforePassive).toBe("false");
      expect(mountHost.textContent).toBe("true");

      // Leaving mobile viewport turns the portal off.
      act(() => {
        root.render(<Probe isMobile={false} host={slotHost} />);
      });
      expect(mountHost.textContent).toBe("false");

      // Returning to mobile with no host keeps it off; attaching host turns it on.
      act(() => {
        root.render(<Probe isMobile host={null} />);
      });
      expect(mountHost.textContent).toBe("false");

      act(() => {
        root.render(<Probe isMobile host={slotHost} />);
      });
      expect(mountHost.textContent).toBe("true");

      // Unresolved media query (undefined) turns the portal off.
      act(() => {
        root.render(<Probe isMobile={undefined} host={slotHost} />);
      });
      expect(mountHost.textContent).toBe("false");
    } finally {
      act(() => {
        root.unmount();
      });
      mountHost.remove();
    }
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
