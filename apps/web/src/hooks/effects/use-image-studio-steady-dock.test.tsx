import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useImageStudioSteadyDock } from "./use-image-studio-steady-dock";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function DockProbe({
  floating,
  dockHeight,
  promptHeight,
  promptMinHeight,
}: {
  floating: boolean;
  dockHeight: number;
  promptHeight: number;
  promptMinHeight: string;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { slotRef, dockRef } = useImageStudioSteadyDock(promptRef, floating);

  return (
    <div>
      <div data-testid="slot" ref={slotRef} />
      <div
        data-testid="dock"
        ref={(node) => {
          dockRef.current = node;
          if (node) {
            Object.defineProperty(node, "offsetHeight", {
              configurable: true,
              value: dockHeight,
            });
          }
        }}
      >
        <textarea
          ref={(node) => {
            promptRef.current = node;
            if (node) {
              Object.defineProperty(node, "offsetHeight", {
                configurable: true,
                value: promptHeight,
              });
              node.style.minHeight = promptMinHeight;
            }
          }}
        />
      </div>
    </div>
  );
}

describe("useImageStudioSteadyDock", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("syncs slot height excluding prompt growth, updates on resize, clears when floating, and disconnects on unmount", () => {
    const { getByTestId, rerender, unmount } = render(
      <DockProbe
        dockHeight={140}
        floating={false}
        promptHeight={72}
        promptMinHeight="40px"
      />,
    );

    const slot = getByTestId("slot");
    const dock = getByTestId("dock");
    expect(slot.style.height).toBe("108px");
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.observed).toEqual([dock]);

    Object.defineProperty(dock, "offsetHeight", {
      configurable: true,
      value: 160,
    });
    FakeResizeObserver.instances[0]?.trigger();
    expect(slot.style.height).toBe("128px");

    rerender(
      <DockProbe
        dockHeight={160}
        floating={true}
        promptHeight={72}
        promptMinHeight="40px"
      />,
    );
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    expect(slot.style.height).toBe("");

    rerender(
      <DockProbe
        dockHeight={120}
        floating={false}
        promptHeight={40}
        promptMinHeight="40px"
      />,
    );
    expect(slot.style.height).toBe("120px");
    expect(FakeResizeObserver.instances).toHaveLength(2);

    unmount();
    expect(FakeResizeObserver.instances[1]?.disconnected).toBe(true);
  });
});
