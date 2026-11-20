import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { flushSync } from "react-dom";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FORMAT_TOOLBAR_OPEN_STORAGE_KEY } from "@/app/chat/utils/format-toolbar-preference-storage";
import { useFormatToolbarOpenPreference } from "./use-format-toolbar-open-preference";

function PassivePhaseMarker({ phases }: { phases: string[] }) {
  useEffect(() => {
    phases.push("passive");
  }, [phases]);

  return null;
}

function Harness() {
  const [open, setOpen] = useFormatToolbarOpenPreference();

  return (
    <div>
      <span data-testid="toolbar-open">{String(open)}</span>
      <button type="button" onClick={() => setOpen(!open)}>
        Toggle
      </button>
    </div>
  );
}

function HydrationTree({ phases }: { phases: string[] }) {
  return (
    <>
      <PassivePhaseMarker phases={phases} />
      <Harness />
    </>
  );
}

describe("useFormatToolbarOpenPreference", () => {
  beforeEach(() => {
    // Give each test a fresh Storage instance so happy-dom's bound getItem
    // on an earlier test's storage never hides a spy in a later test.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new Storage(),
    });
  });

  it("renders closed during SSR for hydration safety", () => {
    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "true");
    const html = renderToString(<Harness />);
    expect(html).toContain(">false<");
  });

  it("hydrates server-rendered HTML and reads a stored open preference before a preceding sibling's passive effect", () => {
    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "true");
    const phases: string[] = [];
    const html = renderToString(<HydrationTree phases={phases} />);
    expect(html).toContain(">false<");
    expect(phases).toEqual([]);

    const storage = window.localStorage;
    const originalGetItem = storage.getItem.bind(storage);
    const getItemSpy = vi
      .spyOn(storage, "getItem")
      .mockImplementation((key: string) => {
        if (key === FORMAT_TOOLBAR_OPEN_STORAGE_KEY) {
          phases.push("read-preference");
        }
        return originalGetItem(key);
      });

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    let root: Root | null = null;

    try {
      // flushSync commits hydration and layout effects synchronously. A
      // useSyncExternalStore or passive useEffect implementation reads the
      // preference only after the preceding sibling's passive effect runs.
      flushSync(() => {
        root = hydrateRoot(host, <HydrationTree phases={phases} />);
      });
      expect(
        host.querySelector('[data-testid="toolbar-open"]')?.textContent,
      ).toBe("true");
      act(() => {});

      const readIndex = phases.indexOf("read-preference");
      const passiveIndex = phases.indexOf("passive");
      expect(readIndex).toBeGreaterThanOrEqual(0);
      expect(passiveIndex).toBeGreaterThanOrEqual(0);
      expect(readIndex).toBeLessThan(passiveIndex);
    } finally {
      getItemSpy.mockRestore();
      if (root) {
        const mountedRoot: Root = root;
        act(() => {
          mountedRoot.unmount();
        });
      }
      host.remove();
    }
  });

  it("defaults to false when nothing is stored and persists updates", () => {
    render(<Harness />);
    expect(screen.getByTestId("toolbar-open")).toHaveTextContent("false");

    act(() => {
      screen.getByRole("button", { name: "Toggle" }).click();
    });
    expect(screen.getByTestId("toolbar-open")).toHaveTextContent("true");
    expect(window.localStorage.getItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY)).toBe(
      "true",
    );

    act(() => {
      screen.getByRole("button", { name: "Toggle" }).click();
    });
    expect(screen.getByTestId("toolbar-open")).toHaveTextContent("false");
    expect(window.localStorage.getItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY)).toBe(
      "false",
    );
  });
});
