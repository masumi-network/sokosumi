"use client";

import type { Contact } from "@sokosumi/core-client";
import { Check, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
import { useContactRows } from "@/app/contacts/components/use-contacts-data";
import {
  matchesContactSearch,
  primaryEmail,
  sortChannels,
} from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";

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

/** What tagging a contact adds to the brief: who they are and how to reach them. */
export function contactBrief(contact: Contact): string {
  const about = [
    [contact.role, contact.organization].filter(Boolean).join(", "),
    contact.location,
    ...sortChannels(contact.channels).map((channel) => channel.value),
  ].filter(Boolean);
  return [`**${contact.name}**`, ...about].join(" · ");
}

/**
 * Tags contacts on a Task. Picking one adds it (and `onTag` puts its details
 * in the brief); picking it again or its chip's x removes the tag only.
 */
export function TaskContactsSelect({
  value,
  onChange,
  onTag,
}: {
  value: TaskContactTag[];
  onChange: (contacts: TaskContactTag[]) => void;
  onTag: (contact: Contact) => void;
}) {
  const t = useTranslations("App.Tasks.Contacts");
  const [open, setOpen] = useState(false);

  function toggle(contact: Contact) {
    if (value.some((tag) => tag.id === contact.id)) {
      onChange(value.filter((tag) => tag.id !== contact.id));
      return;
    }
    onChange([...value, { id: contact.id, name: contact.name }]);
    onTag(contact);
  }

  return (
    <>
      {value.map((contact) => (
        <span
          key={contact.id}
          className="bg-secondary text-secondary-foreground inline-flex h-7 max-w-48 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs font-medium"
        >
          <span className="truncate">{contact.name}</span>
          <button
            type="button"
            aria-label={t("remove", { name: contact.name })}
            className="hit-area hover:bg-accent focus-visible:ring-ring rounded-full p-0.5 outline-none focus-visible:ring-2"
            onClick={() =>
              onChange(value.filter((tag) => tag.id !== contact.id))
            }
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={t("tag")}
            className="text-muted-foreground h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium"
          >
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            {t("tag")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <ContactOptions
            tagged={new Set(value.map((tag) => tag.id))}
            onToggle={toggle}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

/** The workspace's contacts by name; mounted only while the picker is open. */
function ContactOptions({
  tagged,
  onToggle,
}: {
  tagged: Set<string>;
  onToggle: (contact: Contact) => void;
}) {
  const t = useTranslations("App.Tasks.Contacts");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(
    search.trim(),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );
  const rows = useContactRows({
    search: debouncedSearch || undefined,
    sort: "name",
    direction: "asc",
  });
  const contacts =
    rows.data?.pages
      .flatMap((page) => page.contacts)
      .filter((contact) => matchesContactSearch(contact, search)) ?? [];

  return (
    <Command
      className="**:data-[slot=command-list]:max-h-72"
      shouldFilter={false}
    >
      <CommandInput
        autoFocus
        placeholder={t("search")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {rows.isPending ? t("loading") : t("empty")}
        </CommandEmpty>
        {contacts.map((contact) => (
          <CommandItem
            key={contact.id}
            value={contact.id}
            // cmdk's aria-selected follows the active row; this is the tag.
            aria-checked={tagged.has(contact.id)}
            onSelect={() => onToggle(contact)}
          >
            <ContactAvatar
              name={contact.name}
              src={contact.avatarUrl}
              email={primaryEmail(contact.channels)}
              kind={contact.kind}
              className="size-5"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{contact.name}</span>
              {contact.organization ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {contact.organization}
                </span>
              ) : null}
              {tagged.has(contact.id) ? (
                <span className="sr-only">{t("tagged")}</span>
              ) : null}
            </span>
            <Check
              className={cn(
                "size-4",
                tagged.has(contact.id) ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </CommandItem>
        ))}
        {rows.hasNextPage ? (
          <CommandItem
            value="__more_contacts__"
            disabled={rows.isFetchingNextPage}
            onSelect={() => void rows.fetchNextPage()}
            className="text-muted-foreground justify-center"
          >
            {rows.isFetchingNextPage ? t("loading") : t("more")}
          </CommandItem>
        ) : null}
      </CommandList>
    </Command>
  );
}
