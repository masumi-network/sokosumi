const SECOND_IN_MS = 1000;
const MINUTE_IN_MS = 60 * SECOND_IN_MS;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const MONTH_IN_MS = 30 * DAY_IN_MS;
const YEAR_IN_MS = 365 * DAY_IN_MS;

function getRelativeTimeValueAndUnit(diffInMs: number): {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
} {
  const absoluteDiff = Math.abs(diffInMs);

  if (absoluteDiff < MINUTE_IN_MS) {
    return {
      value: Math.round(diffInMs / SECOND_IN_MS),
      unit: "second",
    };
  }

  if (absoluteDiff < HOUR_IN_MS) {
    return {
      value: Math.round(diffInMs / MINUTE_IN_MS),
      unit: "minute",
    };
  }

  if (absoluteDiff < DAY_IN_MS) {
    return {
      value: Math.round(diffInMs / HOUR_IN_MS),
      unit: "hour",
    };
  }

  if (absoluteDiff < MONTH_IN_MS) {
    return {
      value: Math.round(diffInMs / DAY_IN_MS),
      unit: "day",
    };
  }

  if (absoluteDiff < YEAR_IN_MS) {
    return {
      value: Math.round(diffInMs / MONTH_IN_MS),
      unit: "month",
    };
  }

  return {
    value: Math.round(diffInMs / YEAR_IN_MS),
    unit: "year",
  };
}

function getDayDifferenceFromNow(dateObj: Date, now: Date): number {
  const targetDate = new Date(dateObj);
  const currentDate = new Date(now);

  targetDate.setHours(0, 0, 0, 0);
  currentDate.setHours(0, 0, 0, 0);

  return Math.round((targetDate.getTime() - currentDate.getTime()) / DAY_IN_MS);
}

export function formatShortDate(
  date: string | Date,
  locale: string = "en",
): string {
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return "—";
    }
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(dateObj);
  } catch {
    return "—";
  }
}

export function formatShortDateTime(
  date: string | Date,
  locale: string = "en",
): string {
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(dateObj);
  } catch {
    return "—";
  }
}

export function formatTimeAgo(
  date: string | Date,
  locale: string = "en",
): string {
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return "—";
    }
    const now = new Date();
    const { value, unit } = getRelativeTimeValueAndUnit(
      dateObj.getTime() - now.getTime(),
    );
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      value,
      unit,
    );
  } catch {
    return "—";
  }
}

export function getDateGroupKey(
  dateInput: Date | number,
  locale: string = "en",
): string | null {
  const dateObj = new Date(dateInput);
  if (isNaN(dateObj.getTime())) {
    return null;
  }

  const now = new Date();
  const dayDiff = getDayDifferenceFromNow(dateObj, now);
  const relativeDayFormatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });

  if (dayDiff >= -1 && dayDiff <= 1) {
    return relativeDayFormatter.format(dayDiff, "day");
  }

  if (dayDiff >= -6 && dayDiff <= 6) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
    }).format(dateObj);
  }

  const isSameYear = dateObj.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(isSameYear ? {} : { year: "numeric" }),
  }).format(dateObj);
}
