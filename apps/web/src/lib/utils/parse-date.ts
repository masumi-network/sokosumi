export function parseDate(
  value: string | number | Date | null | undefined,
): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value;
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  return isNaN(date.getTime()) ? undefined : date;
}

export function parseMonth(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1; // 0-based
  const d = new Date(Date.UTC(year, month, 1));
  return isNaN(d.getTime()) ? undefined : d;
}

export function parseISOWeek(
  value: string | null | undefined,
): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // ISO week: get Monday of week 1, then add (week-1)*7 days
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // 1..7, with Monday=1
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const mondayTarget = new Date(mondayW1);
  mondayTarget.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  return isNaN(mondayTarget.getTime()) ? undefined : mondayTarget;
}
