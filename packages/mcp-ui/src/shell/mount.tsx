import { App, type McpUiDisplayMode } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { Shell, type ShellProps } from "./Shell.tsx";
import "./styles.css";
import { applyHostTheme } from "./use-view-connection.ts";

/**
 * A view's entry point: one App per view, rendered into `#root`.
 * `displayModes` are the modes the view supports, such as fullscreen.
 */
export function mountView<T>(
  id: string,
  {
    displayModes,
    ...props
  }: Omit<ShellProps<T>, "app" | "transport"> & {
    displayModes?: McpUiDisplayMode[];
  },
): void {
  const container = document.getElementById("root");
  if (!container) throw new Error(`View ${id} has no #root element`);
  applyHostTheme({});
  const app = new App(
    { name: `sokosumi-${id}`, version: "1.0.0" },
    { availableDisplayModes: displayModes },
  );
  createRoot(container).render(<Shell app={app} {...props} />);
}
