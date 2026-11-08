"use client";
import type { Contact, ContactDuplicateGroup } from "@sokosumi/core-client";
import { GitMerge } from "lucide-react";
import { useTranslations } from "next-intl";
import { contactReach, primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChannelIcon, ContactAvatar } from "./contact-visuals";

/** Every group of contacts that looks like one person, each a merge away. */
export function DuplicatesDialog({
  groups,
  capped = false,
  onMerge,
  onOpenContact,
  onClose,
}: {
  groups: ContactDuplicateGroup[];
  /** Core has more groups than it returned; merging reveals the next ones. */
  capped?: boolean;
  onMerge: (contacts: Contact[]) => void;
  onOpenContact: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App.Contacts.duplicatesDialog");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(capped ? "titleMore" : "title", { count: groups.length })}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {groups.length ? (
          <ul className="-mx-1 grid min-h-0 gap-3 overflow-y-auto px-1">
            {groups.map((group) => (
              <li
                key={group.contacts.map((contact) => contact.id).join(",")}
                className="grid gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {group.contacts[0]?.name ?? group.name}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onMerge(group.contacts)}
                    aria-label={t("mergeGroup", {
                      name: group.contacts[0]?.name ?? group.name,
                    })}
                  >
                    <GitMerge aria-hidden className="size-4" />
                    {t("merge")}
                  </Button>
                </div>
                <ul className="grid gap-1">
                  {group.contacts.map((contact) => (
                    <li key={contact.id}>
                      <button
                        type="button"
                        onClick={() => onOpenContact(contact.id)}
                        className="hover:bg-quinary focus-visible:ring-ring flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <ContactAvatar
                          name={contact.name}
                          src={contact.avatarUrl}
                          email={primaryEmail(contact.channels)}
                          kind={contact.kind}
                        />
                        <span className="grid min-w-0 flex-1">
                          <span className="truncate text-sm">
                            {contact.name}
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {detailOf(contact) || t("noDetails")}
                          </span>
                        </span>
                        <span className="text-muted-foreground flex shrink-0 gap-1.5">
                          {[
                            ...new Set(
                              contact.channels.map((channel) => channel.type),
                            ),
                          ].map((type) => (
                            <ChannelIcon key={type} type={type} />
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What tells the records apart: their email or first channel, and company. */
function detailOf(contact: Contact): string {
  return [contactReach(contact.channels), contact.organization]
    .filter(Boolean)
    .join(" · ");
}
