import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MCP_TOOLS, type McpTool, toolsetOf } from "@/lib/sokosumi-mcp/tools";

import apiV1 from "./index.js";

const HTTP_METHODS = ["get", "put", "post", "patch", "delete"] as const;
const MANIFEST_DIR = new URL("../../../agent-surface/", import.meta.url);

const surfaceSchema = z.union([z.string().min(1), z.literal(false)]);

const manifestSchema = z.strictObject({
  backlog: z
    .string()
    .regex(/^SOKD-\d+$/)
    .optional(),
  excluded: z.string().min(1).optional(),
  operations: z
    .record(
      z.string(),
      z.strictObject({
        cli: surfaceSchema.optional(),
        mcp: surfaceSchema.optional(),
        reason: z.string().min(1).optional(),
      }),
    )
    .default({}),
});

type Manifest = z.infer<typeof manifestSchema>;

function operations(doc: {
  paths?: Record<string, object | undefined>;
}): string[] {
  return Object.entries(doc.paths ?? {}).flatMap(([path, item = {}]) =>
    HTTP_METHODS.filter((method) => method in item).map(
      (method) => `${method.toUpperCase()} ${path}`,
    ),
  );
}

function groupOf(operation: string): string {
  return operation.split(" ")[1]?.split("/")[1] ?? "";
}

function agentSurfaceProblems(
  served: readonly string[],
  manifests: ReadonlyMap<string, Manifest>,
): string[] {
  const problems: string[] = [];
  const servedSet = new Set(served);
  const file = (group: string) => `apps/core/agent-surface/${group}.json`;

  for (const [group, manifest] of manifests) {
    if (!served.some((op) => groupOf(op) === group)) {
      problems.push(`${file(group)}: Core serves no /${group} operation.`);
    }
    if (manifest.backlog && manifest.excluded) {
      problems.push(`${file(group)}: set "backlog" or "excluded", not both.`);
    }
    for (const [op, row] of Object.entries(manifest.operations)) {
      const at = `${file(group)} "${op}"`;
      if (!servedSet.has(op) || groupOf(op) !== group) {
        problems.push(`${at}: not a Core operation in this group.`);
      }
      const values = [row.cli, row.mcp];
      if (values.includes(false) !== Boolean(row.reason)) {
        problems.push(`${at}: "reason" goes with, and only with, false.`);
      }
      if (typeof row.cli === "string" && row.mcp === undefined) {
        problems.push(
          `${at}: map "mcp" beside "cli": the tool, or false with a reason.`,
        );
      } else if (values.includes(undefined) && !manifest.backlog) {
        problems.push(`${at}: map both "cli" and "mcp".`);
      }
      if (values.every((value) => value === undefined)) {
        problems.push(`${at}: map "cli" or "mcp".`);
      }
    }
  }

  for (const op of served) {
    const group = groupOf(op);
    const manifest = manifests.get(group);
    if (!manifest) {
      problems.push(`${file(group)}: missing; it must map "${op}".`);
    } else if (
      !(op in manifest.operations) &&
      !manifest.backlog &&
      !manifest.excluded
    ) {
      problems.push(
        `${file(group)}: map "${op}" to a CLI command and an MCP tool, or to false with a reason.`,
      );
    }
  }

  return problems;
}

/**
 * Each manifest `mcp` value is a tool in `MCP_TOOLS` with that operation, and
 * each tool is a manifest row. `tools.surface.test.ts` checks the fixtures.
 */
