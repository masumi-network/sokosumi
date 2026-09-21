import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TASK_ATTENTION_MESSAGE_KEYS,
  TASK_COMPLETED_MESSAGE_KEY,
} from "./notification-delivery";

/**
 * The task keys that belong on the quiet row.
 *
 * Written here rather than in the source, because the source needs no list:
 * a key nobody classified falls to the update row on its own. That fallback is
 * the safe direction for noise and the wrong one for work that waits on the
 * reader, and it is silent either way. This test is the noise: add a producer
 * key and it fails until someone puts the key on a row.
 */
const UPDATE_MESSAGE_KEYS: readonly string[] = [
  "Notifications.Task.failed",
  "Notifications.Task.canceled",
  "Notifications.Task.scheduleOccurrenceChangedByMember",
  "Notifications.Task.scheduleRepaired",
  "Notifications.Task.scheduleRemovedByMember",
  "Notifications.Task.scheduleRemovedByOperator",
  "Notifications.Task.scheduleSourceChangedByMember",
  "Notifications.Task.scheduleUpdatedByMember",
];

const SOURCE_ROOT = join(process.cwd(), "src");

/**
 * Every task message key written anywhere in Core.
 *
 * Jobs are deliberately absent: SOK-930 stopped Core writing a job
 * notification at all, so a `Notifications.Job.*` literal left anywhere in
 * `src` is a leftover rather than a key to classify.
 *
 * A string literal rather than an emit site, so an OpenAPI example counts too.
 * That is the wider net on purpose: a key is worth classifying wherever it is
 * written down, and reading the emit sites alone would need a parser to tell an
 * example apart from a call.
 */
function emittedMessageKeys(
  pattern = /"(Notifications\.Task\.[A-Za-z]+)"/g,
  /**
   * `notification-delivery.ts` is the classifier. It names the task keys to
   * sort them rather than to send them, so the task scan above would read its
   * own lists back and always agree with itself. A scan for keys that should
   * appear nowhere wants the opposite, so it passes `false` and reads it.
   */
  skipClassifier = true,
): string[] {
  const keys = new Set<string>();

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);

      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }

      // The tests name keys without emitting them.
      if (
        !path.endsWith(".ts") ||
        path.endsWith(".test.ts") ||
        (skipClassifier && path.endsWith("notification-delivery.ts"))
      ) {
        continue;
      }

      for (const match of readFileSync(path, "utf8").matchAll(pattern)) {
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

describe("the task keys Core names", () => {
  it("are each classified onto a row", () => {
    const classified = new Set([
      ...TASK_ATTENTION_MESSAGE_KEYS,
      TASK_COMPLETED_MESSAGE_KEY,
      ...UPDATE_MESSAGE_KEYS,
    ]);

    expect(emittedMessageKeys().filter((key) => !classified.has(key))).toEqual(
      [],
    );
  });

  /**
   * SOK-930 removed every job notification. The web catalog keeps all seven
   * `Notifications.Job.*` strings so a row stored before that still reads as a
   * sentence, but Core writes none of them, and a new one here would be a
   * notification about work the reader cannot act on in the app.
   *
   * What it reads is a quoted key spelled out in a Core `.ts` file, the
   * classifier included: three of its four job keys were written there as
   * literals, so a scan that skipped it would miss the file whose whole job
   * was naming them. It does not see a key reached through an imported
   * constant, which is the other shape the removed code used, and
   * `notification-feed.ts`
   * still imports `JOB_INPUT_REQUIRED_MESSAGE_KEY` for rows stored before the
   * removal. So this is a tripwire on the written shape rather than a proof.
   */
  it("name no job at all", () => {
    expect(
      emittedMessageKeys(/["'`](Notifications\.Job\.[A-Za-z_]+)["'`]/g, false),
    ).toEqual([]);
  });

  /** The reverse: a key nobody emits any more should leave the lists too. */
  it("cover every key the lists name", () => {
    const emitted = new Set(emittedMessageKeys());

    expect(
      [
        ...TASK_ATTENTION_MESSAGE_KEYS,
        TASK_COMPLETED_MESSAGE_KEY,
        ...UPDATE_MESSAGE_KEYS,
      ].filter((key) => !emitted.has(key)),
    ).toEqual([]);
  });

  it("classify each named key exactly once", () => {
    const classified = [
      ...TASK_ATTENTION_MESSAGE_KEYS,
      TASK_COMPLETED_MESSAGE_KEY,
      ...UPDATE_MESSAGE_KEYS,
    ];

    expect(new Set(classified).size).toBe(classified.length);
  });
});
