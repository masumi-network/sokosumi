/**
 * A stand-in MCP Apps host: loads a built view into a sandboxed iframe, the
 * way Claude and ChatGPT do, and feeds it a fixture tool result.
 *
 *   pnpm --filter @sokosumi/mcp-ui build && pnpm --filter @sokosumi/mcp-ui harness
 *   http://localhost:5173/?view=hello&fixture=default&theme=dark
 *
 * `&styles=fixed` sends host style variables in fixed colours, and
 * `&styles=light-dark` in `light-dark()`. `&retheme` then switches the theme
 * with a theme-only host-context change, as some hosts do.
 */
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiStyles,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { FIXTURES } from "./fixtures.ts";

const builtViews = import.meta.glob<string>("../dist/views/*.html", {
  query: "?raw",
  import: "default",
});

const params = new URLSearchParams(location.search);
const viewId = params.get("view") ?? "hello";
const fixtureName = params.get("fixture") ?? "default";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const STYLES: Record<string, McpUiStyles> = {
  fixed: {
    "--color-background-primary": "#ffffff",
    "--color-text-primary": "#171717",
  } as McpUiStyles,
  "light-dark": {
    "--color-background-primary": "light-dark(#ffffff, #0c0c0c)",
    "--color-text-primary": "light-dark(#171717, #fafafa)",
  } as McpUiStyles,
};
const styles = STYLES[params.get("styles") ?? ""];
const log = document.getElementById("log");

function record(line: string) {
  const item = document.createElement("li");
  item.textContent = line;
  log?.append(item);
}

async function main() {
  const loadView = builtViews[`../dist/views/${viewId}.html`];
  const fixture = FIXTURES[viewId]?.[fixtureName];
  if (!loadView || !fixture) {
    record(
      `No built view "${viewId}" or fixture "${fixtureName}". Run the build first.`,
    );
    return;
  }
  document.documentElement.dataset.theme = theme;

  const iframe = document.createElement("iframe");
  iframe.title = `${viewId} view`;
  // No allow-same-origin: the view runs in an opaque origin, as in real hosts.
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = await loadView();
  document.body.prepend(iframe);
  if (!iframe.contentWindow) throw new Error("The iframe has no window");

  let hostContext: McpUiHostContext = {
    theme,
    ...(styles && { styles: { variables: styles } }),
    locale: "en-US",
    timeZone: "Europe/Berlin",
    platform: "web",
    displayMode: "inline",
    availableDisplayModes: ["inline", "fullscreen"],
    ...fixture.host,
  };
  const bridge = new AppBridge(
    null,
    { name: "sokosumi-harness", version: "1.0.0" },
    { openLinks: {}, serverTools: {}, updateModelContext: { text: {} } },
    { hostContext },
  );
  bridge.onsizechange = ({ height }) => {
    if (height === undefined) return;
    iframe.style.height = `${height}px`;
    iframe.dataset.sized = "true";
  };
  bridge.onopenlink = async ({ url }) => {
    record(`ui/open-link ${url}`);
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    record(`ui/request-display-mode ${mode}`);
    hostContext = { ...hostContext, displayMode: mode };
    bridge.setHostContext(hostContext);
    return { mode };
  };
  bridge.onupdatemodelcontext = async ({ content }) => {
    record(`ui/update-model-context ${JSON.stringify(content)}`);
    return {};
  };
  // Refresh: the host runs the tool on the server; here it returns the fixture.
  bridge.oncalltool = async ({ name, arguments: args }) => {
    record(`tools/call ${name} ${JSON.stringify(args)}`);
    if (fixture.callError) throw new Error(fixture.callError);
    if (!fixture.result) throw new Error("The fixture has no result");
    return fixture.result;
  };
  bridge.oninitialized = async () => {
    record(`ui/initialize ${viewId} / ${fixtureName} / ${theme}`);
    if (fixture.input) await bridge.sendToolInput({ arguments: fixture.input });
    if (fixture.result) await bridge.sendToolResult(fixture.result);
    if (fixture.cancelled)
      await bridge.sendToolCancelled({ reason: "harness" });
    if (params.has("retheme")) {
      const next = theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      hostContext = { ...hostContext, theme: next };
      await bridge.sendHostContextChange({ theme: next });
      record(`host-context-changed theme=${next} only`);
    }
  };
  await bridge.connect(
    new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
  );
}

main().catch((error: unknown) => record(String(error)));
