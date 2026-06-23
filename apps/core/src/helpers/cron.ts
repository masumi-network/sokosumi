import { CronExpressionParser as cronParser } from "cron-parser";

export interface ComputeNextRunInput {
  cron: string;
  timezone: string;
  from?: Date;
}

export function computeNextRun({
  cron,
  timezone,
  from,
}: ComputeNextRunInput): Date | null {
  try {
    const options = { currentDate: from ?? new Date(), tz: timezone } as const;
    const interval = cronParser.parse(cron, options);
    return interval.next().toDate();
  } catch {
    return null;
  }
}
