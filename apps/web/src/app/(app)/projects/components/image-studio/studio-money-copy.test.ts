import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * What the studio is allowed to say about money.
 *
 * Images are charged on success. Nothing is reserved and nothing is ever given
 * back, so any sentence about a refund, a reversal or credits returning is false
 * — and it was true enough for one build that the copy said it in three
 * languages. This reads the shipped catalogues rather than a component, because
 * the prose is the thing that was wrong.
 *
 * Deliberately scoped to `App.Studio`. Sokosumi has a large, unrelated refund
 * system for agent jobs — x402 payments, disputes, Request Refund, refund
 * states — and roughly thirty of its keys live in these same files. Those are
 * correct and none of this applies to them.
 */

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../messages",
);

const LOCALES = ["en", "de", "es"] as const;

/** Refund vocabulary in the three languages the studio ships in. */
const REFUND_WORDS =
  /refund|reimburs|erstatt|gutschrift|reembols|devuelt|reintegr/i;

/** Reservation vocabulary: there is no hold on credits either. */
const RESERVE_WORDS = /reserv/i;

function studioStrings(locale: string): [string, string][] {
  const catalog = JSON.parse(
    readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"),
  ) as { App: { Studio: Record<string, unknown> } };

  const found: [string, string][] = [];
  const walk = (node: unknown, keyPath: string) => {
    if (typeof node === "string") {
      found.push([keyPath, node]);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, keyPath ? `${keyPath}.${key}` : key);
      }
    }
  };
  walk(catalog.App.Studio, "App.Studio");
  return found;
}

describe("the studio's money copy", () => {
  it.each(LOCALES)("promises no refund in %s", (locale) => {
    const offenders = studioStrings(locale)
      .filter(([, value]) => REFUND_WORDS.test(value))
      .map(([key, value]) => `${key}: ${value}`);

    // Nothing is taken for a generation that fails, so there is nothing to give
    // back. "It was refunded in full" was both wrong and weaker than the truth.
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it.each(LOCALES)("does not describe a credit hold in %s", (locale) => {
    const offenders = studioStrings(locale)
      .filter(([, value]) => RESERVE_WORDS.test(value))
      .map(([key, value]) => `${key}: ${value}`);

    // The charge lands when the image is delivered. A sentence about reserving
    // credits describes a path that no longer exists.
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it.each(LOCALES)("still says a failure costs nothing in %s", (locale) => {
    // The guards above are satisfied by saying nothing at all, which would be a
    // worse answer to "did that cost me anything?" than the wrong one.
    const keys = new Map(studioStrings(locale));
    expect(keys.get("App.Studio.failedNoCharge")?.trim()).toBeTruthy();
    expect(keys.get("App.Studio.creditsCharged")?.trim()).toBeTruthy();
  });
});
