const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;
const SPARKLINE_DAILY_LIMIT = 16;
const SPARKLINE_BUCKET_DAYS = 7;

function sparklineSpan(values: (number | null)[]): (number | null)[] {
  let start = 0;
  let end = values.length;
  while (start < end && values[start] == null) start += 1;
  while (end > start && values[end - 1] == null) end -= 1;
  return values.slice(start, end);
}

function sparklineSeries(values: (number | null)[]): (number | null)[] {
  if (values.length <= SPARKLINE_DAILY_LIMIT) return values;
  const buckets: (number | null)[] = [];
  for (let index = 0; index < values.length; index += SPARKLINE_BUCKET_DAYS) {
    const slice = values.slice(index, index + SPARKLINE_BUCKET_DAYS);
    let sum = 0;
    let measured = false;
    for (const value of slice) {
      if (value == null) continue;
      measured = true;
      sum += value;
    }
    buckets.push(measured ? sum : null);
  }
  return buckets;
}

export function MetricSparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const series = sparklineSpan(sparklineSeries(values));
  const measured = series.flatMap((value) => (value == null ? [] : [value]));
  const min = measured.length === 0 ? 0 : Math.min(...measured);
  const max = measured.length === 0 ? 0 : Math.max(...measured);
  const span = max - min || 1;
  const step = series.length > 1 ? SPARKLINE_WIDTH / (series.length - 1) : 0;
  const points = series.map((value, index) => {
    if (value == null) return null;
    const x = series.length === 1 ? SPARKLINE_WIDTH / 2 : index * step;
    const y =
      SPARKLINE_HEIGHT - ((value - min) / span) * (SPARKLINE_HEIGHT - 2) - 1;
    return { x, y };
  });
  const runs = pointRuns(points);
  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      className="mt-1 h-4 w-full sm:h-6"
      role="img"
      aria-label={label}
    >
      <line
        x1="0"
        x2={SPARKLINE_WIDTH}
        y1={SPARKLINE_HEIGHT - 1}
        y2={SPARKLINE_HEIGHT - 1}
        className="stroke-border"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {runs.map((run) => (
        <path
          key={`area-${run[0]?.x}`}
          d={areaPath(run)}
          className="fill-primary-quinary dark:fill-primary-quaternary"
        />
      ))}
      {runs.map((run) => (
        <path
          key={`line-${run[0]?.x}`}
          d={linePath(run)}
          fill="none"
          className="stroke-primary"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function pointRuns(
  points: ({ x: number; y: number } | null)[],
): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function linePath(points: { x: number; y: number }[]): string {
  const fmt = (value: number) => value.toFixed(1);
  if (points.length === 1) {
    return `M0 ${fmt(points[0]?.y ?? 0)} H${SPARKLINE_WIDTH}`;
  }
  let path = `M${fmt(points[0]?.x ?? 0)} ${fmt(points[0]?.y ?? 0)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return path;
}

function areaPath(points: { x: number; y: number }[]): string {
  if (points.length === 1) {
    const y = (points[0]?.y ?? 0).toFixed(1);
    return `M0 ${y} H${SPARKLINE_WIDTH} V${SPARKLINE_HEIGHT} H0 Z`;
  }
  const last = points.at(-1);
  const first = points[0];
  if (!last || !first) return "";
  return `${linePath(points)} L${last.x.toFixed(1)} ${SPARKLINE_HEIGHT} L${first.x.toFixed(1)} ${SPARKLINE_HEIGHT} Z`;
}
