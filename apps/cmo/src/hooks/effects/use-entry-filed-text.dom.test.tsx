// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEntryFiledText } from "./use-entry-filed-text";

describe("useEntryFiledText", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Probe({
    entryId,
    filed,
    loadText,
  }: {
    entryId: string;
    filed: boolean;
    loadText?: (entryId: string) => Promise<string | null>;
  }) {
    const text = useEntryFiledText(entryId, filed, loadText);
    return <span data-text={text ?? "null"} />;
  }

  it("loads filed text and clears it when stepping to another entry", async () => {
    const first = Promise.withResolvers<string | null>();
    const second = Promise.withResolvers<string | null>();
    const loadText = vi.fn((id: string) =>
      id === "e-1" ? first.promise : second.promise,
    );

    await act(async () =>
      root.render(<Probe entryId="e-1" filed loadText={loadText} />),
    );
    await act(async () => {
      first.resolve("First article");
      await Promise.resolve();
    });
    expect(container.querySelector("span")?.getAttribute("data-text")).toBe(
      "First article",
    );

    await act(async () =>
      root.render(<Probe entryId="e-2" filed loadText={loadText} />),
    );
    expect(container.querySelector("span")?.getAttribute("data-text")).toBe(
      "null",
    );

    await act(async () => {
      second.resolve("Second article");
      await Promise.resolve();
    });
    expect(container.querySelector("span")?.getAttribute("data-text")).toBe(
      "Second article",
    );
  });
});
