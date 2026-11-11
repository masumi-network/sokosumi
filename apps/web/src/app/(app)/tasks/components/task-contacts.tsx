"use client";

import type { Contact } from "@sokosumi/core-client";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
import { primaryEmail } from "@/app/contacts/contacts-view";
import type { NormalizedMention } from "@/components/ui/mention-textarea-utils";

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
