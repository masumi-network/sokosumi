import humanizeDuration from "humanize-duration";

const ONE_DAY_IN_SECONDS = 24 * 60 * 60 * 1000;
const ONE_HOUR_IN_SECONDS = 60 * 60 * 1000;
const ONE_MINUTE_IN_SECONDS = 60 * 1000;

export function formatDuration(
  seconds: number | null,
  durationIntl?: IntlTranslation<"Library.Duration">,
): string | null {
  if (seconds === null) {
    return null;
  }
  const ms = seconds * 1000;
  const humanizer = humanizeDuration.humanizer({
    language: "intl",
    languages: {
      intl: {
        d: (value) => durationIntl?.("days", { value: value ?? 0 }) ?? "days",
        h: (value) => durationIntl?.("hours", { value: value ?? 0 }) ?? "hours",
        m: (value) =>
          durationIntl?.("minutes", { value: value ?? 0 }) ?? "minutes",
        s: (value) =>
          durationIntl?.("seconds", { value: value ?? 0 }) ?? "seconds",
      },
    },
  });

  if (ms > ONE_DAY_IN_SECONDS) {
    return humanizer(ms, { round: true, units: ["d"] });
  }

  if (ms > ONE_HOUR_IN_SECONDS) {
    return humanizer(ms, { round: true, units: ["h"] });
  }

  if (ms > ONE_MINUTE_IN_SECONDS) {
    return humanizer(ms, { round: true, units: ["m"] });
  }

  return humanizer(ms, { round: true, units: ["s"] });
}