function mcpBindingProblems(
  manifests: ReadonlyMap<string, Manifest>,
  tools: readonly McpTool[],
): string[] {
  const problems: string[] = [];
  const registry = "src/lib/sokosumi-mcp/tools.ts";
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const [group, manifest] of manifests) {
    for (const [op, { mcp }] of Object.entries(manifest.operations)) {
      if (typeof mcp !== "string") continue;
      const tool = toolsByName.get(mcp);
      const at = `apps/core/agent-surface/${group}.json "${op}"`;
      if (!tool) {
        problems.push(`${at}: add "${mcp}" to MCP_TOOLS in ${registry}.`);
      } else if (tool.operation !== op) {
        problems.push(
          `${at}: "${mcp}" calls ${tool.operation} in ${registry}.`,
        );
      }
    }
  }

  for (const tool of tools) {
    if (!manifests.has(toolsetOf(tool.name))) {
      problems.push(
        `${registry} "${tool.name}": start the name with a route group; it is the toolset.`,
      );
    }
    const row = manifests.get(groupOf(tool.operation))?.operations[
      tool.operation
    ];
    if (row?.mcp !== tool.name) {
      problems.push(
        `${registry} "${tool.name}": map "${tool.operation}" to it in apps/core/agent-surface/${groupOf(tool.operation)}.json.`,
      );
    }
  }

  return problems;
}

function readManifests(): Map<string, Manifest> {
  return new Map(
    readdirSync(MANIFEST_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const parsed = manifestSchema.safeParse(
          JSON.parse(readFileSync(new URL(name, MANIFEST_DIR), "utf8")),
        );
        if (!parsed.success) {
          throw new Error(
            `apps/core/agent-surface/${name}: ${z.prettifyError(parsed.error)}`,
          );
        }
        return [name.slice(0, -".json".length), parsed.data] as const;
      }),
  );
}

const coreDoc = apiV1.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Sokosumi API", version: "1.0.0" },
});

