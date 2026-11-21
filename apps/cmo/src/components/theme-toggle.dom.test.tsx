// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_COOKIE } from "../lib/theme";
import { ThemeToggle } from "./theme-toggle";

function stubColorScheme(initialDark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    setDark(next: boolean) {
      mql.matches = next;
      for (const listener of listeners) listener();
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

describe("ThemeToggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    delete document.documentElement.dataset.theme;
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows system color scheme when no explicit theme is set and updates live", async () => {
    const mql = stubColorScheme(true);

    await act(async () => root.render(<ThemeToggle withLabel />));
    expect(container.querySelector("button")?.textContent).toBe("Light mode");

    await act(async () => {
      mql.setDark(false);
    });
    expect(container.querySelector("button")?.textContent).toBe("Dark mode");
  });

  it("toggles document theme and cookie on click and syncs multiple toggles", async () => {
    stubColorScheme(false);

    await act(async () =>
      root.render(
        <div>
          <ThemeToggle withLabel />
          <ThemeToggle withLabel />
        </div>,
      ),
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]?.textContent).toBe("Dark mode");
    expect(buttons[1]?.textContent).toBe("Dark mode");

    await act(async () => {
      buttons[0]?.click();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(buttons[0]?.textContent).toBe("Light mode");
    expect(buttons[1]?.textContent).toBe("Light mode");
  });
});
