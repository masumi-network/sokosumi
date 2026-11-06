import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { brain, draft } from "../test-fixtures/onboarding";
import { ResultsPage } from "./app/pages";
import { BrandStep } from "./onboarding/brand-step";

const noop = async () => {};

/** The card whose class list holds `marker`, as its opening tag. */
function cardTag(html: string, marker: string): string | undefined {
  return html
    .match(/<[a-z]+ class="[^"]*"/g)
    ?.find((tag) => tag.includes(marker) && tag.includes("card"));
}

function brandStep(answered: boolean) {
  const questions = (brain.questions ?? []).map((question) => ({
    ...question,
    answer: answered ? ("yes" as const) : undefined,
  }));
  return renderToStaticMarkup(
    <BrandStep
      overview={draft({
        brandBrainConfirmedAt: null,
        strategy: null,
        brandBrain: { ...brain, questions },
      })}
      messages={[]}
      onCorrect={noop}
      onSave={noop}
      onAnswer={noop}
      onApprove={async () => null}
    />,
  );
}

it("Brand's questions-left card carries the hard shadow, and is gone once answered", () => {
  expect(cardTag(brandStep(false), "ob-left")).toContain("card-focus");
  expect(cardTag(brandStep(true), "ob-left")).toBeUndefined();
});

function results(connected: boolean) {
  const sources = cmoOverview().measurement.map((source) => ({
    ...source,
    status: connected ? ("connected" as const) : source.status,
  }));
  const html = renderToStaticMarkup(
    <ResultsPage
      overview={cmoOverview({ measurement: sources })}
      compose={() => {}}
      openUpdate={() => {}}
      connectMeasurement={async () => ({ url: null, error: null })}
      ads={{
        loadAdCampaigns: async () => [],
        setAdCampaignStatus: async () => ({ overview: null, error: null }),
      }}
      onChange={() => {}}
    />,
  );
  // The section opening just before its "Your numbers" heading.
  const head = html.indexOf("<h3>Your numbers</h3>");
  return html.slice(html.lastIndexOf("<section", head), head);
}

it("Results' Your numbers is flat once every source is connected", () => {
  expect(results(false)).toContain("card-focus");
  expect(results(true)).not.toContain("card-focus");
});
