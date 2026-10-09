// What is open, stale and next in apps/apple/PARITY.md, read from origin/main.
// Read-only: fetches main and queries GitHub with `gh`; never switches branches.
// Run from the repository root: node apps/apple/scripts/parity-status.mjs [--ref <rev>]
// --ref reads PARITY from another revision, such as HEAD on a docs branch.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Web and Core paths whose changes can move Apple chat parity. */
export const WEB_CHAT_PATHS = [
  "apps/web/src/app/(app)/chat",
  "apps/web/src/components/chat",
  "apps/web/src/lib/ably",
  "apps/web/src/lib/services/chat-room.service.ts",
  "apps/core/src/routes/v1/chats",
  "apps/core/src/routes/v1/soko-bots",
];

const ROW_ID = /^\| ([0-9][0-9a-z]*) \| /;
const DONE = /^(Done|Merged|N\/A)\b/;

export function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) return "";
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** Rows, Work order and web audit marker of PARITY.md. */
export function parseParity(markdown) {
  const rows = new Map();
  for (const line of section(markdown, "Dependency-ordered capability inventory").split("\n")) {
    const match = ROW_ID.exec(line);
    if (!match) continue;
    const cells = line
      .slice(1, -1)
      .split(" | ")
      .map((cell) => cell.trim());
    const deps = cells[2] === "—" ? [] : (cells[2] ?? "").match(/\b[0-9]{2}[0-9a-z]*\b/g) ?? [];
    rows.set(match[1], { cells, deps, status: cells[3] ?? "" });
  }
  const checkpoint = section(markdown, "Resume checkpoint");
  const order = /\*\*Work order\.\*\*.*?Order: (none|[0-9][0-9a-z]*(?:, [0-9][0-9a-z]*)*)\./.exec(checkpoint);
  const audited = /\*\*Web audited through\.\*\* `([0-9a-f]{7,40})`/.exec(checkpoint);
  return {
    rows,
    workOrder: order ? (order[1] === "none" ? [] : order[1].split(", ")) : null,
    webAuditedThrough: audited?.[1] ?? null,
  };
}

/** Work order ids whose dependencies are Done, Merged or N/A, minus rows with an open PR. */
export function eligibleRows(parity, openRowIds) {
  return (parity.workOrder ?? []).filter((id) => {
    const row = parity.rows.get(id);
    if (!row?.status.startsWith("Todo") || openRowIds.has(id)) return false;
    return row.deps.every((dep) => DONE.test(parity.rows.get(dep)?.status ?? ""));
  });
}

export function chipPrompt(id) {
  return `Follow \`.agents/skills/apple-parity-next/SKILL.md\` for row ${id}: read that file, then carry out its steps (it is the same as typing \`/apple-parity-next ${id}\`).`;
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function main() {
  run("git", ["fetch", "-q", "origin", "main"]);
  const flag = process.argv.indexOf("--ref");
  const ref = flag === -1 ? "origin/main" : process.argv[flag + 1];
  const sha = run("git", ["rev-parse", "--short", ref]);
  const markdown = run("git", ["show", `${ref}:apps/apple/PARITY.md`]);
  const log = run("git", ["show", `${ref}:apps/apple/PARITY-LOG.md`]);
  const parity = parseParity(markdown);
  const out = [`${ref} ${sha}`];

  const open = JSON.parse(run("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName,isDraft,title"]))
    .filter((pr) => pr.headRefName.startsWith("claude/apple-parity-"));
  const openRowIds = new Set(
    open.map((pr) => /^claude\/apple-parity-([0-9][0-9a-z]*)-/.exec(pr.headRefName)?.[1]).filter(Boolean),
  );
  out.push("", `Open parity PRs (${open.length})`);
  for (const pr of open) out.push(`  #${pr.number}${pr.isDraft ? " draft" : ""} ${pr.headRefName}  ${pr.title}`);

  out.push("", "In review, but the PR merged (mark Done)");
  let stale = 0;
  for (const [id, row] of parity.rows) {
    if (!row.status.startsWith("In review")) continue;
    const number = /#(\d+)/.exec(row.status)?.[1];
    const branch = /`(claude\/apple-parity-[^`]+)`/.exec(row.status)?.[1];
    if (!number && !branch) continue;
    const pr = number
      ? JSON.parse(run("gh", ["pr", "view", number, "--json", "number,state,mergedAt,mergeCommit"]))
      : JSON.parse(run("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,state,mergedAt,mergeCommit"]))[0];
    if (pr?.state !== "MERGED") continue;
    stale += 1;
    out.push(`  ${id}  #${pr.number} merged ${pr.mergedAt.slice(0, 10)} as squash ${pr.mergeCommit.oid.slice(0, 9)}`);
  }
  if (stale === 0) out.push("  none");

  const remaining = new Map();
  for (const [id, row] of parity.rows) {
    const status = /^(Todo|In progress|In review|Partial|Merged|Deferred|Blocked|Split)\b/.exec(row.status)?.[1];
    if (status) remaining.set(status, [...(remaining.get(status) ?? []), id]);
  }
  out.push("", "Rows not Done");
  for (const [status, ids] of remaining) out.push(`  ${status} (${ids.length}): ${ids.join(", ")}`);

  out.push("", `Web chat commits since the audit marker ${parity.webAuditedThrough ?? "(missing)"}`);
  if (parity.webAuditedThrough) {
    const commits = run("git", ["log", "--format=%h %s", `${parity.webAuditedThrough}..${ref}`, "--", ...WEB_CHAT_PATHS]);
    const lines = commits ? commits.split("\n") : [];
    for (const line of lines) {
      const pr = /\(#(\d+)\)$/.exec(line)?.[1];
      const citation = new RegExp(`#${pr}(?!\\d)`);
      const cited = pr && (citation.test(markdown) || citation.test(log));
      out.push(`  ${line}${pr ? (cited ? "  [cited]" : "  [not in PARITY]") : ""}`);
    }
    if (lines.length === 0) out.push("  none");
  }

  const eligible = eligibleRows(parity, openRowIds);
  out.push("", `Next eligible rows: ${eligible.length ? eligible.join(", ") : "none"}`);
  for (const id of eligible.slice(0, 2)) out.push(`  chip: ${chipPrompt(id)}`);
  console.log(out.join("\n"));
}

// realpath: run through a symlink, argv[1] keeps the link while import.meta.url resolves it.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
