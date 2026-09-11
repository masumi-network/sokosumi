import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import { getJobStatusBadgeLabelKey } from "./job-status-label";

/**
 * Two statuses once shared the "paymentPending" key, so two filter options
 * and two badges read the same word with no way to tell them apart. Nothing
 * caught it: the badge test mocks next-intl to the identity function and
 * asserts one key, and the filter test supplies its own fixture. These
 * assertions pin the property that was violated, in both directions: the keys
 * must be distinct, and so must the strings each locale resolves them to.
 */

const MESSAGES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../messages",
);

const LOCALES = ["en", "de", "es"] as const;

/** Every status that carries a label of its own, so "unknown" is excluded. */
const LABELLED_STATUSES = Object.values(SokosumiJobStatus).filter(
  (status) => getJobStatusBadgeLabelKey(status) !== "unknown",
);

function statusBadgeMessages(locale: string): Record<string, string> {
  const file = path.join(MESSAGES_ROOT, `${locale}.json`);
  const messages = JSON.parse(readFileSync(file, "utf8"));
  return messages.Components.Jobs.StatusBadge;
}

describe("getJobStatusBadgeLabelKey", () => {
  it("gives every labelled status a key of its own", () => {
    const keys = LABELLED_STATUSES.map(getJobStatusBadgeLabelKey);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect([...new Set(duplicates)], "statuses sharing one key").toEqual([]);
  });

  it.each(LOCALES)("reads as a distinct string in %s", (locale) => {
    const messages = statusBadgeMessages(locale);
    const collisions: string[] = [];
    const seen = new Map<string, SokosumiJobStatus>();

    for (const status of LABELLED_STATUSES) {
      const label = messages[getJobStatusBadgeLabelKey(status)];
      expect(label, `${locale} is missing a label for ${status}`).toBeTruthy();
      const owner = seen.get(label);
      if (owner) collisions.push(`${owner} and ${status} both read "${label}"`);
      else seen.set(label, status);
    }

    expect(collisions, collisions.join("\n")).toEqual([]);
  });
});
