// ---------------------------------------------------------------------------
// Small readers for loosely typed provider JSON.
// ---------------------------------------------------------------------------

export function field(value: unknown, ...keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const found = (value as Record<string, unknown>)[key];
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isoDate(value: unknown): string | null {
  if (typeof value === "number") {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = text(value).trim();
  if (!raw) return null;
  const date = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Addresses and names.
// ---------------------------------------------------------------------------

export interface MailAddress {
  email: string;
  name: string | null;
}

/** Splits `a, "Doe, Jane" <j@x.com>` on the commas that separate addresses. */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === "<") angled = true;
    else if (char === ">") angled = false;
    if ((char === "," || char === ";") && !quoted && !angled) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** "Doe, Jane" → "Jane Doe"; quotes, `(via X)` and stray addresses removed. */
export function cleanPersonName(
  raw: string | null | undefined,
  email?: string,
): string | undefined {
  if (!raw) return undefined;
  let name = raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s*\((via|über|par)\s[^)]*\)\s*$/i, "")
    .replace(/\s*<[^>]*>\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const comma = /^([^,]+),\s*([^,]+)$/.exec(name);
  if (comma?.[1] && comma[2] && !/\b(inc|ltd|llc|gmbh|ag)\b/i.test(name))
    name = `${comma[2]} ${comma[1]}`;
  if (!name || name.includes("@")) return undefined;
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && name.toLowerCase() === local) return undefined;
  return name.slice(0, 200);
}

type NameSource = "contact" | "invitation";
export function parseAddress(
  raw: string,
  nameSource: NameSource,
): MailAddress | null {
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(raw);
  const email = (angle?.[2] ?? raw).trim().replace(/^mailto:/i, "");
  if (!email.includes("@")) return null;
  const lower = email.toLowerCase();
  return {
    email: lower,
    name:
      cleanPersonName(
        angle?.[1],
        nameSource === "contact" ? lower : undefined,
      ) ?? null,
  };
}

/** Addresses from a header string or a provider's recipient objects. */
export function parseAddresses(
  value: unknown,
  nameSource: NameSource = "contact",
): MailAddress[] {
  if (typeof value === "string")
    return splitAddressList(value).flatMap(
      (part) => parseAddress(part, nameSource) ?? [],
    );
  return list(value).flatMap((entry) => {
    if (typeof entry === "string") return parseAddresses(entry, nameSource);
    const nested = field(entry, "emailAddress", "address", "email");
    const inner = nested && typeof nested === "object" ? nested : entry;
    const email = text(field(inner, "emailAddress", "address", "email"))
      .trim()
      .replace(/^mailto:/i, "")
      .toLowerCase();
    if (!email.includes("@")) return [];
    const name = text(field(inner, "name", "displayName"));
    return [
      {
        email,
        name:
          cleanPersonName(name, nameSource === "contact" ? email : undefined) ??
          null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Calendar.
// ---------------------------------------------------------------------------

export interface ParsedAttendee {
  email: string;
  name: string | null;
  self: boolean;
  organizer: boolean;
  resource: boolean;
  declined: boolean;
}

export interface ParsedEvent {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  cancelled: boolean;
  /** Focus time, out of office, working location: not meetings. */
  personal: boolean;
  ownerDeclined: boolean;
  organizerEmail: string | null;
  attendees: ParsedAttendee[];
  link: string | null;
}

const RESOURCE_DOMAIN =
  /(^|\.)(resource\.calendar\.google\.com|group\.calendar\.google\.com|group\.v\.calendar\.google\.com|import\.calendar\.google\.com)$/;

export function parseCalendarAttendee(
  entry: unknown,
  nameSource: NameSource,
  organizerEmail: string | null,
): ParsedAttendee | null {
  const [address] = parseAddresses([entry], nameSource);
  if (!address) return null;
  const response = text(
    field(entry, "responseStatus") ?? field(field(entry, "status"), "response"),
  ).toLowerCase();
  return {
    ...address,
    self: field(entry, "self") === true,
    organizer:
      field(entry, "organizer") === true || address.email === organizerEmail,
    resource:
      field(entry, "resource") === true ||
      text(field(entry, "type")).toLowerCase() === "resource" ||
      RESOURCE_DOMAIN.test(address.email.split("@")[1] ?? ""),
    declined: response === "declined",
  };
}

function eventTime(value: unknown): { iso: string | null; allDay: boolean } {
  const date = text(field(value, "date"));
  if (date) return { iso: isoDate(`${date}T00:00:00Z`), allDay: true };
  let dateTime = text(field(value, "dateTime")) || text(value);
  const zone = text(field(value, "timeZone"));
  // Graph answers in the zone it was asked for, without an offset.
  if (dateTime && !/[zZ]|[+-]\d\d:?\d\d$/.test(dateTime) && /^utc$/i.test(zone))
    dateTime = `${dateTime}Z`;
  return { iso: isoDate(dateTime), allDay: false };
}

/** One Google Calendar or Outlook event. */
export function parseEvent(
  raw: unknown,
  nameSource: NameSource = "contact",
): ParsedEvent | null {
  const id = text(field(raw, "id"));
  const start = eventTime(field(raw, "start"));
  if (!id || !start.iso) return null;
  const organizerEmail =
    parseAddresses([field(raw, "organizer") ?? ""])[0]?.email ?? null;
  const rawAttendees = field(raw, "attendees");
  const rows =
    nameSource === "invitation" && typeof rawAttendees === "string"
      ? splitAddressList(rawAttendees)
      : list(rawAttendees);
  const attendees = rows.flatMap(
    (entry) => parseCalendarAttendee(entry, nameSource, organizerEmail) ?? [],
  );
  const eventType = text(field(raw, "eventType"));
  const showAs = text(field(raw, "showAs")).toLowerCase();
  const ownResponse = text(
    field(field(raw, "responseStatus"), "response"),
  ).toLowerCase();
  return {
    id,
    title: text(field(raw, "summary", "subject", "title")).trim() || "Meeting",
    startsAt: start.iso,
    allDay: start.allDay || field(raw, "isAllDay") === true,
    cancelled:
      text(field(raw, "status")).toLowerCase() === "cancelled" ||
      field(raw, "isCancelled") === true,
    personal: (eventType !== "" && eventType !== "default") || showAs === "oof",
    ownerDeclined:
      attendees.some((attendee) => attendee.self && attendee.declined) ||
      ownResponse === "declined",
    organizerEmail,
    attendees,
    link: text(field(raw, "htmlLink", "webLink")) || null,
  };
}
