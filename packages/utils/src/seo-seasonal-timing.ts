// Same market coverage as the SEO worker's seasonal-calendar-catalog. Multi-zone
// calendars keep the date through the last civil day in the area the worker covers.
const calendarZones: Readonly<Record<string, string>> = {
  AT: "Europe/Vienna",
  BR: "America/Rio_Branco",
  CH: "Europe/Zurich",
  DE: "Europe/Berlin",
  ES: "Atlantic/Canary",
  FR: "Europe/Paris",
  GB: "Europe/London",
  IN: "Asia/Kolkata",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  PT: "Atlantic/Azores",
  US: "Pacific/Honolulu",
};
const LAST_CIVIL_ZONE = "Etc/GMT+12";
const REVIEW_RATIO = 1.5;
const MIN_EXTRA_SEARCHES = 10;

interface Season {
  country: string;
  event: { date: string | Date } | null;
  windows: {
    targetPeriod: string;
    historicalVolume: number;
    baselineMedian: number;
  }[];
}

export function hasSeasonalDemandRise(volume: number, baseline: number) {
  return (
    volume >= Math.max(baseline * REVIEW_RATIO, baseline + MIN_EXTRA_SEARCHES)
  );
}

/** Event dates and target months are local calendar dates, inclusive through their last day. */
export function seoSeasonalTiming(idea: Season, now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: calendarZones[idea.country] ?? LAST_CIVIL_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const month = today.slice(0, 7);
  const date = idea.event?.date;
  const eventDay =
    date instanceof Date ? date.toISOString().slice(0, 10) : date;
  const eventPassed = !!eventDay && eventDay < today;
  const periods = idea.windows.map((window) => window.targetPeriod);
  const upcoming = periods.filter((period) => period >= month);
  const passedMonths = periods.filter((period) => period < month);
  return {
    currentMonth: month,
    eventPassed,
    upcoming,
    passedMonths,
    passed: eventDay
      ? eventPassed
      : passedMonths.length > 0 && !upcoming.length,
  };
}

/** Only months that support a page update can keep that update actionable. */
export function seasonalUpdateHasPassed(idea: Season, now: Date) {
  const windows = idea.windows.filter((w) =>
    hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian),
  );
  return seoSeasonalTiming({ ...idea, windows }, now).passed;
}
