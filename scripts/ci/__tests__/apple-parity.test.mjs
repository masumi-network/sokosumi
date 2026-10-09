import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  eligibleRows,
  parseParity,
  section,
} from "../../../apps/apple/scripts/parity-status.mjs";

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

const markdown = await readFile(parityPath, "utf8");
const parity = parseParity(markdown);
const { rows } = parity;

function checkpointOf(text) {
  const checkpoint = section(text, "Resume checkpoint");
  assert.ok(checkpoint, 'PARITY.md has no "## Resume checkpoint" section');
  return checkpoint;
}

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
    assert.ok(
      parity.workOrder,
      'the Resume checkpoint\'s **Work order.** bullet must contain "Order: <ids>." or "Order: none."',
    );
    const todo = [...rows]
      .filter(([, row]) => row.status.startsWith("Todo"))
      .map(([id]) => id);
    assert.deepEqual(
      [...parity.workOrder].sort(),
      [...todo].sort(),
      "the Work order must list exactly the Todo rows",
    );
  });

  it("records how far web was audited", () => {
    assert.ok(
      parity.webAuditedThrough,
      "the Resume checkpoint needs a **Web audited through.** `<sha>` bullet",
    );
  });

  it("keeps row state out of the Resume checkpoint", () => {
    const checkpoint = checkpointOf(markdown);
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

describe("parity-status eligibleRows", () => {
  const fixture = [
    "## Resume checkpoint",
    "",
    "- **Work order.** Order: 41b, 41a, 41c.",
    "",
    "## Dependency-ordered capability inventory",
    "",
    "| 40 | Base | — | Done — #1 | x |",
    "| 41a | First | 40 | Todo | x |",
    "| 41b | Second | 41a | Todo | x |",
    "| 41c | Third | 40 | Todo | x |",
    "| 41d | Fourth | 40 | In review — #2 | x |",
    "",
  ].join("\n");

  it("keeps the Work order's order and skips rows with unmet dependencies or an open PR", () => {
    const fixtureParity = parseParity(`\n${fixture}`);
    assert.deepEqual(eligibleRows(fixtureParity, new Set()), ["41a", "41c"]);
    assert.deepEqual(eligibleRows(fixtureParity, new Set(["41a"])), ["41c"]);
  });
});
