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
// Matches only the shape a save writes: start marker, bold heading, list and
// (since the end marker was added) end marker. A bare marker elsewhere, e.g.
// in a code sample, is left alone, and so is anything after the list.
const DETAILS_BLOCK =
  /\n*^<!-- sokosumi:contacts -->\n\n\*\*[^\n]*\*\*\n\n(?:- [^\n]*(?:\n|$))*(?:\n?<!-- \/sokosumi:contacts -->)?\n*/gm;
const CONTACT_LINK = /\[((?:\\.|[^\]\\])*)\]\(\/contacts\?contact=([\w-]+)\)/g;

/** The brief without the contact details a save added. */
export function stripContactDetails(description: string): string {
  const stripped = description.replace(DETAILS_BLOCK, "\n\n");
  return stripped === description ? description : stripped.trim();
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
  return [`**${contact.name}**`, ...about].join(" · ");
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
