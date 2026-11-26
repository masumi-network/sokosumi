import type { AdminSeoAlerts } from "@sokosumi/core-client";

type BillingRow = AdminSeoAlerts["billing"][number];
type Cost = NonNullable<BillingRow["cost"]>;
type Detail = NonNullable<BillingRow["costDetail"]>;

export interface CostDetailStep {
  step: string | null;
  modelMicroUsd: number;
  dataForSeoMicroUsd: number;
  otherApiMicroUsd: number;
  totalMicroUsd: number;
}

export interface CostDetailView {
  models: Detail["models"];
  /** Receipt model cost the model rows do not explain; 0 when they add up. */
  modelGapMicroUsd: number;
  dataForSeo: Detail["dataForSeo"];
  dataForSeoGapMicroUsd: number;
  /** Step rows, then one row with step null for the gap per column, if any. */
  steps: CostDetailStep[];
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);
const byCostDesc = (a: number | null, b: number | null) =>
  (b ?? -1) - (a ?? -1);

/** Order each breakdown by cost and compare its sum with the receipt total it splits. */
export function costDetailView(detail: Detail, cost: Cost): CostDetailView {
  const modelTotal = cost.gatewayMicroUsd + cost.directModelMicroUsd;
  const stepRow = (
    step: string | null,
    modelMicroUsd: number,
    dataForSeoMicroUsd: number,
    otherApiMicroUsd: number,
  ): CostDetailStep => ({
    step,
    modelMicroUsd,
    dataForSeoMicroUsd,
    otherApiMicroUsd,
    totalMicroUsd: modelMicroUsd + dataForSeoMicroUsd + otherApiMicroUsd,
  });
  const steps = detail.steps
    .map((row) =>
      stepRow(
        row.step,
        row.modelMicroUsd,
        row.dataForSeoMicroUsd,
        row.otherApiMicroUsd,
      ),
    )
    .sort((a, b) => b.totalMicroUsd - a.totalMicroUsd);
  const stepGap = stepRow(
    null,
    modelTotal - sum(steps.map((row) => row.modelMicroUsd)),
    cost.dataForSeoMicroUsd - sum(steps.map((row) => row.dataForSeoMicroUsd)),
    cost.otherApiMicroUsd - sum(steps.map((row) => row.otherApiMicroUsd)),
  );
  const stepGapExists =
    stepGap.modelMicroUsd !== 0 ||
    stepGap.dataForSeoMicroUsd !== 0 ||
    stepGap.otherApiMicroUsd !== 0;
  return {
    models: [...detail.models].sort((a, b) =>
      byCostDesc(a.microUsd, b.microUsd),
    ),
    modelGapMicroUsd:
      modelTotal - sum(detail.models.map((row) => row.microUsd ?? 0)),
    dataForSeo: [...detail.dataForSeo].sort((a, b) =>
      byCostDesc(a.microUsd, b.microUsd),
    ),
    dataForSeoGapMicroUsd:
      cost.dataForSeoMicroUsd -
      sum(detail.dataForSeo.map((row) => row.microUsd)),
    steps: stepGapExists ? [...steps, stepGap] : steps,
  };
}
