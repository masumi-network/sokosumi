import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sentry/report-route-error", () => ({
  reportRouteError: vi.fn(),
  shouldReportRouteError: () => true,
}));

vi.mock("@/lib/utils/deployment-refresh", () => ({
  hasDeploymentRefreshGuard: () => false,
  isStaleDeploymentError: () => false,
  performDeploymentRefresh: vi.fn(),
}));

import GlobalError from "./global-error";

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

describe("GlobalError theme", () => {
  let doc: Document;
  let root: Root | null = null;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument();
    localStorage.clear();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderError() {
    root = createRoot(doc);
    await act(async () => {
      root?.render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    });
  }

  it("follows prefers-color-scheme when no stored theme is set and updates live", async () => {
    const mql = stubColorScheme(true);
    await renderError();
    expect(doc.body.style.background).toBe("#0c0c0c");
    expect(doc.body.style.color).toBe("#fff");

    await act(async () => {
      mql.setDark(false);
    });
    expect(doc.body.style.background).toBe("#fff");
    expect(doc.body.style.color).toBe("#000");
  });

  it("honors explicit light and dark themes stored in localStorage", async () => {
    stubColorScheme(true);
    localStorage.setItem("theme", "light");
    await renderError();
    expect(doc.body.style.background).toBe("#fff");
    expect(doc.body.style.color).toBe("#000");
  });

  it("leaves body style unset when localStorage throws", async () => {
    stubColorScheme(true);
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      clear() {},
    });
    await renderError();
    expect(doc.body.getAttribute("style")).toBeNull();
  });
});
