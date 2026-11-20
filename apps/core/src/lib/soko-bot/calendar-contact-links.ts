import { escapeMarkdownLinkLabel, findBareHttpUrlHits } from "@sokosumi/utils";
import { fromMarkdown } from "mdast-util-from-markdown";
import { z } from "zod";
import { parseAddress } from "@/lib/contacts/capture-provider";

const reference = z.object({
  email: z.email(),
  name: z.string().min(1).max(200).optional(),
  link: z.templateLiteral([
    "/contacts?contact=",
    z.uuid(),
    "&workspace=",
    z.uuid(),
  ]),
});
const calendarResult = z.object({
  events: z.array(
    z.object({
      attendees: z.array(z.string()).optional(),
      attendeesIncomplete: z.boolean().optional(),
      organizer: z.string().nullish(),
      contactReferences: z.array(reference).optional(),
    }),
  ),
});

const compactCalendar = z.object({
  truncated: z.literal(true),
  calendarContactReferences: z.array(reference),
});

function calendarEvidence(result: unknown) {
  const events = calendarResult.safeParse(result).data?.events;
  const references = events
    ? events.flatMap((event) => event.contactReferences ?? [])
    : (compactCalendar.safeParse(result).data?.calendarContactReferences ?? []);
  return { events, references };
}

export function calendarMailboxReferences(result: unknown) {
  return calendarEvidence(result).references.map(({ email, link }) => ({
    email,
    link,
  }));
}

interface ToolCall {
  capability: string;
  status: string;
  result: unknown;
}

function recordUnique(
  map: Map<string, string | null>,
  key: string,
  value: string,
) {
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key) !== value) map.set(key, null);
}

/** Resolve exact mailboxes and corroborated full names in this turn. An invite
 * label or a shared inbox alone never establishes a personal name. */
export function linkCalendarContacts(
  text: string,
  calls: readonly ToolCall[],
): string {
  const links = new Map<string, string | null>();
  const nameOwners = new Map<string, string | null>();
  const confirmedNames = new Set<string>();
  let completeRosters = true;
  for (const call of calls) {
    if (
      call.capability !== "list_calendar_events" ||
      call.status !== "COMPLETED"
    )
      continue;
    const { events, references } = calendarEvidence(call.result);
    if (!events || events.some((event) => event.attendeesIncomplete))
      completeRosters = false;
    for (const ref of references) {
      const email = ref.email.toLowerCase();
      recordUnique(links, email, ref.link);
      if (ref.name && /\S\s+\S/u.test(ref.name)) {
        confirmedNames.add(ref.name);
        recordUnique(nameOwners, ref.name.toLowerCase(), email);
      }
    }
    // A second person with the same invite name makes a name-only mention
    // ambiguous, even when the other person has no saved contact.
    for (const event of events ?? []) {
      for (const guest of [
        ...(event.attendees ?? []),
        ...(event.organizer ? [event.organizer] : []),
      ]) {
        const address = parseAddress(guest, "invitation");
        if (address?.name)
          recordUnique(nameOwners, address.name.toLowerCase(), address.email);
      }
    }
  }
  for (const name of completeRosters ? confirmedNames : []) {
    const email = nameOwners.get(name.toLowerCase());
    if (email) links.set(name.toLowerCase(), links.get(email) ?? null);
  }
  const lower = text.toLowerCase();
  const keys = [...links.keys()]
    .filter((key) => links.get(key) && lower.includes(key))
    .sort((a, b) => b.length - a.length);
  if (!keys.length) return text;

  // Parsed node positions keep unrelated Markdown, event links, and code byte-for-byte.
  const candidates = keys.map((key) => RegExp.escape(key)).join("|");
  const wholeMention = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}.!#$%&'*+/=?^_{|}~@-])(?:${candidates})(?![\\p{L}\\p{N}\\p{M}_@-]|\\.[\\p{L}\\p{N}])`,
    "giu",
  );
  const parts: string[] = [];
  let previous = 0;
  function add(start: number, end: number, label: string, link: string) {
    parts.push(
      text.slice(previous, start),
      `[${escapeMarkdownLinkLabel(label)}](${link})`,
    );
    previous = end;
  }
  type Document = ReturnType<typeof fromMarkdown>;
  function visit(node: Document | Document["children"][number]) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "link") {
      const child = node.children[0];
      if (node.children.length !== 1 || child?.type !== "text") return;
      const label = child.value.replace(/^mailto:/i, "");
      const key = label.toLowerCase();
      const link = links.get(key);
      if (
        link &&
        label.includes("@") &&
        node.url.toLowerCase() === `mailto:${key}`
      )
        add(start, end, label, link);
      return;
    }
    if (node.type === "text") {
      const raw = text.slice(start, end);
      const urls = findBareHttpUrlHits(raw);
      for (const match of raw.matchAll(wholeMention)) {
        const label = match[0];
        const link = links.get(label.toLowerCase());
        if (!link || (!label.includes("@") && !confirmedNames.has(label)))
          continue;
        if (
          urls.some(
            (url) =>
              url.start <= match.index &&
              match.index < url.start + url.url.length,
          )
        )
          continue;
        add(
          start + match.index,
          start + match.index + label.length,
          label,
          link,
        );
      }
    } else if ("children" in node && node.type !== "linkReference") {
      // Inline raw HTML can wrap text in its own anchor.
      if (
        node.type !== "root" &&
        node.children.some((child) => child.type === "html")
      )
        return;
      for (const child of node.children) visit(child);
    }
  }
  visit(fromMarkdown(text));
  return previous ? parts.join("") + text.slice(previous) : text;
}
