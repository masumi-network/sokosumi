import { InMemoryTransport } from "@modelcontextprotocol/client";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiStyles,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Shell } from "./Shell.tsx";

const Greeting = z.object({ name: z.string() });

/** A fake host: an AppBridge on one end of an in-memory pipe, the view on the other. */
async function openView(
  hostContext: McpUiHostContext = {},
  isEmpty?: (data: z.infer<typeof Greeting>) => boolean,
) {
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {} },
    { hostContext },
  );
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(hostSide);

  const app = new App(
    { name: "test-view", version: "1.0.0" },
    {},
    { autoResize: false },
  );
  render(
    <Shell app={app} transport={viewSide} schema={Greeting} isEmpty={isEmpty}>
      {(data, context) => (
        <p>
          {data.name} in {context.locale}, {context.timeZone},{" "}
          {context.webBaseUrl ?? "no base"}
        </p>
      )}
    </Shell>,
  );
  await act(() => initialized);
  return bridge;
}

const state = () =>
  document.querySelector("[data-state]")?.getAttribute("data-state");

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("Shell", () => {
  it("shows a skeleton until the tool result arrives", async () => {
    await openView();

    expect(state()).toBe("loading");
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("renders the view with the result and the host context", async () => {
    const bridge = await openView({
      locale: "de-DE",
      timeZone: "Europe/Berlin",
    });

    await act(() =>
      bridge.sendToolResult({
        content: [{ type: "text", text: "Ada" }],
        structuredContent: { name: "Ada" },
        _meta: { sokosumi: { webBaseUrl: "https://app.sokosumi.com" } },
      }),
    );

    expect(state()).toBe("ready");
    expect(
      screen.getByText("Ada in de-DE, Europe/Berlin, https://app.sokosumi.com"),
    ).toBeTruthy();
  });

  it("applies the host theme and style variables, then follows changes", async () => {
    const bridge = await openView({
      theme: "dark",
      // A host may send only some variables; the SDK types all of them.
      styles: {
        variables: { "--color-background-primary": "#101010" } as McpUiStyles,
      },
    });

    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--color-background-primary")).toBe(
      "#101010",
    );

    await act(() => bridge.sendHostContextChange({ theme: "light" }));
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("shows the error state for an error result", async () => {
    const bridge = await openView();

    await act(() =>
      bridge.sendToolResult({
        content: [{ type: "text", text: "Not found" }],
        isError: true,
      }),
    );

    expect(state()).toBe("error");
    expect(screen.getByText("This view could not load")).toBeTruthy();
    expect(screen.queryByText("Not found")).toBeNull();
  });

  it("shows the error state when the result does not match the view", async () => {
    const bridge = await openView();

    await act(() =>
      bridge.sendToolResult({ content: [], structuredContent: { name: 1 } }),
    );

    expect(state()).toBe("error");
  });

  it("shows the error state when the host cancels the call", async () => {
    const bridge = await openView();

    await act(() => bridge.sendToolCancelled({ reason: "user" }));

    expect(state()).toBe("error");
  });

  it("shows the empty state when the view says the data is empty", async () => {
    const bridge = await openView({}, (data) => data.name === "");

    await act(() =>
      bridge.sendToolResult({ content: [], structuredContent: { name: "" } }),
    );

    expect(state()).toBe("empty");
    expect(screen.getByText("Nothing to show yet")).toBeTruthy();
  });
});
