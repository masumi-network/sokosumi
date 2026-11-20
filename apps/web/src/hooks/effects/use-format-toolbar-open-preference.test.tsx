import { act, render, screen } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { FORMAT_TOOLBAR_OPEN_STORAGE_KEY } from "@/app/chat/utils/format-toolbar-preference-storage";
import { useFormatToolbarOpenPreference } from "./use-format-toolbar-open-preference";

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

describe("useFormatToolbarOpenPreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders closed during SSR for hydration safety", () => {
    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "true");
    const html = renderToString(<Harness />);
    expect(html).toContain(">false<");
  });

  it("applies a stored open preference synchronously before paint", () => {
    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "true");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
      // flushSync runs render + layout effects synchronously without flushing
      // passive effects, matching the DOM state before browser paint.
      flushSync(() => {
        root.render(<Harness />);
      });
      expect(
        host.querySelector('[data-testid="toolbar-open"]')?.textContent,
      ).toBe("true");
    } finally {
      act(() => {
        root.unmount();
      });
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
