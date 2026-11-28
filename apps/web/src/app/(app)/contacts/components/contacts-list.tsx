"use client";
import type { Contact } from "@sokosumi/core-client";
import { ArchiveRestore, CalendarPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONTACT_AVATAR_FILL_CLASS,
  ContactAvatar,
  ReplyChip,
} from "./contact-visuals";

/**
 * The contacts as a plain list for phones, where a spreadsheet only shows a
 * name and half an address: who, how to reach them, and whether they answered.
 */
export function ContactsList({
  contacts,
  onOpen,
  onRestore,
  onFollowUp,
  hasMore,
  loadingMore,
  onLoadMore,
  footer,
}: {
  contacts: Contact[];
  onOpen: (id: string) => void;
  /** Archived rows: a Restore button beside each person. */
  onRestore?: (contact: Contact) => void;
  /** Gone quiet rows: when they last talked, and a follow-up next week. */
  onFollowUp?: (contact: Contact) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  footer: string;
}) {
  const t = useTranslations("App.Contacts");
  const format = useFormatter();
  const now = new Date();
  return (
    <div>
      <ul aria-label={t("grid.label")} className="divide-y">
        {contacts.map((contact) => {
          const email = primaryEmail(contact.channels);
          const detail =
            onFollowUp && contact.lastContactAt
              ? t("quiet.lastTalked", {
                  when: format.relativeTime(
                    new Date(contact.lastContactAt),
                    now,
                  ),
                })
              : (email ??
                ([contact.role, contact.organization, contact.location]
                  .filter(Boolean)
                  .join(" · ") ||
                  null));
          return (
            <li key={contact.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onOpen(contact.id)}
                className="hover:bg-accent transition-colors flex min-h-14 w-full min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start"
              >
                <ContactAvatar
                  name={contact.name}
                  src={contact.avatarUrl}
                  email={email}
                  kind={contact.kind}
                  className={cn("size-8", CONTACT_AVATAR_FILL_CLASS)}
                />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {contact.name}
                  </span>
                  {detail ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {detail}
                    </span>
                  ) : null}
                </span>
                {/* Gone quiet rows say when they last talked instead. */}
                {!onFollowUp &&
                (contact.replyState === "NO_REPLY" ||
                  contact.replyState === "AWAITING_REPLY") ? (
                  <ReplyChip
                    state={contact.replyState}
                    since={contact.awaitingReplySince}
                    now={now}
                  />
                ) : null}
              </button>
              {onRestore ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mx-3 h-10 shrink-0 md:h-8"
                  aria-label={t("panel.restoreName", { name: contact.name })}
                  onClick={() => onRestore(contact)}
                >
                  <ArchiveRestore aria-hidden className="size-4" />
                  {t("panel.restore")}
                </Button>
              ) : null}
              {onFollowUp && contact.followUpAt ? (
                <span className="text-muted-foreground mx-3 shrink-0 text-xs tabular-nums">
                  {t("quiet.followUpOn", {
                    date: format.dateTime(
                      new Date(`${contact.followUpAt}T00:00:00Z`),
                      { day: "numeric", month: "short", timeZone: "UTC" },
                    ),
                  })}
                </span>
              ) : onFollowUp ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mx-3 h-10 shrink-0 md:h-8"
                  aria-label={t("quiet.followUpName", { name: contact.name })}
                  onClick={() => onFollowUp(contact)}
                >
                  <CalendarPlus aria-hidden className="size-4" />
                  {/* Phones keep room for the name: the short label. */}
                  <span className="sm:hidden">{t("quiet.followUpShort")}</span>
                  <span className="hidden sm:inline">
                    {t("quiet.followUp")}
                  </span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
        <p role="status" className="text-muted-foreground text-xs">
          {footer}
        </p>
        {hasMore ? (
          <Button
            size="sm"
            variant="outline"
            loading={loadingMore}
            onClick={onLoadMore}
          >
            {t("grid.loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
