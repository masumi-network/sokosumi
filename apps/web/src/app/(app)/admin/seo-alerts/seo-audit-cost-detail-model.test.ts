import { expect, it } from "vitest";
import { costDetailView } from "./seo-audit-cost-detail-model";

const cost = {
  version: 1 as const,
  gatewayMicroUsd: 3_000_000,
  directModelMicroUsd: 500_000,
  dataForSeoMicroUsd: 1_000_000,
  otherApiMicroUsd: 20,
};

it("puts unexplained receipt cost into Unattributed rows and leaves unpriced models out of the sum", () => {
  const view = costDetailView(
    {
      version: 1,
      models: [
        { model: "direct", provider: null, calls: 2, microUsd: null },
        { model: "small", provider: "openai", calls: 9, microUsd: 1_000_000 },
        {
          model: "large",
          provider: "anthropic",
          calls: 1,
          microUsd: 2_000_000,
        },
      ],
      dataForSeo: [{ endpoint: "/v3/serp", reads: 3, microUsd: 900_000 }],
      steps: [
        {
          step: "seo",
          modelMicroUsd: 1_000_000,
          dataForSeoMicroUsd: 900_000,
          otherApiMicroUsd: 0,
        },
        {
          step: "editorial",
          modelMicroUsd: 2_500_000,
          dataForSeoMicroUsd: 0,
          otherApiMicroUsd: 20,
        },
      ],
    },
    cost,
  );
  expect(view.models.map((row) => row.model)).toEqual([
    "large",
    "small",
    "direct",
  ]);
  expect(view.modelGapMicroUsd).toBe(500_000);
  expect(view.dataForSeoGapMicroUsd).toBe(100_000);
  expect(view.steps).toEqual([
    {
      step: "editorial",
      modelMicroUsd: 2_500_000,
      dataForSeoMicroUsd: 0,
      otherApiMicroUsd: 20,
      totalMicroUsd: 2_500_020,
    },
    {
      step: "seo",
      modelMicroUsd: 1_000_000,
      dataForSeoMicroUsd: 900_000,
      otherApiMicroUsd: 0,
      totalMicroUsd: 1_900_000,
    },
    {
      step: null,
      modelMicroUsd: 0,
      dataForSeoMicroUsd: 100_000,
      otherApiMicroUsd: 0,
      totalMicroUsd: 100_000,
    },
  ]);
});

it("adds no Unattributed step row when the steps add up to the receipt", () => {
  const view = costDetailView(
    {
      version: 1,
      models: [],
      dataForSeo: [],
      steps: [
        {
          step: "other",
          modelMicroUsd: 3_500_000,
          dataForSeoMicroUsd: 1_000_000,
          otherApiMicroUsd: 20,
        },
      ],
    },
    cost,
  );
  expect(view.steps.map((row) => row.step)).toEqual(["other"]);
  expect(view.modelGapMicroUsd).toBe(3_500_000);
  expect(view.dataForSeoGapMicroUsd).toBe(1_000_000);
});
