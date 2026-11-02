const MILLISECONDS_PER_DAY = 86_400_000;

const WARMUP_DAILY_CAPS = [
  { untilDay: 3, cap: 50 },
  { untilDay: 7, cap: 100 },
  { untilDay: 14, cap: 250 },
  { untilDay: 21, cap: 500 },
  { untilDay: 28, cap: 1_000 },
];

export const WARMUP_LOOKBACK_DAYS = 7;
export const MIN_WARMUP_SAMPLE_SIZE = 50;
export const MAX_WARMUP_BOUNCE_RATE = 0.04;
export const MAX_WARMUP_COMPLAINT_RATE = 0.001;

export interface WarmupRecipient {
  id: string;
  confirmedAt: Date | null;
  consentAt: Date | null;
  lastEngagedAt: Date | null;
}

interface WarmupSample {
  attempted: number;
  hardBounced: number;
  complained: number;
}

export interface WarmupRates {
  bounceRate: number;
  complaintRate: number;
  sampleSize: number;
}

export function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function warmupDay(start: Date, now: Date): number {
  return Math.max(
    0,
    (utcDay(now).getTime() - utcDay(start).getTime()) / MILLISECONDS_PER_DAY,
  );
}

export function warmupDailyCap(day: number): number | null {
  return WARMUP_DAILY_CAPS.find(({ untilDay }) => day < untilDay)?.cap ?? null;
}

function compareNewestDate(a: Date | null, b: Date | null): number {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return b.getTime() - a.getTime();
}

export function compareWarmupRecipients(
  a: WarmupRecipient,
  b: WarmupRecipient,
): number {
  return (
    compareNewestDate(a.lastEngagedAt, b.lastEngagedAt) ||
    compareNewestDate(
      a.confirmedAt ?? a.consentAt,
      b.confirmedAt ?? b.consentAt,
    ) ||
    a.id.localeCompare(b.id)
  );
}

export function warmupRates(sample: WarmupSample): WarmupRates {
  return {
    bounceRate: sample.attempted ? sample.hardBounced / sample.attempted : 0,
    complaintRate: sample.attempted ? sample.complained / sample.attempted : 0,
    sampleSize: sample.attempted,
  };
}

export function warmupPauseReason(
  rates: WarmupRates,
): "BOUNCE_RATE" | "COMPLAINT_RATE" | null {
  if (rates.sampleSize < MIN_WARMUP_SAMPLE_SIZE) return null;
  if (rates.complaintRate > MAX_WARMUP_COMPLAINT_RATE) return "COMPLAINT_RATE";
  if (rates.bounceRate > MAX_WARMUP_BOUNCE_RATE) return "BOUNCE_RATE";
  return null;
}
