const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;
const SPARKLINE_DAILY_LIMIT = 16;
const SPARKLINE_BUCKET_DAYS = 7;

function sparklineSeries(values: (number | null)[]): (number | null)[] {
  if (values.length <= SPARKLINE_DAILY_LIMIT) return values;
  const series: (number | null)[] = [];
  for (let index = 0; index < values.length; index += SPARKLINE_BUCKET_DAYS) {
    const slice = values.slice(index, index + SPARKLINE_BUCKET_DAYS);
    const measured = slice.filter((value): value is number => value !== null);
    series.push(
      measured.length === 0
        ? null
        : measured.reduce((total, value) => total + value, 0),
    );
  }
  return series;
}

function sparklineSpan(values: (number | null)[]): (number | null)[] {
  const start = values.findIndex((value) => value !== null);
  if (start === -1) return values;
  let end = values.length - 1;
  while (end > start && values[end] === null) end -= 1;
  return values.slice(start, end + 1);
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
  const points = series.flatMap((value, index) => {
    if (value == null) return [];
    const x = series.length === 1 ? SPARKLINE_WIDTH / 2 : index * step;
    const y =
      SPARKLINE_HEIGHT - ((value - min) / span) * (SPARKLINE_HEIGHT - 2) - 1;
    return [`${x.toFixed(1)},${y.toFixed(1)}`];
  });
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
      {points.length > 0 ? (
        <polyline
          points={points.join(" ")}
          fill="none"
          className="stroke-primary"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
