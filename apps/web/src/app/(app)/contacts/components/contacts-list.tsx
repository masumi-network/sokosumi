"use client";
import type { Contact } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import { ContactAvatar, ReplyChip } from "./contact-visuals";

/**
 * The contacts as a plain list for phones, where a spreadsheet only shows a
 * name and half an address: who, how to reach them, and whether they answered.
 */
export function ContactsList({
  contacts,
  onOpen,
  hasMore,
  loadingMore,
  onLoadMore,
  footer,
}: {
  contacts: Contact[];
  onOpen: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  footer: string;
}) {
  const t = useTranslations("App.Contacts");
  const now = new Date();
  return (
    <div>
      <ul aria-label={t("grid.label")} className="divide-y">
        {contacts.map((contact) => {
          const email = primaryEmail(contact.channels);
          const detail =
            email ??
            ([contact.role, contact.organization].filter(Boolean).join(" · ") ||
              null);
          return (
            <li key={contact.id}>
              <button
                type="button"
                onClick={() => onOpen(contact.id)}
                className="hover:bg-card-background-hover flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start"
              >
                <ContactAvatar
                  name={contact.name}
                  src={contact.avatarUrl}
                  email={email}
                  kind={contact.kind}
                  className="size-8"
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
                {contact.replyState === "NO_REPLY" ||
                contact.replyState === "AWAITING_REPLY" ? (
                  <ReplyChip
                    state={contact.replyState}
                    since={contact.awaitingReplySince}
                    now={now}
                  />
                ) : null}
              </button>
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
