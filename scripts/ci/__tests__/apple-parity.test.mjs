import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const parityPath = path.join(repoRoot, "apps/apple/PARITY.md");

/** Status values defined in PARITY.md's "Status and iteration rules". */
const STATUS =
  /^(Todo|In progress|In review|Partial|Merged|Done|Deferred|Blocked|Split|N\/A)\b/;

/** Statuses a split parent must leave to its child rows. */
const CHILD_STATUS = /\b(Todo|In progress|In review|Merged|Done)\b/;

/**
 * The Resume checkpoint holds standing bullets only. Per-row notes belong in
 * PARITY-LOG.md; this cap trips long before the checkpoint regrows to the
 * 114 KB it reached by 2026-10-08.
 */
const CHECKPOINT_MAX_BYTES = 8 * 1024;

function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `PARITY.md has no "## ${heading}" section`);
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

function parseRows(markdown) {
  const rows = new Map();
  for (const line of section(
    markdown,
    "Dependency-ordered capability inventory",
  ).split("\n")) {
    const match = /^\| ([0-9][0-9a-z]*) \| /.exec(line);
    if (!match) continue;
    const cells = line
      .slice(1, -1)
      .split(" | ")
      .map((cell) => cell.trim());
    rows.set(match[1], { cells, status: cells[3] ?? "" });
  }
  return rows;
}

const markdown = await readFile(parityPath, "utf8");
const rows = parseRows(markdown);

describe("apps/apple/PARITY.md", () => {
  it("finds the capability rows", () => {
    assert.ok(
      rows.size > 100,
      `expected the capability table, found ${rows.size} rows`,
    );
  });

  it("gives every row five cells and a defined status", () => {
    for (const [id, row] of rows) {
      assert.equal(
        row.cells.length,
        5,
        `row ${id} has ${row.cells.length} cells, expected 5`,
      );
      assert.match(
        row.status,
        STATUS,
        `row ${id} status "${row.status.slice(0, 40)}" is not a defined status`,
      );
    }
  });

  it("names split children without repeating their status", () => {
    for (const [id, row] of rows) {
      if (!row.status.startsWith("Split")) continue;
      const children = /^Split — ([0-9][0-9a-z]*(?:, [0-9][0-9a-z]*)*)/.exec(
        row.status,
      );
      assert.ok(children, `row ${id} must read "Split — <child ids>"`);
      for (const child of children[1].split(", ")) {
        assert.ok(
          rows.has(child),
          `row ${id} splits into ${child}, which has no row`,
        );
      }
      const status = CHILD_STATUS.exec(row.status);
      assert.equal(
        status,
        null,
        `row ${id} repeats a child's status ("${status?.[0]}"); keep it in the child's own Status cell`,
      );
    }
  });

  it("lists exactly the Todo rows in the Work order", () => {
    const checkpoint = section(markdown, "Resume checkpoint");
    const workOrder = checkpoint
      .split("\n")
      .find((line) => line.startsWith("- **Work order.**"));
    assert.ok(workOrder, "the Resume checkpoint has no **Work order.** bullet");
    const order = /Order: (none|[0-9][0-9a-z]*(?:, [0-9][0-9a-z]*)*)\./.exec(
      workOrder,
    );
    assert.ok(
      order,
      'the Work order must contain "Order: <ids>." or "Order: none."',
    );
    const listed = order[1] === "none" ? [] : order[1].split(", ");
    const todo = [...rows]
      .filter(([, row]) => row.status.startsWith("Todo"))
      .map(([id]) => id);
    assert.deepEqual(
      [...listed].sort(),
      [...todo].sort(),
      "the Work order must list exactly the Todo rows",
    );
  });

  it("keeps row state out of the Resume checkpoint", () => {
    const checkpoint = section(markdown, "Resume checkpoint");
    const bytes = Buffer.byteLength(checkpoint);
    assert.ok(
      bytes <= CHECKPOINT_MAX_BYTES,
      `the Resume checkpoint is ${bytes} bytes (max ${CHECKPOINT_MAX_BYTES}); move per-row notes to the row's PARITY-LOG.md slice section`,
    );
    assert.doesNotMatch(
      checkpoint,
      /In review/,
      "row state belongs in the row's Status cell, not the Resume checkpoint",
    );
  });
});
