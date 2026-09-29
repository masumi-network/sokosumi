import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { unprovisionedDbFiles } from "../../vitest.config";

/**
 * Does every `*.postgres.test.ts` in this package actually run in CI?
 *
 * `optInDbExclude` in `vitest.config.ts` keeps all of them out of
 * `test:ci`, so the only thing that runs them is the "Test against
 * PostgreSQL" step in `.github/workflows/ci.yml`. That step used to name
 * each file, and an enumerated list degrades silently: `vitest run <name>`
 * treats a name matching nothing as contributing nothing, so a typo, a
 * rename or a deletion gives "N-1 passed, exit 0". Six Files suites —
 * 2,140 lines covering the spend cap, the daily budgets and the admission
 * ceiling — were written, passed locally, and were executed by no CI job
 * at all. Nothing said so.
 *
 * This is the check that would have said so. It is deliberately about the
 * files on disk rather than about the shape of the YAML: the question is
 * "is this suite reachable from CI", and any answer of "no" is a finding
 * whether it came from a list, a glob or a typo.
 *
 * It is quiet while the substring filter is in place, which is the point.
 * Reverting that step to an enumerated list turns it red for every suite
 * the list forgets — seven, at the time of writing.
 *
 * What it does **not** catch, stated so nobody assumes otherwise:
 * emptying `unprovisionedDbFiles` leaves this green at every assertion,
 * because without the hold-out the substring filter does select that file
 * and it is "reachable" by this test's definition. The CI run then goes
 * red, loudly, on a suite that throws during collection.
 *
 * So the coverage this file provides is one-directional: it catches a
 * suite that was never added, and a hold-out that has outlived its file.
 * It does not catch removing a hold-out that is still needed. That case
 * is caught by the run itself, which is a fine place for it — this file
 * exists for the failures that are silent, and that one is not.
 */

const WORKFLOW = fileURLToPath(
  new URL("../../../../.github/workflows/ci.yml", import.meta.url),
);
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The step that runs them, as one line, comments stripped. */
function postgresStepCommand(): string {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const marker = "- name: Test against PostgreSQL";
  const at = yaml.indexOf(marker);
  expect(
    at,
    "the PostgreSQL step has been renamed or removed; this test names it",
  ).toBeGreaterThan(-1);

  // Up to the next step at the same indentation.
  const rest = yaml.slice(at + marker.length);
  const end = rest.search(/\n {6}- name:/u);
  return (end === -1 ? rest : rest.slice(0, end))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .join(" ")
    .replace(/\\\s+/gu, " ");
}

describe("every PostgreSQL suite is reachable from CI", () => {
  const command = postgresStepCommand();

  const suites = globSync("src/**/*.postgres.test.ts", { cwd: PACKAGE_ROOT })
    .map((file) => file.replaceAll("\\", "/"))
    .sort();

  it("finds some suites to reason about", () => {
    // Without this the whole file passes vacuously if the glob breaks.
    expect(suites.length).toBeGreaterThan(5);
  });

  it.each(suites)("%s is selected, or excluded on purpose", (suite) => {
    /**
     * Two ways to be accounted for. Either the step's filter selects the
     * file — a substring the path contains — or `unprovisionedDbFiles` in
     * `vitest.config.ts` holds it out, which is a visible decision
     * someone made and documented next to the pattern.
     *
     * A file that is neither is the failure this exists to catch: it runs
     * on the author's machine and nowhere else.
     */
    if (unprovisionedDbFiles.includes(suite)) return;

    const selected = command
      .split(/\s+/u)
      .filter((token) => !token.startsWith("-") && token.includes(".test.ts"))
      .some((token) => suite.includes(token.replace(/^['"]|['"]$/gu, "")));

    expect(
      selected,
      `${suite} is neither selected by the PostgreSQL step nor held out in ` +
        `unprovisionedDbFiles. It will pass locally and run in no CI job. ` +
        `Either widen the step's filter or hold it out explicitly, with a ` +
        `comment saying why.`,
    ).toBe(true);
  });

  it("holds out only what it says it holds out", () => {
    /**
     * An exclusion is a hole, and a hole that outlives its reason is worse
     * than no hole. This fails once the held-out file stops existing, so
     * the entry has to be removed rather than left behind.
     *
     * Skipped when the owner's variable is set, because the list is empty
     * then by design.
     */
    for (const file of unprovisionedDbFiles) {
      expect(
        suites,
        `${file} is held out in vitest.config.ts but no longer exists; ` +
          `drop the entry`,
      ).toContain(file);
    }
  });
});
