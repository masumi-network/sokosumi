import type { Contact } from "@sokosumi/core-client";
import { sortChannels } from "@/app/contacts/contacts-view";
import { parseMentions } from "@/lib/utils/mention-parser";

/**
 * Bound the contact details the form adds on save. The block between them is
 * rebuilt from the tagged contacts on every save, so edits and retries never
 * repeat it; text written after it (by the API or an agent) is kept. Rendered
 * Markdown drops the comments.
 */
const DETAILS_START = "<!-- sokosumi:contacts -->";
const DETAILS_END = "<!-- /sokosumi:contacts -->";
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CONTACT_LINK = /\[((?:\\.|[^\]\\])*)\]\(\/contacts\?contact=([\w-]+)\)/g;

/**
 * Last line of the details block starting at `start`, or -1 when it is not
 * one. Current blocks run to the end marker (no start marker or fence
 * between: saved items are single lines);
 * blocks saved before the end marker existed are only heading and list.
 */
function detailsEnd(lines: readonly string[], start: number): number {
  const end = lines.indexOf(DETAILS_END, start + 1);
  const inside = lines.slice(start + 1, end);
  if (
    end !== -1 &&
    !inside.some((line) => line === DETAILS_START || FENCE.test(line))
  )
    return end;
  if (lines[start + 1] !== "" || lines[start + 3] !== "") return -1;
  if (!/^\*\*.*\*\*$/.test(lines[start + 2] ?? "")) return -1;
  let last = start + 3;
  while (lines[last + 1]?.startsWith("- ")) last++;
  return last === start + 3 ? -1 : last;
}

/**
 * The brief without the contact details a save added. Only marker lines
 * outside fenced code count, so a pasted example stays as written.
 */
export function stripContactDetails(description: string): string {
  const lines = description.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const [, mark, rest = ""] = FENCE.exec(line) ?? [];
    if (fence) {
      // A closing fence: same character, at least as long, nothing after.
      if (mark?.[0] === fence[0] && mark.length >= fence.length && !rest.trim())
        fence = null;
    } else if (mark) {
      fence = mark;
    } else if (line === DETAILS_START) {
      const end = detailsEnd(lines, i);
      if (end !== -1) {
        changed = true;
        while (kept.at(-1)?.trim() === "") kept.pop();
        i = end;
        while (lines[i + 1]?.trim() === "") i++;
        if (kept.length > 0 && i + 1 < lines.length) kept.push("");
        continue;
      }
    }
    kept.push(line);
  }
  return changed ? kept.join("\n").trim() : description;
}

/** Contact links as their plain names, for readers outside the workspace. */
export function unlinkContacts(markdown: string): string {
  return markdown.replace(CONTACT_LINK, "$1");
}

/**
 * Contacts the brief mentions, in order: `@id:slug` tokens picked from the @
 * menu (ids in `known`) and the contact links an earlier save left.
 */
export function mentionedContactIds(
  brief: string,
  known: ReadonlySet<string>,
): string[] {
  const found = [
    ...parseMentions(brief).map((mention) => ({
      id: mention.id,
      at: mention.start,
    })),
    ...[...brief.matchAll(CONTACT_LINK)].map((match) => ({
      id: match[2] ?? "",
      at: match.index,
      link: true,
    })),
  ]
    .filter((item) => "link" in item || known.has(item.id))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.id);
  return [...new Set(found)];
}

/** What a tagged contact adds to the Task: who they are and how to reach them. */
export function contactBrief(contact: Contact): string {
  const about = [
    [contact.role, contact.organization].filter(Boolean).join(", "),
    contact.location,
    ...sortChannels(contact.channels).map((channel) => channel.value),
  ].filter(Boolean);
  // One line per contact, so no field can end the details block early.
  return [`**${contact.name}**`, ...about]
    .join(" · ")
    .replace(/\s*\n\s*/g, " ");
}

const linkTo = (contact: Contact) =>
  `[${contact.name.replace(/[[\]\\]/g, "\\$&")}](/contacts?contact=${contact.id})`;

/**
 * The brief as saved. `contacts` maps each mentioned id to the live contact it
 * stands for now (a merged contact's survivor), or null when it is gone.
 * Picked `@id:slug` tokens and earlier links point at that contact (its name,
 * no @, so the editor reads it back as a link, not a mention); a gone contact
 * keeps only its name. Each live contact's details follow once, under
 * `heading`.
 */
export function expandContactMentions(
  brief: string,
  contacts: ReadonlyMap<string, Contact | null>,
  heading: string,
): string {
  const replace = (id: string, label: string) => {
    const contact = contacts.get(id);
    if (contact === undefined) return null;
    return contact === null ? label : linkTo(contact);
  };
  let body = "";
  let last = 0;
  for (const mention of parseMentions(brief)) {
    const contact = contacts.get(mention.id);
    const text = replace(mention.id, contact?.name ?? mention.slug);
    if (text === null) continue;
    body += `${brief.slice(last, mention.start)}${text}`;
    last = mention.end;
  }
  body = `${body}${brief.slice(last)}`
    .replace(
      CONTACT_LINK,
      (link, label: string, id: string) => replace(id, label) ?? link,
    )
    .trimEnd();
  const live = [
    ...new Map(
      [...contacts.values()]
        .filter((contact) => contact !== null)
        .map((contact) => [contact.id, contact]),
    ).values(),
  ];
  if (live.length === 0) return body;
  const details = live.map((contact) => `- ${contactBrief(contact)}`);
  return [
    body,
    DETAILS_START,
    `**${heading}**`,
    details.join("\n"),
    DETAILS_END,
  ]
    .filter(Boolean)
    .join("\n\n");
}
