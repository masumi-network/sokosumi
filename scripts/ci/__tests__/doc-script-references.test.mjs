import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * Directories whose Markdown is not instructions for this repo: dependencies,
 * build output, generated clients, and third-party skills we do not author.
 */
const SKIP_DIRECTORIES = new Set([
  ".agents", // third-party skills; they document their own repos, not this one
  ".git",
  ".next",
  ".turbo",
  "dist",
  "generated",
  "node_modules",
]);

/**
 * pnpm's own verbs. `pnpm <verb>` runs the CLI, not a workspace script, so
 * these never need a `scripts` entry to be valid.
 */
const PNPM_BUILTINS = new Set([
  "add",
  "approve-builds",
  "audit",
  "create",
  "dedupe",
  "deploy",
  "dlx",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "licenses",
  "link",
  "list",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "setup",
  "store",
  "test",
  "unlink",
  "up",
  "update",
  "why",
]);

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(
        ...(await collectMarkdownFiles(path.join(directory, entry.name))),
      );
      continue;
    }
    if (entry.name.endsWith(".md") || entry.name.endsWith(".mdc")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

async function readScriptNames(manifest) {
  try {
    return new Set(
      Object.keys(JSON.parse(await readFile(manifest, "utf8")).scripts ?? {}),
    );
  } catch {
    return new Set(); // not every directory carries a manifest
  }
}

/**
 * Scripts by workspace directory (`""` is the repo root), so a doc can be
 * checked against the package it lives in rather than the union of every
 * manifest. The union hides the drift that matters: `pnpm run build` inside
 * `packages/database/` is stale once that package drops its `build`, even
 * though the root still defines one.
 */
async function collectScriptsByWorkspace() {
  const byWorkspace = new Map([
    ["", await readScriptNames(path.join(repoRoot, "package.json"))],
  ]);
  for (const group of ["apps", "packages"]) {
    const groupPath = path.join(repoRoot, group);
    for (const entry of await readdir(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = `${group}/${entry.name}`;
      byWorkspace.set(
        relative,
        await readScriptNames(path.join(groupPath, entry.name, "package.json")),
      );
    }
  }
  return byWorkspace;
}

/** The workspace directory a doc lives in, or `""` when it sits above them. */
function owningWorkspace(relativeFile, byWorkspace) {
  for (const workspace of byWorkspace.keys()) {
    if (workspace !== "" && relativeFile.startsWith(`${workspace}/`))
      return workspace;
  }
  return "";
}

/**
 * `pnpm run <script>`, `pnpm <script>`, and `pnpm --filter <pkg> <script>`.
 * Script names may carry hyphens and colons (`cloud-agent-db:provision`).
 */
const PNPM_INVOCATION =
  /\bpnpm\s+((?:--filter|-F)\s+\S+\s+)?(run\s+)?([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)(:?<)?/g;

/** An inline `code span` or the body of a ``` fenced block. */
const CODE_SPAN = /`([^`\n]+)`|```[^\n]*\n([\s\S]*?)```/g;

/**
 * Commands a doc actually tells someone to run, i.e. those inside code. Prose
 * that merely says "pnpm remains the package manager" is not an invocation,
 * and matching it produced nothing but noise.
 */
function* codeSpans(contents) {
  for (const match of contents.matchAll(CODE_SPAN)) {
    const body = match[1] ?? match[2];
    const offset = match.index + match[0].indexOf(body);
    yield { body, line: contents.slice(0, offset).split("\n").length };
  }
}

describe("docs reference scripts that exist", () => {
  it("names no pnpm script the workspace does not define", async () => {
    const [markdownFiles, byWorkspace] = await Promise.all([
      collectMarkdownFiles(repoRoot),
      collectScriptsByWorkspace(),
    ]);
    const unknown = [];
    for (const file of markdownFiles) {
      const relativeFile = path.relative(repoRoot, file);
      const workspace = owningWorkspace(relativeFile, byWorkspace);
      const localScripts = byWorkspace.get(workspace);
      const basename = path.basename(relativeFile);
      const ownsManifest =
        workspace !== "" &&
        relativeFile === `${workspace}/${basename}` &&
        (basename === "README.md" || basename === "AGENTS.md");
      const contents = await readFile(file, "utf8");

      for (const { body, line } of codeSpans(contents)) {
        for (const match of body.matchAll(PNPM_INVOCATION)) {
          const [, filtered, explicitRun, script, template] = match;
          // `pnpm data-migration:<name>` is a template, not a command.
          if (template) continue;
          if (script === "run") continue; // bare `pnpm run`, describing the CLI
          if (PNPM_BUILTINS.has(script)) continue;

          // `pnpm run <script>` in a package's own README/AGENTS.md means that
          // package's script — the one form specific enough to resolve, and
          // where stale build instructions actually accumulate. Every other
          // form (a bare alias, a `--filter`, a doc under `docs/`) may
          // legitimately name any workspace's script, so it gets the union.
          const scoped = !filtered && explicitRun && ownsManifest;
          const scope = scoped
            ? localScripts
            : new Set([...byWorkspace.values()].flatMap((names) => [...names]));
          if (scope.has(script)) continue;

          unknown.push(
            scoped
              ? `${relativeFile}:${line} → pnpm run ${script} (not a script in ${workspace})`
              : `${relativeFile}:${line} → pnpm ${script}`,
          );
        }
      }
    }

    assert.deepEqual(
      unknown,
      [],
      `Docs name pnpm scripts that no workspace defines. Update the doc so it names a live script:\n${unknown.join("\n")}`,
    );
  });
});
