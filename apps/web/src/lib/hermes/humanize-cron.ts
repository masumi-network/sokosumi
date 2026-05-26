/**
 * Minimal cron → human-readable English humanizer.
 *
 * Handles the patterns the Hermes orchestrator + user-scheduled briefs
 * actually produce. Returns null when the expression is too exotic to phrase
 * confidently; the caller should fall back to the raw cron string in that
 * case rather than guess.
 *
 * Supports:
 *   - "@hourly" / "@daily" / "@weekly" / "@monthly" / "@yearly" macros
 *   - 5-field cron: minute hour day month weekday
 *   - simple star ("*"), single int, comma list ("1,15"), step ("*\/6"),
 *     and ranges ("1-5") on minute / hour / weekday
 *   - days-of-month restricted to a single int (e.g. "1st of every month")
 *
 * Anything else returns null on purpose — we'd rather show the raw cron than
 * a misleading paraphrase.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MACROS: Record<string, string> = {
  "@hourly": "Every hour",
  "@daily": "Every day at midnight",
  "@midnight": "Every day at midnight",
  "@weekly": "Every Sunday at midnight",
  "@monthly": "On the 1st of every month at midnight",
  "@annually": "On January 1st at midnight",
  "@yearly": "On January 1st at midnight",
};

interface ParsedField {
  kind: "any" | "int" | "list" | "step" | "range";
  values?: number[];
  step?: number;
  from?: number;
  to?: number;
}

function parseField(raw: string): ParsedField | null {
  if (raw === "*") return { kind: "any" };

  // Step: "*/N" or "N-M/S"
  const stepMatch = /^(\*|\d+(?:-\d+)?)\/(\d+)$/.exec(raw);
  if (stepMatch) {
    const step = Number(stepMatch[2]);
    if (!Number.isFinite(step) || step <= 0) return null;
    return { kind: "step", step };
  }

  // Range: "N-M"
  const rangeMatch = /^(\d+)-(\d+)$/.exec(raw);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { kind: "range", from, to };
  }

  // List: "1,3,5"
  if (raw.includes(",")) {
    const values = raw.split(",").map(Number);
    if (values.some((n) => !Number.isFinite(n))) return null;
    return { kind: "list", values };
  }

  // Single int
  const n = Number(raw);
  if (Number.isFinite(n)) return { kind: "int", values: [n] };

  return null;
}

function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  const mm = minute.toString().padStart(2, "0");
  if (minute === 0) return `${h12}:00 ${ampm}`;
  return `${h12}:${mm} ${ampm}`;
}

function formatWeekday(parsed: ParsedField): string | null {
  if (parsed.kind === "any") return null;
  if (parsed.kind === "int") {
    const day = parsed.values![0]!;
    if (day < 0 || day > 7) return null;
    // cron treats both 0 and 7 as Sunday
    return DAY_NAMES[day === 7 ? 0 : day]!;
  }
  if (parsed.kind === "range") {
    if (parsed.from === 1 && parsed.to === 5) return "every weekday";
    if (parsed.from === 0 && parsed.to === 6) return null; // every day = no qualifier
    const fromName = DAY_NAMES[parsed.from!];
    const toName = DAY_NAMES[parsed.to!];
    if (!fromName || !toName) return null;
    return `${fromName} through ${toName}`;
  }
  if (parsed.kind === "list") {
    const names = parsed.values!.map((d) => DAY_NAMES[d === 7 ? 0 : d]);
    if (names.some((n) => !n)) return null;
    return joinList(names as string[]);
  }
  return null;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * @returns Human-readable phrase, or null when the pattern is unfamiliar.
 */
export function humanizeCron(expr: string): string | null {
  if (!expr) return null;
  const trimmed = expr.trim();
  if (trimmed.length === 0) return null;

  // Macros
  const macro = MACROS[trimmed.toLowerCase()];
  if (macro) return macro;

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;

  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = parseField(minuteRaw);
  const hour = parseField(hourRaw);
  const dom = parseField(domRaw);
  const month = parseField(monthRaw);
  const dow = parseField(dowRaw);

  if (!minute || !hour || !dom || !month || !dow) return null;

  // Month must be "any" — we don't humanize month-specific schedules here.
  if (month.kind !== "any") return null;

  // "every N minutes" — minute step, everything else open
  if (
    minute.kind === "step" &&
    hour.kind === "any" &&
    dom.kind === "any" &&
    dow.kind === "any"
  ) {
    return minute.step === 1 ? "Every minute" : `Every ${minute.step} minutes`;
  }

  // "every N hours, on the hour"
  if (
    minute.kind === "int" &&
    minute.values![0] === 0 &&
    hour.kind === "step" &&
    dom.kind === "any" &&
    dow.kind === "any"
  ) {
    return hour.step === 1 ? "Every hour" : `Every ${hour.step} hours`;
  }

  // Fixed time of day
  if (minute.kind === "int" && hour.kind === "int") {
    const time = formatTime(hour.values![0]!, minute.values![0]!);
    const weekday = formatWeekday(dow);

    if (dow.kind === "any" && dom.kind === "any") {
      return `Every day at ${time}`;
    }
    if (dow.kind !== "any" && dom.kind === "any") {
      if (weekday === "every weekday") {
        return `Every weekday at ${time}`;
      }
      if (weekday) return `${weekday} at ${time}`;
    }
    if (dom.kind === "int" && dow.kind === "any") {
      const day = dom.values![0]!;
      return `On the ${ordinal(day)} of every month at ${time}`;
    }
  }

  return null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
