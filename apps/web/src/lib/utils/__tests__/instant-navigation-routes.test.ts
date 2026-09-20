import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../app",
);

/**
 * With `cacheComponents` and `partialPrefetching` on, a route that reads
 * `params` or `searchParams` above its own `<Suspense>` cannot produce a
 * static shell, so Next reports `instant-shell-url-data` on every navigation.
 * Each such route needs a decision: block on purpose with
 * `export const instant = false`, or hand the promise to a Suspense-wrapped
 * child so the shell stays URL-independent.
 *
 * `instant` is read per segment. A layout's `instant = false` makes the route
 * allowed to block, but it does NOT cover the pages beneath it for URL-data
 * validation — that asymmetry is deliberate (it is what lets a blocking
 * layout host instant pages), so each page repeats the export.
 *
 * This guard keys on the PROP DECLARATION, not on how the promise is later
 * awaited. An earlier sweep grepped for `await params` / `await searchParams`
 * and silently missed `await Promise.all([params, searchParams])` and a
 * promise handed to a helper (`await getRedirectQueryString(searchParams)`),
 * which left five blocking pages without an opt-out.
 */
const URL_DATA_PROP = /(?:^|[\s,{(])(?:params|searchParams)\s*:\s*Promise</m;

/**
 * The page export forwards its URL-data promise into a Suspense-wrapped
 * child, so the shell above the boundary reads nothing from the URL. These
 * are the shape the worklist below is migrating toward; see
 * `(app)/tasks/(root)/page.tsx` for the reference implementation.
 */
const SUSPENSE_WRAPPED = new Set([
  "(app)/admin/enterprise-contracts/page.tsx",
  "(app)/agents/[agentId]/jobs/layout.tsx",
  "(app)/chat/rooms/[roomId]/page.tsx",
  "(app)/projects/(root)/page.tsx",
  "(app)/tasks/(root)/page.tsx",
]);

/**
 * In-app destinations that still read URL data above their boundary. These
 * are where an App Shell actually pays off, so they want the Suspense
 * treatment rather than an opt-out — follow
 * `apps/web/.claude/skills/next-partial-prefetching-adoption` step 5, feature
 * by feature, and delete each entry as it moves to SUSPENSE_WRAPPED.
 *
 * Shrink this list. Do not add to it: a new route picks a side on day one.
 */
const INSTANT_WORKLIST = new Set([
  "(app)/(welcome)/page.tsx",
  "(app)/agents/[agentId]/jobs/@modal/[jobId]/page.tsx",
  "(app)/agents/[agentId]/jobs/@right/[jobId]/page.tsx",
  "(app)/agents/[agentId]/jobs/@right/page.tsx",
  "(app)/agents/[agentId]/layout.tsx",
  "(app)/agents/[agentId]/page.tsx",
  "(app)/billing/page.tsx",
  "(app)/calendar/page.tsx",
  "(app)/chat/invites/[id]/page.tsx",
  "(app)/chat/join/[token]/page.tsx",
  "(app)/chat/page.tsx",
  "(app)/connections/page.tsx",
  "(app)/developer/coworkers/[id]/page.tsx",
  "(app)/developer/page.tsx",
  "(app)/developer/tasks/[taskId]/page.tsx",
  "(app)/developer/vendors/[id]/page.tsx",
  "(app)/history/page.tsx",
  "(app)/organizations/[organizationSlug]/design-md/edit/page.tsx",
  "(app)/organizations/[organizationSlug]/page.tsx",
  "(app)/projects/[projectId]/@modal/(.)edit/page.tsx",
  "(app)/projects/[projectId]/calendar/page.tsx",
  "(app)/projects/[projectId]/design-md/edit/page.tsx",
  "(app)/projects/[projectId]/edit/page.tsx",
  "(app)/projects/[projectId]/layout.tsx",
  "(app)/projects/[projectId]/page.tsx",
  "(app)/tasks/[taskId]/@modal/(.)edit/page.tsx",
  "(app)/tasks/[taskId]/edit/page.tsx",
  "(app)/tasks/[taskId]/page.tsx",
]);

const ROUTE_FILES = new Set(["page.tsx", "layout.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (ROUTE_FILES.has(name)) out.push(full);
  }
  return out;
}

interface RouteFile {
  rel: string;
  readsUrlData: boolean;
  optsOut: boolean;
}

function routeFiles(): RouteFile[] {
  return walk(APP_ROOT).map((full) => {
    const source = readFileSync(full, "utf8");
    return {
      rel: path.relative(APP_ROOT, full).split(path.sep).join("/"),
      readsUrlData: URL_DATA_PROP.test(source),
      optsOut: /^export const instant\s*=\s*false/m.test(source),
    };
  });
}

describe("instant navigation routes", () => {
  it("gives every route that reads URL data a decision", () => {
    const undecided = routeFiles()
      .filter(
        (file) =>
          file.readsUrlData &&
          !file.optsOut &&
          !SUSPENSE_WRAPPED.has(file.rel) &&
          !INSTANT_WORKLIST.has(file.rel),
      )
      .map((file) => file.rel);

    expect(undecided).toEqual([]);
  });

  it("keeps the worklist free of routes that no longer belong on it", () => {
    const files = routeFiles();
    const byRel = new Map(files.map((file) => [file.rel, file]));
    const stale: string[] = [];

    for (const rel of [...SUSPENSE_WRAPPED, ...INSTANT_WORKLIST]) {
      const file = byRel.get(rel);
      if (!file) {
        stale.push(`${rel}: listed but no longer a route file`);
        continue;
      }
      if (!file.readsUrlData) {
        stale.push(`${rel}: listed but no longer reads params/searchParams`);
        continue;
      }
      if (file.optsOut) {
        stale.push(`${rel}: listed but now exports instant = false`);
      }
    }

    expect(stale).toEqual([]);
  });
});
