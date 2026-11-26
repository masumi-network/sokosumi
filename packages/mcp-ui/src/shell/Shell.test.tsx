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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
let missingTool: ViewContext["missingTool"];
let refreshStatus: ViewContext["refreshStatus"];
const links = vi.fn();

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
  bridge.onopenlink = async ({ url }) => {
    links(url);
    return {};
  };
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
        missingTool = context.missingTool;
        refreshStatus = context.refreshStatus;
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
  missingTool = undefined;
  refreshStatus = undefined;
  links.mockReset();
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

  // SOKD-475: Sokosumi's style in every host. Only light or dark follows
  // the host; its colours and fonts are ignored.
  it("follows the host's theme and ignores its style variables and fonts", async () => {
    const bridge = await openView({
      theme: "dark",
      // A host may send only some variables; the SDK types all of them.
      styles: {
        variables: {
          "--color-background-primary": "#101010",
          "--font-sans": "Georgia",
        } as McpUiStyles,
        css: {
          fonts: "@font-face { font-family: Host; src: local(Georgia); }",
        },
      },
    });

    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--color-background-primary")).toBe("");
    expect(root.style.getPropertyValue("--font-sans")).toBe("");
    expect(document.querySelectorAll("style").length).toBe(0);

    await act(() => bridge.sendHostContextChange({ theme: "light" }));
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("passes the host's display mode and follows changes", async () => {
    const bridge = await openView({ displayMode: "inline" });
    await act(() => bridge.sendToolResult(greeting("Ada")));

    await act(() =>
      bridge.sendHostContextChange({ displayMode: "fullscreen" }),
    );

    expect(screen.getByText(/, fullscreen$/)).toBeTruthy();
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

  it.each([
    [
      "the call",
      async () => {
        throw new Error("MCP error -32602: Unknown tool: users_get");
      },
    ],
    [
      "an error result",
      async () => ({
        content: [{ type: "text" as const, text: "Unknown tool: users_get" }],
        isError: true,
      }),
    ],
  ])(
    "names the refresh tool when the server does not offer it, from %s",
    async (_, callTool) => {
      const bridge = await openView({}, { refreshTool: "users_get", callTool });
      await act(() => bridge.sendToolInput({ arguments: {} }));
      await act(() => bridge.sendToolResult(greeting("Ada")));
      expect(missingTool).toBeUndefined();

      let refreshed: boolean | undefined;
      await act(async () => {
        refreshed = await refresh?.();
      });

      expect(refreshed).toBe(false);
      expect(missingTool).toBe("users_get");
      expect(screen.getByText(/^Ada in/)).toBeTruthy();
    },
  );

  it.each([
    ["a network error", new Error("Network down")],
    ["another tool", new Error("MCP error -32602: Unknown tool: users_list")],
  ])("does not name a tool for %s", async (_, failure) => {
    const bridge = await openView(
      {},
      {
        refreshTool: "users_get",
        callTool: async () => {
          throw failure;
        },
      },
    );
    await act(() => bridge.sendToolInput({ arguments: {} }));
    await act(() => bridge.sendToolResult(greeting("Ada")));
    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await refresh?.();
    });

    expect(refreshed).toBe(false);
    expect(missingTool).toBeUndefined();
  });

  it("keeps the status of a refresh's error result until a refresh succeeds", async () => {
    const answers = [
      {
        content: [{ type: "text" as const, text: "{}" }],
        structuredContent: { status: 404, message: "Not found" },
        isError: true,
      },
      greeting("Grace"),
    ];
    const bridge = await openView(
      {},
      {
        refreshTool: "users_get",
        callTool: async () => answers.shift() ?? greeting("Grace"),
      },
    );
    await act(() => bridge.sendToolInput({ arguments: {} }));
    await act(() => bridge.sendToolResult(greeting("Ada")));
    expect(refreshStatus).toBeUndefined();

    await act(async () => {
      await refresh?.();
    });
    expect(refreshStatus).toBe(404);
    expect(screen.getByText(/^Ada in/)).toBeTruthy();

    await act(async () => {
      await refresh?.();
    });
    expect(refreshStatus).toBeUndefined();
    expect(screen.getByText(/^Grace in/)).toBeTruthy();
  });

  it("does not take record text in an error result for a missing tool", async () => {
    const bridge = await openView(
      {},
      {
        refreshTool: "users_get",
        callTool: async () => ({
          content: [
            {
              type: "text",
              text: '{"status":400,"message":"Unknown tool: users_get is not a name"}',
            },
          ],
          isError: true,
        }),
      },
    );
    await act(() => bridge.sendToolInput({ arguments: {} }));
    await act(() => bridge.sendToolResult(greeting("Ada")));
    await act(async () => {
      await refresh?.();
    });

    expect(missingTool).toBeUndefined();
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

  it("sends a person to Sokosumi when only a person may take the step", async () => {
    const bridge = await openView();
    const webUrl = "https://app.sokosumi.com/tasks/0196a000";

    await act(() =>
      bridge.sendToolResult({
        content: [{ type: "text", text: "A person approves this" }],
        structuredContent: {
          status: 403,
          kind: "person_approval_required",
          message: "A person approves this in Sokosumi",
          details: { webUrl },
        },
        isError: true,
        _meta: { sokosumi: { webBaseUrl: "https://app.sokosumi.com" } },
      }),
    );

    expect(state()).toBe("approval");
    expect(screen.getByText("A person decides this in Sokosumi")).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Review in Sokosumi" }),
      ),
    );
    expect(links).toHaveBeenCalledWith(webUrl);
  });

  it("offers no link for a person's step outside the Web base URL", async () => {
    const bridge = await openView();

    await act(() =>
      bridge.sendToolResult({
        content: [],
        structuredContent: {
          kind: "person_approval_required",
          details: { webUrl: "https://evil.example/tasks/1" },
        },
        isError: true,
        _meta: { sokosumi: { webBaseUrl: "https://app.sokosumi.com" } },
      }),
    );

    expect(state()).toBe("approval");
    expect(
      screen.queryByRole("button", { name: "Review in Sokosumi" }),
    ).toBeNull();
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
