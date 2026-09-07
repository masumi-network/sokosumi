import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JOB_ATTENTION_MESSAGE_KEYS,
  JOB_COMPLETED_MESSAGE_KEY,
  TASK_ATTENTION_MESSAGE_KEYS,
  TASK_COMPLETED_MESSAGE_KEY,
} from "./notification-delivery";

/**
 * The job and task keys that belong on the quiet row.
 *
 * Written here rather than in the source, because the source needs no list:
 * a key nobody classified falls to the update row on its own. That fallback is
 * the safe direction for noise and the wrong one for work that waits on the
 * reader, and it is silent either way. This test is the noise: add a producer
 * key and it fails until someone puts the key on a row.
 */
const UPDATE_MESSAGE_KEYS: readonly string[] = [
  "Notifications.Job.failed",
  "Notifications.Job.disputeResolved",
  "Notifications.Job.refundResolved",
  "Notifications.Task.failed",
  "Notifications.Task.canceled",
  "Notifications.Task.scheduleRepaired",
];

const SOURCE_ROOT = join(process.cwd(), "src");

/**
 * Every job and task message key written anywhere in Core.
 *
 * A string literal rather than an emit site, so an OpenAPI example counts too.
 * That is the wider net on purpose: a key is worth classifying wherever it is
 * written down, and reading the emit sites alone would need a parser to tell an
 * example apart from a call.
 */
function emittedMessageKeys(): string[] {
  const keys = new Set<string>();

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);

      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }

      // The helper itself and the tests name keys without emitting them.
      if (
        !path.endsWith(".ts") ||
        path.endsWith(".test.ts") ||
        path.endsWith("notification-delivery.ts")
      ) {
        continue;
      }

      for (const match of readFileSync(path, "utf8").matchAll(
        /"(Notifications\.(?:Job|Task)\.[A-Za-z]+)"/g,
      )) {
        const key = match[1];
        if (key) {
          keys.add(key);
        }
      }
    }
  }

  walk(SOURCE_ROOT);

  return [...keys].sort();
}

describe("the job and task keys Core names", () => {
  it("are each classified onto a row", () => {
    const classified = new Set([
      ...JOB_ATTENTION_MESSAGE_KEYS,
      JOB_COMPLETED_MESSAGE_KEY,
      ...TASK_ATTENTION_MESSAGE_KEYS,
      TASK_COMPLETED_MESSAGE_KEY,
      ...UPDATE_MESSAGE_KEYS,
    ]);

    expect(emittedMessageKeys().filter((key) => !classified.has(key))).toEqual(
      [],
    );
  });

  /** The reverse: a key nobody emits any more should leave the lists too. */
  it("cover every key the lists name", () => {
    const emitted = new Set(emittedMessageKeys());

    expect(
      [
        ...JOB_ATTENTION_MESSAGE_KEYS,
        JOB_COMPLETED_MESSAGE_KEY,
        ...TASK_ATTENTION_MESSAGE_KEYS,
        TASK_COMPLETED_MESSAGE_KEY,
        ...UPDATE_MESSAGE_KEYS,
      ].filter((key) => !emitted.has(key)),
    ).toEqual([]);
  });
});
