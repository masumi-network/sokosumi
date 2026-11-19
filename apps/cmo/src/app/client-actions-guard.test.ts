import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `actions` home.tsx hands to the client app cross the server/client
 * boundary, and Next passes only server action references. An inline
 * `() => requestStrategy(projectId)` (#7677) type-checked, passed every test
 * and broke every signed-in page on app.cmo.xyz; `requestStrategy.bind(null,
 * projectId)` (#7680) is a reference. This reads the source, since only a
 * real Next server render enforces the rule.
 */

const APP = join(import.meta.dirname);
const HOME = readFileSync(join(APP, "home.tsx"), "utf8");

/** Names home.tsx imports from a module that starts with "use server". */
function serverActionNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*"(\.\/[^"]+)"/g,
  )) {
    const file = join(APP, `${match[2]}.ts`);
    if (!existsSync(file)) continue;
    if (!readFileSync(file, "utf8").trimStart().startsWith('"use server"'))
      continue;
    for (const name of match[1].split(",")) {
      const local = name
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (local) names.add(local);
    }
  }
  return names;
}

/** The text of each `actions={{ ... }}` object, braces matched. */
function actionObjects(source: string): string[] {
  const objects: string[] = [];
  let from = source.indexOf("actions={{");
  while (from !== -1) {
    const start = from + "actions={".length;
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      if (depth === 0) break;
    }
    objects.push(
      source
        .slice(start + 1, end)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""),
    );
    from = source.indexOf("actions={{", end);
  }
  return objects;
}

/** Top-level `key: value` entries of an object body. */
function entries(body: string): { key: string; value: string }[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if ("({[".includes(char)) depth += 1;
    if (")}]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(":");
      return colon === -1
        ? { key: part, value: part }
        : {
            key: part.slice(0, colon).trim(),
            value: part.slice(colon + 1).trim(),
          };
    });
}

/** Why a value cannot cross to the client, or null when it can. */
function problem(value: string, actions: Set<string>): string | null {
  if (value.startsWith("{") && value.endsWith("}")) {
    for (const entry of entries(value.slice(1, -1))) {
      const inner = problem(entry.value, actions);
      if (inner) return `${entry.key}: ${inner}`;
    }
    return null;
  }
  const reference =
    /^(\w+)(?:\.bind\(null(?:,\s*(?:[\w.]+|"[^"]*"))*\))?$/.exec(value);
  if (!reference) return `"${value}" is not a server action reference`;
  if (!actions.has(reference[1]))
    return `${reference[1]} is not imported from a "use server" module`;
  return null;
}

describe("actions passed to the client app", () => {
  const actions = serverActionNames(HOME);
  const objects = actionObjects(HOME);

  it("finds the app's and onboarding's actions", () => {
    expect(objects.length).toBeGreaterThanOrEqual(2);
    expect(actions.has("requestStrategy")).toBe(true);
  });

  it("are all server action references, never inline functions", () => {
    const problems = objects.flatMap((body) =>
      entries(body).flatMap(({ key, value }) => {
        const found = problem(value, actions);
        return found ? [`${key}: ${found}`] : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("would refuse the arrow that broke the app", () => {
    expect(
      problem("() => requestStrategy(projectId)", new Set(["requestStrategy"])),
    ).not.toBeNull();
    expect(
      problem(
        "requestStrategy.bind(null, projectId)",
        new Set(["requestStrategy"]),
      ),
    ).toBeNull();
  });
});
