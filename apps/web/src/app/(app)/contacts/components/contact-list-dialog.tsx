"use client";
import { type ContactList, ContactListColor } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { coreErrorOf, LIST_COLOR_DOT } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { CONTACT_LISTS_KEY } from "./use-contacts-data";

const COLORS = Object.values(ContactListColor);

/** Create a list, or rename, recolor and describe one. */
export function ContactListDialog({
  list,
  onClose,
  onSaved,
}: {
  list?: ContactList;
  onClose: () => void;
  onSaved: (list: ContactList) => void;
}) {
  const t = useTranslations("App.Contacts.listDialog");
  const cache = useQueryClient();
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState<ContactListColor>(list?.color ?? "blue");
  const [description, setDescription] = useState(list?.description ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    setPending(true);
    setError("");
    try {
      const body = {
        name: name.trim(),
        color,
        description: description.trim() || null,
      };
      const saved = list
        ? await contactsService.updateList(list.id, body)
        : await contactsService.createList(body);
      await cache.invalidateQueries({ queryKey: CONTACT_LISTS_KEY });
      onSaved(saved);
    } catch (caught) {
      setError(coreErrorOf(caught).message ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {list ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="contact-list-name">{t("name")}</Label>
            <Input
              id="contact-list-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              aria-invalid={!!error && !name.trim()}
              aria-describedby={error ? "contact-list-error" : undefined}
              placeholder={t("namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("color")}</legend>
            <div className="flex flex-wrap gap-1">
              {COLORS.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "has-focus-visible:ring-ring flex size-10 cursor-pointer items-center justify-center rounded-full has-focus-visible:ring-2 md:size-8",
                    color === option ? "bg-quaternary" : "hover:bg-quinary",
                  )}
                >
                  <input
                    type="radio"
                    name="contact-list-color"
                    value={option}
                    checked={color === option}
                    onChange={() => setColor(option)}
                    className="sr-only"
                  />
                  <span className="sr-only">{t(`colors.${option}`)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full",
                      LIST_COLOR_DOT[option],
                    )}
                  >
                    {color === option ? (
                      <Check className="text-primary-foreground size-3" />
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="contact-list-description">
              {t("descriptionLabel")}
            </Label>
            <Textarea
              id="contact-list-description"
              value={description}
              maxLength={500}
              rows={2}
              placeholder={t("descriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error ? (
            <p
              id="contact-list-error"
              role="alert"
              className="text-foreground text-sm"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {list ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
