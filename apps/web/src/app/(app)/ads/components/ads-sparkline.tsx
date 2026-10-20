const WIDTH = 80;
const HEIGHT = 24;
const PADDING = 2;

interface AdsSparklineProps {
  /** Oldest to newest. A null month leaves a gap in the line. */
  values: readonly (number | null)[];
  /** What the line says, for people who cannot see it. */
  label: string;
}

/**
 * A tiny trend line: one accent stroke, no axes. Runs of months with data are
 * lines, a lone month is a dot, and months without data are gaps. Renders
 * nothing when no month has data.
 */
export function AdsSparkline({ values, label }: AdsSparklineProps) {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;

  const min = Math.min(...present);
  const max = Math.max(...present);
  const x = (index: number) =>
    values.length > 1 ? (index / (values.length - 1)) * WIDTH : WIDTH / 2;
  const y = (value: number) =>
    max === min
      ? HEIGHT / 2
      : HEIGHT -
        PADDING -
        ((value - min) / (max - min)) * (HEIGHT - 2 * PADDING);

  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push([x(index), y(value)]);
    }
  });
  if (run.length > 0) runs.push(run);

  return (
    <svg
      aria-label={label}
      className="text-primary shrink-0"
      height={HEIGHT}
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
    >
      {runs.map((points) =>
        points.length > 1 ? (
          <polyline
            key={points[0].join()}
            fill="none"
            points={points
              .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
              .join(" ")}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        ) : (
          <circle
            key={points[0].join()}
            cx={points[0][0]}
            cy={points[0][1]}
            fill="currentColor"
            r={1.5}
          />
        ),
      )}
    </svg>
  );
}
