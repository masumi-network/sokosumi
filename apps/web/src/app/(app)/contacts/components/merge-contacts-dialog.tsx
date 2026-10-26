"use client";
import type { Contact } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { coreErrorOf, primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { ChannelIcon, ContactAvatar } from "./contact-visuals";
import { refreshContacts } from "./use-contacts-data";

/**
 * One person, several records: pick the one to keep. The others' channels,
 * timeline and lists move onto it, and it fills its empty fields from them.
 */
export function MergeContactsDialog({
  contacts,
  onClose,
  onMerged,
}: {
  contacts: Contact[];
  onClose: () => void;
  onMerged: (winner: Contact) => void;
}) {
  const t = useTranslations("App.Contacts.mergeDialog");
  const cache = useQueryClient();
  const [winnerId, setWinnerId] = useState(
    () =>
      [...contacts].sort(
        (a, b) =>
          b.interactionCount - a.interactionCount ||
          b.channels.length - a.channels.length,
      )[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const winner = await contactsService.merge(
        winnerId,
        contacts.map((contact) => contact.id).filter((id) => id !== winnerId),
      );
      await refreshContacts(cache, winnerId);
      onMerged(winner);
    } catch (caught) {
      setError(coreErrorOf(caught).message ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("title", { count: contacts.length })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("keep")}</legend>
            {contacts.map((contact) => (
              <label
                key={contact.id}
                className={cn(
                  "has-focus-visible:ring-ring flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2",
                  winnerId === contact.id
                    ? "border-primary-tertiary bg-primary-quinary"
                    : "hover:bg-quinary",
                )}
              >
                <input
                  type="radio"
                  name="merge-winner"
                  value={contact.id}
                  checked={winnerId === contact.id}
                  onChange={() => setWinnerId(contact.id)}
                  className="accent-primary size-4 shrink-0"
                />
                <ContactAvatar
                  name={contact.name}
                  src={contact.avatarUrl}
                  email={primaryEmail(contact.channels)}
                  className="size-8"
                />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {contact.name}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {[contact.role, contact.organization]
                      .filter(Boolean)
                      .join(" · ") || t("noDetails")}
                  </span>
                </span>
                <span className="text-muted-foreground flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums">
                  <span className="flex gap-1.5">
                    {[...new Set(contact.channels.map((c) => c.type))].map(
                      (type) => (
                        <ChannelIcon key={type} type={type} />
                      ),
                    )}
                  </span>
                  {t("interactions", { count: contact.interactionCount })}
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-semantic-destructive-label text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={!winnerId}
            >
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
