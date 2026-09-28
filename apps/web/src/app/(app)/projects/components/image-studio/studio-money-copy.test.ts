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

/**
 * "You have already been charged", per language.
 *
 * Only the uncertain notice is checked against these, and deliberately so: the
 * rest of `App.Studio` *denies* a charge ("Nothing was charged for it", "nothing
 * was charged"), and a pattern loose enough to catch a past-tense claim would
 * flag the denials too.
 *
 * Each is scoped to one sentence with `[^.]*`, so a claim in one sentence cannot
 * be manufactured out of two neighbours. The true statement the notice does make
 * — that an image, if one comes back, *will* be charged — is future tense and
 * carries none of these markers.
 */
const ALREADY_CHARGED: Record<string, RegExp> = {
  en: /\balready\b[^.]*charg|\bhas been charged\b|\bwas charged\b/i,
  de: /\b(bereits|schon)\b[^.]*berechnet|\bwurde[^.]*berechnet\b/i,
  es: /\bya\b[^.]*cobr|\bse ha cobrado\b|\bse cobró\b/i,
};

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

/**
 * What the "we could not confirm this request" notice may say.
 *
 * It used to say "It may already have been charged", which under charge-on-success
 * is false at the exact moment it is shown: nothing is taken at submit, so the
 * person has been charged nothing at all. What is true is conditional and in the
 * future — if the provider did receive it and an image comes back, that image
 * will be charged — and that is what makes submitting again a risk of paying for
 * two images instead of one.
 */
describe("the uncertain-submission notice", () => {
  it.each(LOCALES)("claims no charge has happened yet in %s", (locale) => {
    const keys = new Map(studioStrings(locale));
    const notice = [
      keys.get("App.Studio.uncertainTitle") ?? "",
      keys.get("App.Studio.uncertainBody") ?? "",
    ].join(" ");

    expect(notice.trim()).toBeTruthy();
    expect(
      ALREADY_CHARGED[locale].test(notice),
      `${locale}: the uncertain notice claims a charge has already happened — ${notice}`,
    ).toBe(false);
  });

  it.each(LOCALES)("still warns about paying twice in %s", (locale) => {
    // The guard above is satisfied by deleting the money warning altogether,
    // which would leave somebody pressing "Submit a new request anyway" with no
    // idea that it can cost them two images.
    const body = new Map(studioStrings(locale)).get("App.Studio.uncertainBody");
    expect(body).toMatch(/charg|berechn|cobr/i);
  });
});