describe("agent surface", () => {
  it("maps every Core operation to the CLI and MCP", () => {
    const problems = agentSurfaceProblems(operations(coreDoc), readManifests());

    expect(
      problems,
      `Fix apps/core/agent-surface/ as docs/agents/agent-surface.md describes:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("binds every MCP tool to its manifest row", () => {
    const problems = mcpBindingProblems(readManifests(), MCP_TOOLS);

    expect(
      problems,
      `Fix as docs/agents/agent-surface.md describes:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  describe("mcpBindingProblems", () => {
    const tool = {
      name: "tasks_list",
      operation: "GET /tasks",
      description: "",
    };
    const manifests = (mcp: string) =>
      new Map([
        [
          "tasks",
          manifestSchema.parse({
            backlog: "SOKD-369",
            operations: { "GET /tasks": { cli: "tasks list", mcp } },
          }),
        ],
      ]);

    it("passes a tool its row names", () => {
      expect(mcpBindingProblems(manifests("tasks_list"), [tool])).toEqual([]);
    });

    it("fails a row whose tool is not registered", () => {
      expect(mcpBindingProblems(manifests("tasks_list"), [])).toEqual([
        'apps/core/agent-surface/tasks.json "GET /tasks": add "tasks_list" to MCP_TOOLS in src/lib/sokosumi-mcp/tools.ts.',
      ]);
    });

    it("fails a tool whose name does not start with a route group", () => {
      expect(
        mcpBindingProblems(
          new Map([
            [
              "tasks",
              manifestSchema.parse({
                backlog: "SOKD-369",
                operations: {
                  "GET /tasks": { cli: "tasks list", mcp: "todo_list" },
                },
              }),
            ],
          ]),
          [{ ...tool, name: "todo_list" }],
        ),
      ).toEqual([
        'src/lib/sokosumi-mcp/tools.ts "todo_list": start the name with a route group; it is the toolset.',
      ]);
    });

    it("fails a tool bound to another operation, and a tool no row names", () => {
      expect(
        mcpBindingProblems(manifests("tasks_list"), [
          { ...tool, operation: "POST /tasks" },
        ]),
      ).toEqual([
        'apps/core/agent-surface/tasks.json "GET /tasks": "tasks_list" calls POST /tasks in src/lib/sokosumi-mcp/tools.ts.',
        'src/lib/sokosumi-mcp/tools.ts "tasks_list": map "POST /tasks" to it in apps/core/agent-surface/tasks.json.',
      ]);
    });
  });

  describe("agentSurfaceProblems", () => {
    const parse = (manifest: unknown) => manifestSchema.parse(manifest);
    const served = ["GET /tasks", "POST /tasks"];

    it("passes a fully mapped group", () => {
      const tasks = parse({
        operations: {
          "GET /tasks": { cli: "tasks list", mcp: "tasks_list" },
          "POST /tasks": {
            cli: "tasks create",
            mcp: false,
            reason: "Example",
          },
        },
      });

      expect(agentSurfaceProblems(served, new Map([["tasks", tasks]]))).toEqual(
        [],
      );
    });

    it("names the file to edit for an unmapped operation", () => {
      const tasks = parse({
        operations: { "GET /tasks": { cli: "tasks list", mcp: "tasks_list" } },
      });

      expect(agentSurfaceProblems(served, new Map([["tasks", tasks]]))).toEqual(
        [
          'apps/core/agent-surface/tasks.json: map "POST /tasks" to a CLI command and an MCP tool, or to false with a reason.',
        ],
      );
    });

    it("names the missing file for a new group", () => {
      expect(agentSurfaceProblems(["GET /tasks"], new Map())).toEqual([
        'apps/core/agent-surface/tasks.json: missing; it must map "GET /tasks".',
      ]);
    });

    it("lets backlog and excluded groups leave operations unlisted", () => {
      const manifests = new Map([
        ["tasks", parse({ backlog: "SOKD-369" })],
        ["admin", parse({ excluded: "Back office" })],
      ]);

      expect(
        agentSurfaceProblems(["GET /tasks", "GET /admin/users"], manifests),
      ).toEqual([]);
    });

    it("fails a stale row and a stale file", () => {
      const manifests = new Map([
        [
          "tasks",
          parse({
            backlog: "SOKD-369",
            operations: {
              "GET /tasks/gone": { cli: "tasks gone", mcp: "tasks_gone" },
            },
          }),
        ],
        ["gone", parse({ excluded: "Removed" })],
      ]);

      expect(agentSurfaceProblems(["GET /tasks"], manifests)).toEqual([
        'apps/core/agent-surface/tasks.json "GET /tasks/gone": not a Core operation in this group.',
        "apps/core/agent-surface/gone.json: Core serves no /gone operation.",
      ]);
    });

    it("fails false without a reason, and a reason without false", () => {
      const tasks = parse({
        operations: {
          "GET /tasks": { cli: "tasks list", mcp: false },
          "POST /tasks": {
            cli: "tasks create",
            mcp: "tasks_create",
            reason: "x",
          },
        },
      });

      expect(agentSurfaceProblems(served, new Map([["tasks", tasks]]))).toEqual(
        [
          'apps/core/agent-surface/tasks.json "GET /tasks": "reason" goes with, and only with, false.',
          'apps/core/agent-surface/tasks.json "POST /tasks": "reason" goes with, and only with, false.',
        ],
      );
    });

    it("leaves the CLI pending only while the group has a backlog", () => {
      const row = { operations: { "GET /tasks": { mcp: "tasks_list" } } };

      expect(
        agentSurfaceProblems(
          ["GET /tasks"],
          new Map([["tasks", parse({ backlog: "SOKD-369", ...row })]]),
        ),
      ).toEqual([]);
      expect(
        agentSurfaceProblems(["GET /tasks"], new Map([["tasks", parse(row)]])),
      ).toEqual([
        'apps/core/agent-surface/tasks.json "GET /tasks": map both "cli" and "mcp".',
      ]);
    });

    it("never leaves MCP pending beside a CLI command", () => {
      const tasks = parse({
        backlog: "SOKD-369",
        operations: { "GET /tasks": { cli: "tasks list" } },
      });

      expect(
        agentSurfaceProblems(["GET /tasks"], new Map([["tasks", tasks]])),
      ).toEqual([
        'apps/core/agent-surface/tasks.json "GET /tasks": map "mcp" beside "cli": the tool, or false with a reason.',
      ]);
    });

    it("rejects unknown keys", () => {
      expect(() => parse({ exclude: "typo" })).toThrow();
    });
  });
});
