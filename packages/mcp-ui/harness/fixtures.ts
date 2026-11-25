import type { McpUiToolResultNotification } from "@modelcontextprotocol/ext-apps/app-bridge";

export interface Fixture {
  input?: Record<string, unknown>;
  /** Left out, the view stays in its loading state. */
  result?: McpUiToolResultNotification["params"];
  cancelled?: boolean;
}

const sokosumi = { sokosumi: { webBaseUrl: "https://app.sokosumi.com" } };

/** Tool results the harness feeds each view, by view id, then by fixture name. */
export const FIXTURES: Record<string, Record<string, Fixture>> = {
  hello: {
    default: {
      input: { name: "Ada Lovelace" },
      result: {
        content: [{ type: "text", text: "Hello, Ada Lovelace" }],
        structuredContent: {
          name: "Ada Lovelace",
          createdAt: "2026-11-25T12:00:00Z",
          url: "https://app.sokosumi.com/tasks/SOK-1",
        },
        _meta: sokosumi,
      },
    },
    loading: { input: { name: "Ada Lovelace" } },
    empty: {
      result: {
        content: [{ type: "text", text: "No name" }],
        structuredContent: { name: "", createdAt: "2026-11-25T12:00:00Z" },
        _meta: sokosumi,
      },
    },
    error: {
      result: {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      },
    },
  },
};
