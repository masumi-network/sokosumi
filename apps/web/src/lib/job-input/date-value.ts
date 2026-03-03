export const DATE_VALUE_REGEX =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATETIME_LOCAL_VALUE_REGEX =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/;

export function formatDateValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateValue(value: string): Date | undefined {
  if (!DATE_VALUE_REGEX.test(value)) {
    return undefined;
  }

  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  return parsed;
}

export function parseDatetimeLocalValue(value: string): Date | undefined {
  if (!DATETIME_LOCAL_VALUE_REGEX.test(value)) {
    return undefined;
  }

  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return undefined;
  }

  const date = parseDateValue(datePart);
  if (!date) {
    return undefined;
  }

  const [hoursStr, minutesStr] = timePart.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const parsed = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    0,
    0,
  );

  if (
    parsed.getFullYear() !== date.getFullYear() ||
    parsed.getMonth() !== date.getMonth() ||
    parsed.getDate() !== date.getDate() ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes
  ) {
    return undefined;
  }

  return parsed;
}
