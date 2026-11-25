/**
 * A stand-in MCP Apps host: loads a built view into a sandboxed iframe, the
 * way Claude and ChatGPT do, and feeds it a fixture tool result.
 *
 *   pnpm --filter @sokosumi/mcp-ui build && pnpm --filter @sokosumi/mcp-ui harness
 *   http://localhost:5173/?view=hello&fixture=default&theme=dark
 */
import {
  AppBridge,
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

  const bridge = new AppBridge(
    null,
    { name: "sokosumi-harness", version: "1.0.0" },
    { openLinks: {} },
    {
      hostContext: {
        theme,
        locale: "en-US",
        timeZone: "Europe/Berlin",
        platform: "web",
        displayMode: "inline",
      },
    },
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
  bridge.oninitialized = async () => {
    record(`ui/initialize ${viewId} / ${fixtureName} / ${theme}`);
    if (fixture.input) await bridge.sendToolInput({ arguments: fixture.input });
    if (fixture.result) await bridge.sendToolResult(fixture.result);
    if (fixture.cancelled)
      await bridge.sendToolCancelled({ reason: "harness" });
  };
  await bridge.connect(
    new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
  );
}

main().catch((error: unknown) => record(String(error)));
