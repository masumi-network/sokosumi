"use client";

import type { Contact } from "@sokosumi/core-client";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
import { primaryEmail, sortChannels } from "@/app/contacts/contacts-view";
import type { NormalizedMention } from "@/components/ui/mention-textarea-utils";
import { parseMentions } from "@/lib/utils/mention-parser";

export interface TaskContactTag {
  id: string;
  name: string;
}

/** The Task page's tagged contacts, each opening its contact. */
export function TaskContactsSection({
  contacts,
}: {
  contacts: TaskContactTag[];
}) {
  const t = useTranslations("App.Tasks.Contacts");
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium">
        {t("title")}
      </h2>
      <ul className="flex flex-wrap gap-1">
        {contacts.map((contact) => (
          <li key={contact.id} className="min-w-0">
            <Link
              href={`/contacts?contact=${contact.id}`}
              className="hover:bg-accent focus-visible:ring-ring inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium outline-none focus-visible:ring-2"
            >
              <UserRound className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{contact.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A contact row in the brief's @ menu: their picture and a Contact label. */
export function ContactMentionItem({ contact }: { contact: Contact }) {
  const t = useTranslations("App.Tasks.Contacts");
  return (
    <>
      <ContactAvatar
        name={contact.name}
        src={contact.avatarUrl}
        email={primaryEmail(contact.channels)}
        kind={contact.kind}
        className="size-6"
      />
      <span className="min-w-0 flex-1 truncate">{contact.name}</span>
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
        <UserRound className="size-3" aria-hidden />
        {t("label")}
      </span>
    </>
  );
}

/** Default look of a non-contact row, as the editor draws it. */
export function MentionInitialItem({
  mention,
}: {
  mention: NormalizedMention;
}) {
  return (
    <>
      <div className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
        {mention.value.charAt(0).toUpperCase()}
      </div>
      <span className="truncate">{mention.value}</span>
    </>
  );
}

/**
 * Starts the contact details the form adds on save. Everything from it to the
 * end is rebuilt from the tagged contacts on every save, so edits and retries
 * never repeat it. Rendered Markdown drops the comment.
 */
const CONTACT_DETAILS_MARKER = "<!-- sokosumi:contacts -->";
const CONTACT_LINK = /\[(?:\\.|[^\]\\])*\]\(\/contacts\?contact=([\w-]+)\)/g;

/** The brief without the contact details a save added. */
export function stripContactDetails(description: string): string {
  const start = description.indexOf(CONTACT_DETAILS_MARKER);
  return start === -1 ? description : description.slice(0, start).trimEnd();
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
      id: match[1] ?? "",
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

/**
 * The brief as saved: each picked `@id:slug` becomes a link to the contact
 * (its name, no @, so the editor reads it back as a link, not a mention),
 * and the tagged contacts' details follow at the end under `heading`.
 */
export function expandContactMentions(
  brief: string,
  contacts: readonly Contact[],
  heading: string,
): string {
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  let body = "";
  let last = 0;
  for (const mention of parseMentions(brief)) {
    const contact = byId.get(mention.id);
    if (!contact) continue;
    body += `${brief.slice(last, mention.start)}[${contact.name.replace(/[[\]\\]/g, "\\$&")}](/contacts?contact=${contact.id})`;
    last = mention.end;
  }
  body = `${body}${brief.slice(last)}`.trimEnd();
  if (contacts.length === 0) return body;
  const details = contacts.map((contact) => `- ${contactBrief(contact)}`);
  return [body, CONTACT_DETAILS_MARKER, `**${heading}**`, details.join("\n")]
    .filter(Boolean)
    .join("\n\n");
}
