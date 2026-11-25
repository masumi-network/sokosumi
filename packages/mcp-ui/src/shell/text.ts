import en from "../../messages/en.json" with { type: "json" };

export type MessageKey = keyof typeof en;

/** English at launch (SOKD-413). Fills `{name}` placeholders from `values`. */
export function t(
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return en[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );
}

export interface HostLocale {
  locale?: string;
  timeZone?: string;
}

/** A date and time in the host's locale and time zone, as the host reports them. */
export function formatDateTime(iso: string, host: HostLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  // A host may send a locale or time zone this runtime does not know: drop
  // the time zone first, then the locale.
  for (const [locale, timeZone] of [
    [host.locale, host.timeZone],
    [host.locale, undefined],
  ]) {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
        date,
      );
    } catch {}
  }
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

/**
 * Whether `url` is under the Web base URL Core puts on the result.
 * A view opens only these links (ADR 0083).
 */
export function isUnderBase(url: string, base: string | undefined): boolean {
  if (!base) return false;
  try {
    const target = new URL(url);
    const root = new URL(base);
    if (root.protocol !== "https:" && root.protocol !== "http:") return false;
    const prefix = root.pathname.endsWith("/")
      ? root.pathname
      : `${root.pathname}/`;
    return (
      target.origin === root.origin &&
      (target.pathname === root.pathname || target.pathname.startsWith(prefix))
    );
  } catch {
    return false;
  }
}
