import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const agentIdDir = join(here, "..");
// __tests__ → [agentId] → agents → (app) → app → src
const webSrc = join(here, "../../../../../");

/** Dynamic APIs that must not appear in Instant loading shell *code*. */
const DYNAMIC_SHELL_API_RE =
  /\b(?:cookies|headers|draftMode|connection|getTranslations|getFormatter|getLocale|getMessages|getSession)\s*\(/;

function readAgentId(rel: string): string {
  return readFileSync(join(agentIdDir, rel), "utf8");
}

function readWebSrc(rel: string): string {
  return readFileSync(join(webSrc, rel), "utf8");
}

/** Drop comments so doc strings do not false-positive scans. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Brace-depth slice of `export default async function … { … }`.
 */
function extractDefaultAsyncFunction(source: string): string | null {
  const header = source.match(
    /export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{/,
  );
  if (!header || header.index === undefined) return null;
  let depth = 1;
  let i = header.index + header[0].length;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return source.slice(header.index, i);
}

/**
 * Require default export's *only* body statement to be `return <SkeletonName />`.
 */
function assertDefaultReturnsSkeleton(
  source: string,
  skeletonName: string,
): void {
  const code = stripComments(source);
  const pattern = new RegExp(
    String.raw`export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*return\s+<\s*${skeletonName}\s*\/>\s*;?\s*\}`,
  );
  expect(code).toMatch(pattern);
}

describe("agent detail first-paint contract (SOK-781)", () => {
  it("page does not soft-nav opt out of Instant", () => {
    const page = stripComments(readAgentId("page.tsx"));
    expect(page).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
  });

  it("page parallelizes independent Core reads", () => {
    const page = stripComments(readAgentId("page.tsx"));
    const body = extractDefaultAsyncFunction(page);
    expect(body).toBeTruthy();

    // Agent + session must start together (not serial agent-then-session).
    expect(body).toMatch(
      /Promise\.all\s*\(\s*\[[\s\S]*getCoreAgentById[\s\S]*getSession[\s\S]*\]\s*\)/,
    );

    // Second wave: reviews, rating eligibility, and my-review share one Promise.all
    // (serial rating after reviews would still match a looser scan).
    const secondWave = body!.match(
      /Promise\.all\s*\(\s*\[[\s\S]*?getAgentReviews[\s\S]*?\]\s*\)/,
    );
    expect(secondWave).toBeTruthy();
    expect(secondWave![0]).toMatch(/canUserRateAgent/);
    expect(secondWave![0]).toMatch(/getUserRatingForAgent/);
  });

  it("page keeps create-job modal form graph off default first paint", () => {
    const page = stripComments(readAgentId("page.tsx"));
    // Must not statically import the modal shell that pulls the form graph.
    expect(page).not.toMatch(
      /import\s*\{[^}]*\bCreateJobModal\b[^}]*\}\s*from\s*["']@\/components\/create-job-modal["']/,
    );
    expect(page).not.toMatch(
      /import\s+CreateJobModal\s+from\s+["'][^"']*create-job-modal["']/,
    );
    // Context provider stays (hire trigger); modal itself is lazy/open-gated.
    expect(page).toMatch(/CreateJobModalContextProvider/);
    expect(page).toMatch(/LazyCreateJobModal/);
  });

  it("LazyCreateJobModal defers form graph until first open", () => {
    const lazy = stripComments(
      readWebSrc("components/create-job-modal/lazy-create-job-modal.tsx"),
    );
    expect(lazy).toMatch(
      /dynamic\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*["']\.\/create-job-modal["']/,
    );
    expect(lazy).toMatch(/ssr\s*:\s*false/);
    // Open-gated latch (render-time, not useEffect mirror).
    expect(lazy).toMatch(/open\s*&&\s*!hasOpened/);
    expect(lazy).not.toMatch(/useEffect\s*\(/);
  });

  it("route-level loading shell exists and stays sync", () => {
    const loading = stripComments(readAgentId("loading.tsx"));
    expect(loading).not.toMatch(DYNAMIC_SHELL_API_RE);
    assertDefaultReturnsSkeleton(loading, "AgentDetailPageSkeleton");
  });

  it("AgentDetailPageSkeleton stays sync (no cookies/connection/session/i18n)", () => {
    const detailSource = stripComments(
      readWebSrc("components/agents/agent-detail/agent-detail.tsx"),
    );
    expect(detailSource).toMatch(
      /export\s+function\s+AgentDetailPageSkeleton|function\s+AgentDetailPageSkeleton/,
    );
    expect(detailSource).not.toMatch(DYNAMIC_SHELL_API_RE);
  });
});
