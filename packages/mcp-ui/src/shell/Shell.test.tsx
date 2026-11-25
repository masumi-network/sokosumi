import {
  type CallToolRequest,
  type CallToolResult,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiStyles,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Shell, type ViewContext } from "./Shell.tsx";

const Greeting = z.object({ name: z.string() });

interface OpenViewOptions {
  isEmpty?: (data: z.infer<typeof Greeting>) => boolean;
  refreshTool?: string;
  /** Answers the view's `tools/call`; the host then offers `serverTools`. */
  callTool?: (params: CallToolRequest["params"]) => Promise<CallToolResult>;
}

let refresh: ViewContext["refresh"];

/** A fake host: an AppBridge on one end of an in-memory pipe, the view on the other. */
async function openView(
  hostContext: McpUiHostContext = {},
  { isEmpty, refreshTool, callTool }: OpenViewOptions = {},
) {
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {}, ...(callTool && { serverTools: {} }) },
    { hostContext },
  );
  if (callTool) bridge.oncalltool = callTool;
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
    <Shell
      app={app}
      transport={viewSide}
      schema={Greeting}
      isEmpty={isEmpty}
      refreshTool={refreshTool}
    >
      {(data, context) => {
        refresh = context.refresh;
        return (
          <p>
            {data.name} in {context.locale}, {context.timeZone},{" "}
            {context.webBaseUrl ?? "no base"}, {context.displayMode ?? "inline"}
          </p>
        );
      }}
    </Shell>,
  );
  await act(() => initialized);
  return bridge;
}

const state = () =>
  document.querySelector("[data-state]")?.getAttribute("data-state");

const greeting = (name: string) => ({
  content: [{ type: "text" as const, text: name }],
  structuredContent: { name },
});

afterEach(() => {
  cleanup();
  refresh = undefined;
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
      screen.getByText(
        "Ada in de-DE, Europe/Berlin, https://app.sokosumi.com, inline",
      ),
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

  it("passes the host's display mode and follows changes", async () => {
    const bridge = await openView({ displayMode: "inline" });
    await act(() => bridge.sendToolResult(greeting("Ada")));

    await act(() =>
      bridge.sendHostContextChange({ displayMode: "fullscreen" }),
    );

    expect(screen.getByText(/, fullscreen$/)).toBeTruthy();
  });

  // SOKD-415 open item: a host that changes only `theme` keeps the style
  // variables it sent before. Values written with `light-dark()` follow the
  // new `color-scheme`; fixed colours stay those of the old theme.
  it("keeps earlier style variables when the host changes only the theme", async () => {
    const bridge = await openView({
      theme: "light",
      styles: {
        variables: {
          "--color-background-primary": "#ffffff",
          "--color-text-primary": "light-dark(#171717, #fafafa)",
        } as McpUiStyles,
      },
    });
    const root = document.documentElement;

    await act(() => bridge.sendHostContextChange({ theme: "dark" }));

    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--color-background-primary")).toBe(
      "#ffffff",
    );
    expect(root.style.getPropertyValue("--color-text-primary")).toBe(
      "light-dark(#171717, #fafafa)",
    );
  });

  it("refreshes by calling the twin with the tool's input through the host", async () => {
    const callTool = vi.fn(async () => greeting("Grace"));
    const bridge = await openView({}, { refreshTool: "users_get", callTool });
    await act(() =>
      bridge.sendToolInput({ arguments: { id: "me", workspace: "utxo" } }),
    );
    await act(() => bridge.sendToolResult(greeting("Ada")));

    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await refresh?.();
    });

    expect(refreshed).toBe(true);
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "users_get",
        arguments: { id: "me", workspace: "utxo" },
      }),
      expect.anything(),
    );
    expect(screen.getByText(/^Grace in/)).toBeTruthy();
  });

  it("keeps the last result when a refresh fails", async () => {
    const bridge = await openView(
      {},
      {
        refreshTool: "users_get",
        callTool: async () => ({
          content: [{ type: "text", text: "Down" }],
          isError: true,
        }),
      },
    );
    await act(() => bridge.sendToolInput({ arguments: {} }));
    await act(() => bridge.sendToolResult(greeting("Ada")));

    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await refresh?.();
    });

    expect(refreshed).toBe(false);
    expect(state()).toBe("ready");
    expect(screen.getByText(/^Ada in/)).toBeTruthy();
  });

  it("offers no refresh without the tool's input or the host's server tools", async () => {
    const withoutInput = await openView(
      {},
      { refreshTool: "users_get", callTool: async () => greeting("Grace") },
    );
    await act(() => withoutInput.sendToolResult(greeting("Ada")));
    expect(refresh).toBeUndefined();
    cleanup();

    const withoutTools = await openView({}, { refreshTool: "users_get" });
    await act(() => withoutTools.sendToolInput({ arguments: {} }));
    await act(() => withoutTools.sendToolResult(greeting("Ada")));
    expect(refresh).toBeUndefined();
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
    const bridge = await openView({}, { isEmpty: (data) => data.name === "" });

    await act(() =>
      bridge.sendToolResult({ content: [], structuredContent: { name: "" } }),
    );

    expect(state()).toBe("empty");
    expect(screen.getByText("Nothing to show yet")).toBeTruthy();
  });
});
