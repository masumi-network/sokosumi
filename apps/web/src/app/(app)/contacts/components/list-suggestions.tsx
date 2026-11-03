"use client";
import type { ContactList, ContactSuggestion } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, UserSearch, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./contact-visuals";
import { CONTACT_LISTS_KEY, refreshContacts } from "./use-contacts-data";

const SIZES = [1, 10, 25] as const;
type Size = (typeof SIZES)[number];
/** Core charges this per person found; finding nobody is free. */
const CREDITS_PER_PERSON = 0.5;
const SHOWN = 5;

const suggestionsKey = (listId: string) =>
  ["contact-suggestions", listId] as const;

/**
 * People found on the web for a manual list, waiting to be added or
 * dismissed, and the way to find more. Nothing here is a contact until it is
 * added, so the list itself stays as it was.
 */
export function ListSuggestions({ list }: { list: ContactList }) {
  const t = useTranslations("App.Contacts.suggestions");
  const cache = useQueryClient();
  const [finding, setFinding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const suggestions = useQuery({
    queryKey: suggestionsKey(list.id),
    queryFn: () => contactsService.suggestions(list.id),
  });
  const rows = suggestions.data ?? [];
  const shown = expanded ? rows : rows.slice(0, SHOWN);

  async function decide(action: "add" | "dismiss", ids: string[]) {
    setBusy((current) => [...current, ...ids]);
    try {
      if (action === "add") {
        const { count } = await contactsService.addSuggestions(list.id, ids);
        toast.success(t("added", { count, list: list.name }));
        await refreshContacts(cache);
      } else {
        await contactsService.dismissSuggestions(list.id, ids);
      }
      cache.setQueryData<ContactSuggestion[]>(
        suggestionsKey(list.id),
        (current) => current?.filter((row) => !ids.includes(row.id)),
      );
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("decideFailed"));
    } finally {
      setBusy((current) => current.filter((id) => !ids.includes(id)));
    }
  }

  return (
    <section
      aria-label={t("title")}
      className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
    >
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-sm font-medium">
          {rows.length ? t("titleCount", { count: rows.length }) : t("title")}
        </h2>
        {rows.length ? null : (
          <p className="text-muted-foreground hidden truncate text-sm sm:block">
            {t("hint")}
          </p>
        )}
        <div className="ms-auto flex items-center gap-1">
          {rows.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy.length > 0}
              onClick={() =>
                void decide(
                  "add",
                  rows.map((row) => row.id),
                )
              }
            >
              {t("addAll")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setFinding(true)}>
            <UserSearch aria-hidden className="size-4" />
            {t("find")}
          </Button>
        </div>
      </div>
      {rows.length ? (
        <ul className={cn(HOLDER_ITEM_CLASS, "divide-border divide-y")}>
          {shown.map((row) => (
            <SuggestionRow
              key={row.id}
              row={row}
              busy={busy.includes(row.id)}
              onAdd={() => void decide("add", [row.id])}
              onDismiss={() => void decide("dismiss", [row.id])}
            />
          ))}
          {rows.length > SHOWN ? (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="w-full rounded-none"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? t("showFewer")
                  : t("showAll", { count: rows.length })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {finding ? (
        <FindPeopleDialog
          list={list}
          onClose={() => setFinding(false)}
          onFound={(found) => {
            cache.setQueryData<ContactSuggestion[]>(
              suggestionsKey(list.id),
              (current) => [...found, ...(current ?? [])],
            );
            void cache.invalidateQueries({ queryKey: CONTACT_LISTS_KEY });
            setExpanded(false);
          }}
        />
      ) : null}
    </section>
  );
}

function SuggestionRow({
  row,
  busy,
  onAdd,
  onDismiss,
}: {
  row: ContactSuggestion;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("App.Contacts.suggestions");
  const meta = [row.role, row.organization, row.location].filter(Boolean);
  return (
    <li className="flex items-start gap-3 p-3">
      <ContactAvatar name={row.name} className="mt-0.5 size-8" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <a
            href={row.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium hover:underline"
          >
            {row.name}
          </a>
          <ExternalLink
            aria-hidden
            className="text-muted-foreground size-3 shrink-0"
          />
        </div>
        {meta.length ? (
          <p className="text-muted-foreground truncate text-xs">
            {meta.join(" · ")}
          </p>
        ) : null}
        <p className="text-foreground text-sm text-pretty">{row.reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-10 md:size-8"
          aria-label={t("dismiss", { name: row.name })}
          disabled={busy}
          onClick={onDismiss}
        >
          <X aria-hidden className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={t("add", { name: row.name })}
          loading={busy}
          onClick={onAdd}
        >
          <Check aria-hidden className="size-4" />
          <span className="sr-only sm:not-sr-only">{t("addShort")}</span>
        </Button>
      </div>
    </li>
  );
}

function FindPeopleDialog({
  list,
  onClose,
  onFound,
}: {
  list: ContactList;
  onClose: () => void;
  onFound: (found: ContactSuggestion[]) => void;
}) {
  const t = useTranslations("App.Contacts.suggestions");
  const [description, setDescription] = useState(list.description ?? "");
  const [person, setPerson] = useState("");
  const [size, setSize] = useState<Size>(10);
  // One person is described on its own; the list's description stays.
  const one = size === 1;
  const brief = one ? person : description;
  const setBrief = one ? setPerson : setDescription;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (brief.trim().length < 3) {
      setError(t("briefRequired"));
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await contactsService.findPeople(list.id, {
        brief: brief.trim(),
        size,
      });
      onFound(result.suggestions);
      if (result.found) toast.success(t("found", { count: result.found }));
      else toast(t("foundNone"));
      onClose();
    } catch (failure) {
      setError(coreErrorOf(failure).message ?? t("findFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? null : onClose())}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle", { list: list.name })}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="find-people-brief">
              {one ? t("personLabel") : t("briefLabel")}
            </Label>
            <Textarea
              id="find-people-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={one ? t("personPlaceholder") : t("briefPlaceholder")}
              rows={one ? 2 : 4}
              maxLength={1000}
              autoFocus
            />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label id="find-people-size">{t("sizeLabel")}</Label>
            <ToggleGroup
              type="single"
              value={String(size)}
              onValueChange={(value) => {
                const option = SIZES.find((item) => String(item) === value);
                if (option) {
                  setSize(option);
                  setError("");
                }
              }}
              aria-labelledby="find-people-size"
              className="self-start"
            >
              {SIZES.map((option) => (
                <ToggleGroupItem key={option} value={String(option)}>
                  {t("sizeOption", { count: option })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground text-xs">
              {t("pricing", { credits: CREDITS_PER_PERSON })}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {pending
                ? t("searching")
                : t("submit", {
                    count: size,
                    credits: size * CREDITS_PER_PERSON,
                  })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
