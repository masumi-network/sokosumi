export const DATE_VALUE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATETIME_LOCAL_VALUE_REGEX =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/;

type ValidationBoundValue = string | number | Date | null | undefined;

interface DateBounds {
  min?: string;
  max?: string;
}

function parseDateLikeValue(value: number | Date): Date | undefined {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toNonEmptyString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseIsoDatePrefix(value: string): string | undefined {
  const match = /^(\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))T(.+)$/.exec(
    value,
  );
  if (!match) {
    return undefined;
  }

  const datePart = match[1];
  if (!parseDateValue(datePart)) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : datePart;
}

export function formatDateValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateValidationBound(
  value: ValidationBoundValue,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = toNonEmptyString(value);
    if (!trimmed) {
      return undefined;
    }

    const isoDatePrefix = parseIsoDatePrefix(trimmed);
    if (isoDatePrefix) {
      return isoDatePrefix;
    }

    const parsed =
      parseDateValue(trimmed) ??
      (/^\d+$/.test(trimmed)
        ? parseDateLikeValue(Number(trimmed))
        : undefined) ??
      parseDateLikeValue(new Date(trimmed));
    return parsed ? formatDateValue(parsed) : undefined;
  }

  const parsed = parseDateLikeValue(value);
  return parsed ? formatDateValue(parsed) : undefined;
}

export function normalizeDatetimeLocalValidationBound(
  value: ValidationBoundValue,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = toNonEmptyString(value);
    if (!trimmed) {
      return undefined;
    }

    if (isDatetimeLocalValue(trimmed)) {
      return trimmed;
    }

    // DATETIME form values are minute-precision local strings only.
    // Ignore string bounds that are not in datetime-local format (e.g. with seconds/timezone).
    return undefined;
  }

  const parsed = parseDateLikeValue(value);
  return parsed ? formatDatetimeLocalValue(parsed) : undefined;
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

export function isDatetimeLocalValue(value: string): boolean {
  if (!DATETIME_LOCAL_VALUE_REGEX.test(value)) {
    return false;
  }

  const [datePart] = value.split("T");
  return !!datePart && !!parseDateValue(datePart);
}

export function formatDatetimeLocalValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDatetimeLocalValue(value: string): Date | undefined {
  if (!isDatetimeLocalValue(value)) {
    return undefined;
  }

  const [datePart, timePart] = value.split("T");
  if (!parseDateValue(datePart)) {
    return undefined;
  }

  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const [hoursStr, minutesStr] = timePart.split(":");

  return new Date(
    Number(yearStr),
    Number(monthStr) - 1,
    Number(dayStr),
    Number(hoursStr),
    Number(minutesStr),
  );
}

export function isDateValueOutOfBounds(
  dateValue: string,
  bounds: DateBounds,
): boolean {
  return (
    (bounds.min ? dateValue < bounds.min : false) ||
    (bounds.max ? dateValue > bounds.max : false)
  );
}
