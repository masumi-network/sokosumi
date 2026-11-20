export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

function ranks(values: readonly number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index }));
  sorted.sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) {
      end++;
    }
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index++) {
      result[sorted[index].index] = rank;
    }
    start = end;
  }
  return result;
}

/** Pearson correlation of average ranks, so tied human labels keep their rank. */
export function spearmanCorrelation(
  pairs: readonly (readonly [number, number])[],
): number | null {
  const finite = pairs.filter(
    ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
  );
  if (finite.length < 2) return null;
  const xRanks = ranks(finite.map(([x]) => x));
  const yRanks = ranks(finite.map(([, y]) => y));
  const mean = (finite.length + 1) / 2;
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < finite.length; index++) {
    const x = xRanks[index] - mean;
    const y = yRanks[index] - mean;
    covariance += x * y;
    xVariance += x * x;
    yVariance += y * y;
  }
  if (xVariance === 0 || yVariance === 0) return null;
  return Math.max(
    -1,
    Math.min(1, covariance / Math.sqrt(xVariance * yVariance)),
  );
}

/** Wilson's 95% interval remains useful when every observed thumb is positive. */
export function rateConfidenceInterval(
  successes: number,
  n: number,
): ConfidenceInterval | null {
  if (n === 0) return null;
  const zSquared = 1.96 ** 2;
  const rate = successes / n;
  const denominator = 1 + zSquared / n;
  const center = (rate + zSquared / (2 * n)) / denominator;
  const margin =
    (1.96 * Math.sqrt((rate * (1 - rate) + zSquared / (4 * n)) / n)) /
    denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function meanConfidenceInterval(
  values: readonly number[],
): ConfidenceInterval | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return {
    lower: Math.max(1, mean - margin),
    upper: Math.min(5, mean + margin),
  };
}
